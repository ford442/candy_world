/**
 * @file src/utils/wasm-utils.ts
 * @brief Utilities for WASM path resolution and checking
 */

// Extend Window interface for NativeWebAssembly
declare global {
    interface Window {
        NativeWebAssembly?: typeof WebAssembly;
    }
}

// CHANGED: Use relative path './' instead of root '/' to support non-root deployments
const PRODUCTION_PATH_PREFIX = './';

/**
 * Result of checking if a WASM file exists
 */
export interface WasmFileCheckResult {
    exists: boolean;
    path: string | null;
}

/**
 * WebAssembly export descriptor
 */
interface WasmExport {
    name: string;
    kind: string;
}

/**
 * Check if a WASM file exists by attempting HEAD requests
 * @param filename - The WASM filename to check
 * @returns Promise with existence status and path
 */
export async function checkWasmFileExists(filename: string): Promise<WasmFileCheckResult> {
    // 1. Handle absolute URLs directly
    if (filename.includes('://')) {
        try {
            const check = await fetch(filename, { method: 'HEAD' });
            if (check.ok) return { exists: true, path: '' };
        } catch (e) {
            // Ignore fetch errors
        }
        return { exists: false, path: null };
    }

    // Helper to join paths safely
    const joinPath = (prefix: string, file: string): string => {
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
    } catch (prodError) {
        // Ignore fetch errors
    }

    // 3. Fallback: Try local path explicitly if different
    if (PRODUCTION_PATH_PREFIX !== './') {
        const localPath = `./${filename}`;
        try {
            const localCheck = await fetch(localPath, { method: 'HEAD' });
            if (localCheck.ok) {
                return { exists: true, path: './' };
            }
        } catch (localError) {
            // Ignore fetch errors
        }
    }

    return { exists: false, path: null };
}

/**
 * Inspect exports in a WASM file
 * @param filename - The WASM filename to inspect
 * @returns Array of export names or null if failed
 */
export async function inspectWasmExports(filename: string): Promise<string[] | null> {
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
        let module: WebAssembly.Module | null = null;

        try {
            if (typeof (WA as any).Module === 'function') {
                module = new (WA as any).Module(bytes);
            }
        } catch (e) {
            // Module creation failed
        }

        if (!module && typeof WA.compile === 'function') {
            try { 
                module = await WA.compile(bytes); 
            } catch(e) {
                // Compile failed
            }
        }

        if (!module) {
            try {
                const inst = await WA.instantiate(bytes, {});
                module = inst.module || (inst.instance && (inst.instance as any).constructor && (inst.instance as any).constructor.module);
            } catch (e) {
                // Instantiate failed
            }
        }

        if (!module) return null;

        const exporter = (WA as any).Module && (WA as any).Module.exports 
            ? (WA as any).Module.exports 
            : WebAssembly.Module.exports;
        return exporter(module).map((e: WasmExport) => e.name);
    } catch (e) {
        console.warn('[WASM Utils] Failed to inspect wasm exports', e);
        return null;
    }
}

/**
 * WebAssembly instantiation result with optional instance wrapper
 */
interface WasmInstantiateResult {
    instance: WebAssembly.Instance;
    module: WebAssembly.Module;
}

/**
 * Patch WebAssembly instantiate to create aliases for underscore-prefixed exports
 * @returns Function to restore original behavior
 */
export function patchWasmInstantiateAliases(): () => void {
    const WA = window.NativeWebAssembly || WebAssembly;
    const origInstantiate = WA.instantiate;
    const origInstantiateStreaming = WA.instantiateStreaming;

    function aliasExports(result: WasmInstantiateResult | WebAssembly.Instance): WasmInstantiateResult | WebAssembly.Instance {
        try {
            const inst = result && (result as WasmInstantiateResult).instance 
                ? (result as WasmInstantiateResult).instance 
                : result as WebAssembly.Instance;
            const exports = inst && inst.exports;
            if (!exports) return result;
            const keys = Object.keys(exports);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (k && k.startsWith('_')) {
                    const short = k.slice(1);
                    if (!(short in exports)) {
                        try { 
                            (exports as Record<string, unknown>)[short] = exports[k]; 
                        } catch (e) {
                            // Ignore assignment errors
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore aliasing errors
        }
        return result;
    }

    if (typeof WA.instantiate === 'function') {
        (WA as any).instantiate = async function(...args: Parameters<typeof WebAssembly.instantiate>): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
            const res = await origInstantiate.apply(this, args);
            return aliasExports(res) as WebAssembly.WebAssemblyInstantiatedSource;
        };
    }

    if (typeof WA.instantiateStreaming === 'function') {
        (WA as any).instantiateStreaming = async function(...args: Parameters<typeof WebAssembly.instantiateStreaming>): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
            const res = await origInstantiateStreaming.apply(this, args);
            return aliasExports(res) as WebAssembly.WebAssemblyInstantiatedSource;
        };
    }

    return function restore(): void {
        try { WA.instantiate = origInstantiate; } catch (e) {}
        try { WA.instantiateStreaming = origInstantiateStreaming; } catch (e) {}
    };
}
