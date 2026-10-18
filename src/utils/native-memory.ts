/**
 * @file native-memory.ts
 * @brief Growth-safe access to AssemblyScript and Emscripten linear memory.
 *
 * Both modules can grow their memory at any call that allocates. Growth
 * detaches the old ArrayBuffer (single-threaded) or leaves cached views with a
 * stale length (shared memory), so no TypedArray over native memory may be
 * cached across a native call. NativeBuffer re-derives its view from the
 * current `memory.buffer` on every access instead.
 *
 * This module imports nothing from the loaders: wasm-loader-core binds the AS
 * instance here once it is instantiated, so there is no import cycle.
 */

type BufferSource = () => ArrayBufferLike | null;

/** Typed view over `length` floats at `ptr`, re-derived after memory growth. */
export class NativeF32 {
    private _view: Float32Array | null = null;

    constructor(
        private readonly source: BufferSource,
        readonly ptr: number,
        readonly length: number
    ) {}

    /** Current view. Do not hold it across a call into native code. */
    get view(): Float32Array {
        const buffer = this.source();
        if (!buffer) throw new Error('[native-memory] module memory is gone');
        if (!this._view || this._view.buffer !== buffer || this._view.length !== this.length) {
            this._view = new Float32Array(buffer, this.ptr, this.length);
        }
        return this._view;
    }

    get byteLength(): number {
        return this.length * 4;
    }
}

// =============================================================================
// AssemblyScript
// =============================================================================

interface AsAllocatorExports {
    memory: WebAssembly.Memory;
    malloc?: (size: number) => number;
    free?: (ptr: number) => void;
}

let asExports: AsAllocatorExports | null = null;

/** Called by wasm-loader-core once the AS instance is validated. */
export function bindAssemblyScriptMemory(exports: AsAllocatorExports | null): void {
    asExports = exports;
}

export function asMemoryBuffer(): ArrayBufferLike | null {
    return asExports ? asExports.memory.buffer : null;
}

export function hasAsAllocator(): boolean {
    return !!(asExports?.malloc && asExports.free);
}

/**
 * Unmanaged allocation in AS memory (assembly/allocator.ts). The block is not
 * a GC object, so it stays valid until asFree. Returns 0 when unavailable.
 */
export function asMalloc(bytes: number): number {
    if (!asExports?.malloc || bytes <= 0) return 0;
    try {
        return asExports.malloc(bytes) >>> 0;
    } catch (e) {
        console.warn('[native-memory] AS malloc failed:', e);
        return 0;
    }
}

export function asFree(ptr: number): void {
    if (ptr && asExports?.free) asExports.free(ptr);
}

/** Allocate `count` floats in AS memory, or null when the allocator is unavailable. */
export function asAllocF32(count: number): NativeF32 | null {
    const ptr = asMalloc(count * 4);
    return ptr ? new NativeF32(asMemoryBuffer, ptr, count) : null;
}

/** Fixed-region view (offsets from native-memory-layout.ts), re-derived after growth. */
export function asRegionF32(offset: number, count: number): NativeF32 | null {
    return asExports ? new NativeF32(asMemoryBuffer, offset, count) : null;
}

// =============================================================================
// Emscripten
// =============================================================================

interface EmscriptenHeapSource {
    wasmMemory?: WebAssembly.Memory;
    HEAP8?: Int8Array;
    HEAPF32?: Float32Array;
    _malloc?: (size: number) => number;
    _free?: (ptr: number) => void;
}

/** Current Emscripten memory buffer, read fresh so growth never leaves it stale. */
export function emMemoryBuffer(
    em: EmscriptenHeapSource | null | undefined
): ArrayBufferLike | null {
    if (!em) return null;
    if (em.wasmMemory) return em.wasmMemory.buffer;
    return em.HEAP8 ? em.HEAP8.buffer : null;
}

/**
 * Float32 view of the whole Emscripten heap. Prefers the exported HEAPF32
 * (Emscripten refreshes it on growth) and otherwise builds one from
 * wasmMemory, so callers never dereference a missing HEAPF32.
 */
export function emHeapF32(em: EmscriptenHeapSource | null | undefined): Float32Array | null {
    const buffer = emMemoryBuffer(em);
    if (!buffer) return null;
    if (em!.HEAPF32 && em!.HEAPF32.buffer === buffer) return em!.HEAPF32;
    return new Float32Array(buffer);
}

/** Allocate `count` floats in Emscripten memory, or null when unavailable. */
export function emAllocF32(
    em: EmscriptenHeapSource | null | undefined,
    count: number
): NativeF32 | null {
    if (!em?._malloc || !emMemoryBuffer(em)) return null;
    const ptr = em._malloc(count * 4) >>> 0;
    return ptr ? new NativeF32(() => emMemoryBuffer(em), ptr, count) : null;
}
