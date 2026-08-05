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

/** WebAssembly binary magic: `\0asm` */
const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);

/**
 * True when the first bytes of a response are a WASM module (not SPA index.html).
 */
function bufferHasWasmMagic(buffer: ArrayBuffer): boolean {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 4) return false;
    for (let i = 0; i < 4; i++) {
        if (bytes[i] !== WASM_MAGIC[i]) return false;
    }
    return true;
}

/**
 * Probe a URL for a real WASM file. Rejects SPA fallbacks that return index.html with 200.
 */
async function probeWasmAtUrl(url: string): Promise<boolean> {
    try {
        const ranged = await fetch(url, { headers: { Range: 'bytes=0-3' } });
        if (ranged.ok || ranged.status === 206) {
            const bytes = await ranged.arrayBuffer();
            if (bufferHasWasmMagic(bytes)) return true;
            // Some hosts ignore Range and return HTML — fall through to full GET check.
        }

        const full = await fetch(url);
        if (!full.ok) return false;

        const contentType = full.headers.get('content-type') || '';
        if (contentType.includes('text/html')) return false;

        const bytes = await full.arrayBuffer();
        return bufferHasWasmMagic(bytes);
    } catch {
        return false;
    }
}

/**
 * Check if a WASM file exists by probing for the `\0asm` magic bytes.
 * HEAD-only checks are unreliable: Vite preview/dev SPA fallback returns 200 + text/html.
 * @param filename - The WASM filename to check
 * @returns Promise with existence status and path
 */
export async function checkWasmFileExists(filename: string): Promise<WasmFileCheckResult> {
    // 1. Handle absolute URLs directly
    if (filename.includes('://')) {
        if (await probeWasmAtUrl(filename)) {
            return { exists: true, path: '' };
        }
        return { exists: false, path: null };
    }

    // Helper to join paths safely
    const joinPath = (prefix: string, file: string): string => {
        if (!prefix) return file;
        const cleanPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
        return `${cleanPrefix}/${file}`;
    };

    const tryPrefix = async (prefix: string): Promise<WasmFileCheckResult | null> => {
        const url = joinPath(prefix, filename);
        if (!(await probeWasmAtUrl(url))) return null;
        const foundPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
        return { exists: true, path: foundPrefix };
    };

    // 2. Try production/relative path (supports non-root deployments)
    const prodResult = await tryPrefix(PRODUCTION_PATH_PREFIX);
    if (prodResult) return prodResult;

    // 3. Fallback: try local path explicitly if different
    if (PRODUCTION_PATH_PREFIX !== './') {
        const localResult = await tryPrefix('.');
        if (localResult) return localResult;
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
        try { WA.instantiate = origInstantiate; } catch (e) { void e; }
        try { WA.instantiateStreaming = origInstantiateStreaming; } catch (e) { void e; }
    };
}
