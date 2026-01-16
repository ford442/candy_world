/**
 * @file src/utils/wasm-utils.js
 * @brief Utilities for WASM path resolution and checking
 */

// CHANGED: Use relative path './' instead of root '/' to support non-root deployments
const PRODUCTION_PATH_PREFIX = './';

/**
 * Check if a WASM file exists by attempting HEAD requests
 * @param {string} filename - The WASM filename to check
 * @returns {Promise<{exists: boolean, path: string}>}
 */
export async function checkWasmFileExists(filename) {
    // 1. Handle absolute URLs directly
    if (filename.includes('://')) {
        try {
            const check = await fetch(filename, { method: 'HEAD' });
            if (check.ok) return { exists: true, path: '' };
        } catch (e) {}
        return { exists: false, path: null };
    }

    // Helper to join paths safely
    const joinPath = (prefix, file) => {
        if (!prefix) return file;
        const cleanPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
        return `${cleanPrefix}/${file}`;
    };

    // 2. Try Production/Relative Path
    const prodPath = joinPath(PRODUCTION_PATH_PREFIX, filename);
    try {
        const prodCheck = await fetch(prodPath, { method: 'HEAD' });
        if (prodCheck.ok) {
            // Return the prefix detected
            const foundPrefix = PRODUCTION_PATH_PREFIX.endsWith('/') ? PRODUCTION_PATH_PREFIX : `${PRODUCTION_PATH_PREFIX}/`;
            return { exists: true, path: foundPrefix };
        }
    } catch (prodError) {}

    // 3. Fallback: Try local path explicitly if different
    if (PRODUCTION_PATH_PREFIX !== './') {
        const localPath = `./${filename}`;
        try {
            const localCheck = await fetch(localPath, { method: 'HEAD' });
            if (localCheck.ok) {
                return { exists: true, path: './' };
            }
        } catch (localError) {}
    }

    return { exists: false, path: null };
}

/**
 * Inspect exports in a WASM file
 */
export async function inspectWasmExports(filename) {
    const wasmCheck = await checkWasmFileExists(filename);
    if (!wasmCheck.exists) return null;

    const prefix = wasmCheck.path || '';
    const cleanPrefix = prefix.endsWith('/') ? prefix : (prefix ? `${prefix}/` : '');
    const url = `${cleanPrefix}${filename}`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const bytes = await resp.arrayBuffer();

        const WA = window.NativeWebAssembly || WebAssembly;
        let module = null;

        try {
            if (typeof WA.Module === 'function') {
                module = new WA.Module(bytes);
            }
        } catch (e) {}

        if (!module && typeof WA.compile === 'function') {
            try { module = await WA.compile(bytes); } catch(e) {}
        }

        if (!module) {
            try {
                const inst = await WA.instantiate(bytes, {});
                module = inst.module || (inst.instance && inst.instance.constructor && inst.instance.constructor.module);
            } catch (e) {}
        }

        if (!module) return null;

        const exporter = (WA.Module && WA.Module.exports) ? WA.Module.exports : WebAssembly.Module.exports;
        return exporter(module).map(e => e.name);
    } catch (e) {
        console.warn('[WASM Utils] Failed to inspect wasm exports', e);
        return null;
    }
}

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
                        try { exports[short] = exports[k]; } catch (e) {}
                    }
                }
            });
        } catch (e) {}
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
