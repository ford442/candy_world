// Shared-memory probe for the native loader. The MT Emscripten build needs a
// shared WebAssembly.Memory, which only works under cross-origin isolation.
// (parallelWasmLoad and its Atomics phase buffer lived here; nothing called
// them, and the AS module loads by top-level await in wasm-loader-core.ts.)

/**
 * Check if shared memory (SharedArrayBuffer) is available
 * @returns True if SharedArrayBuffer is supported and functional
 */
export function isSharedMemoryAvailable(): boolean {
    try {
        if (typeof SharedArrayBuffer === 'undefined') return false;
        const test = new SharedArrayBuffer(4);
        const view = new Int32Array(test);
        Atomics.store(view, 0, 1);
        return Atomics.load(view, 0) === 1;
    } catch (e) {
        return false;
    }
}
