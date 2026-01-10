// Shared utility for checking WASM file existence
// Used by wasm-loader.js and wasm-orchestrator.js

// Production deployment path prefix
const PRODUCTION_PATH_PREFIX = '/candy-world';

/**
 * Check if a WASM file exists by attempting HEAD requests at different paths
 * @param {string} filename - The WASM filename to check (e.g., 'candy_native.wasm')
 * @returns {Promise<{exists: boolean, path: string}>} - Result with existence status and resolved path
 */
export async function checkWasmFileExists(filename) {
    // Try production path first
    const prodPath = `${PRODUCTION_PATH_PREFIX}/${filename}`;
    try {
        const prodCheck = await fetch(prodPath, { method: 'HEAD' });
        if (prodCheck.ok) {
            return { exists: true, path: PRODUCTION_PATH_PREFIX };
        }
    } catch (prodError) {
        // Continue to local path check
    }

    // Try local path
    const localPath = `./${filename}`;
    try {
        const localCheck = await fetch(localPath, { method: 'HEAD' });
        if (localCheck.ok) {
            return { exists: true, path: '' };
        }
    } catch (localError) {
        // File not found
    }

    return { exists: false, path: null };
}

/**
 * Inspect exports in a WASM file by compiling it and returning the exported symbol names
 * @param {string} filename - The WASM filename to inspect (e.g., 'candy_native.wasm')
 * @returns {Promise<string[]|null>} - Array of export names, or null if file not found/inspect fails
 */
export async function inspectWasmExports(filename) {
    const wasmCheck = await checkWasmFileExists(filename);
    if (!wasmCheck.exists) return null;

    const url = wasmCheck.path ? `${wasmCheck.path}/${filename}` : `./${filename}`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const bytes = await resp.arrayBuffer();

        // Use available WebAssembly API (try compile, Module ctor, or instantiate fallback)
        const WA = window.NativeWebAssembly || WebAssembly;
        let module = null;

        // Prefer synchronous Module constructor if present
        try {
            if (typeof WA.Module === 'function') {
                module = new WA.Module(bytes);
            }
        } catch (e) {
            // Module ctor may not be available or may throw; continue to other approaches
            module = null;
        }

        // Try compile() (async) if available
        try {
            if (!module && typeof WA.compile === 'function') {
                module = await WA.compile(bytes);
            }
        } catch (e) {
            module = null;
        }

        // Fallback: instantiate to get module from result
        if (!module) {
            try {
                const inst = await WA.instantiate(bytes, {});
                module = inst.module || (inst.instance && inst.instance.constructor && inst.instance.constructor.module) || null;
            } catch (e) {
                module = null;
            }
        }

        if (!module) {
            console.warn('[WASM Utils] Unable to produce a WebAssembly.Module for', filename);
            return null;
        }

        const exporter = (WA.Module && WA.Module.exports) ? WA.Module.exports : WebAssembly.Module.exports;
        const exports = exporter(module).map(e => e.name);
        return exports;
    } catch (e) {
        console.warn('[WASM Utils] Failed to inspect wasm exports for', filename, e);
        return null;
    }
}

/**
 * Monkey-patch WebAssembly.instantiate / instantiateStreaming to alias underscore exports
 * Returns a function to restore the originals.
 */
export function patchWasmInstantiateAliases() {
    const WA = window.NativeWebAssembly || WebAssembly;
    const origInstantiate = WA.instantiate;
    const origInstantiateStreaming = WA.instantiateStreaming;

    function aliasExports(result) {
        try {
            const inst = result && result.instance ? result.instance : result;
            const exports = inst && inst.exports;
            if (!exports) return result;
            Object.keys(exports).forEach(k => {
                if (k && k.startsWith('_')) {
                    const short = k.slice(1);
                    if (!(short in exports)) {
                        try { exports[short] = exports[k]; } catch (e) { /* ignore */ }
                    }
                }
            });
        } catch (e) {
            console.warn('[WASM Utils] Failed to alias exports', e);
        }
        return result;
    }

    if (typeof WA.instantiate === 'function') {
        WA.instantiate = async function(...args) {
            const res = await origInstantiate.apply(this, args);
            return aliasExports(res);
        };
    }

    if (typeof WA.instantiateStreaming === 'function') {
        WA.instantiateStreaming = async function(...args) {
            const res = await origInstantiateStreaming.apply(this, args);
            return aliasExports(res);
        };
    }

    return function restore() {
        try { WA.instantiate = origInstantiate; } catch (e) {}
        try { WA.instantiateStreaming = origInstantiateStreaming; } catch (e) {}
    };
}
}
