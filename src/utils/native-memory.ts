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
    private readonly source: BufferSource;
    readonly ptr: number;
    readonly length: number;

    constructor(source: BufferSource, ptr: number, length: number) {
        this.source = source;
        this.ptr = ptr;
        this.length = length;
    }

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

// =============================================================================
// Structs
// =============================================================================

/** A struct field: every one is 4 bytes. `ptr` is a byte offset (u32). */
export type NativeFieldType = 'f32' | 'i32' | 'u32' | 'ptr';
export type NativeStructSpec = Readonly<Record<string, NativeFieldType>>;

/** A struct layout: byte offsets in declaration order, and the stride. */
export interface NativeStruct<S extends NativeStructSpec> {
    readonly spec: S;
    /** Byte offset of each field inside one element. */
    readonly offsets: { readonly [K in keyof S]: number };
    /** Bytes per element. */
    readonly size: number;
}

/**
 * Lay out a struct from its field spec (usually a NATIVE_STRUCTS entry from
 * native-exports.generated.ts, so TS and the native reader share one
 * definition). Fields are 4 bytes each, packed in declaration order, which is
 * how a C struct of 4-byte scalars and AS raw load/store offsets lay out too.
 */
export function defineNativeStruct<S extends NativeStructSpec>(spec: S): NativeStruct<S> {
    const offsets = {} as { [K in keyof S]: number };
    let size = 0;
    for (const key of Object.keys(spec) as (keyof S)[]) {
        offsets[key] = size;
        size += 4;
    }
    return Object.freeze({ spec, offsets: Object.freeze(offsets), size });
}

/**
 * `count` elements of a struct at byte `ptr` in a module's memory, with typed
 * get/set per field. Views are re-derived whenever the module's buffer
 * changes (memory.grow), so this object may be held across native calls; the
 * views it hands out internally never are.
 */
export class NativeStructArray<S extends NativeStructSpec> {
    readonly struct: NativeStruct<S>;
    readonly ptr: number;
    readonly count: number;
    private readonly source: BufferSource;
    private _buffer: ArrayBufferLike | null = null;
    private _f32: Float32Array | null = null;
    private _i32: Int32Array | null = null;
    private _u32: Uint32Array | null = null;

    constructor(source: BufferSource, struct: NativeStruct<S>, ptr: number, count: number) {
        if (ptr % 4 !== 0) throw new RangeError(`unaligned struct ${ptr}`);
        this.source = source;
        this.struct = struct;
        this.ptr = ptr;
        this.count = count;
    }

    get byteLength(): number {
        return this.count * this.struct.size;
    }

    private refresh(): void {
        const buffer = this.source();
        if (!buffer) throw new Error('[native-memory] module memory is gone');
        if (buffer === this._buffer) return;
        const words = this.byteLength / 4;
        this._buffer = buffer;
        this._f32 = new Float32Array(buffer, this.ptr, words);
        this._i32 = new Int32Array(buffer, this.ptr, words);
        this._u32 = new Uint32Array(buffer, this.ptr, words);
    }

    private word(index: number, field: keyof S): number {
        if (index < 0 || index >= this.count) {
            throw new RangeError(`struct index ${index}`);
        }
        return (index * this.struct.size + this.struct.offsets[field]) >> 2;
    }

    get(index: number, field: keyof S): number {
        this.refresh();
        const w = this.word(index, field);
        switch (this.struct.spec[field]) {
            case 'f32':
                return this._f32![w];
            case 'i32':
                return this._i32![w];
            default:
                return this._u32![w];
        }
    }

    set(index: number, field: keyof S, value: number): void {
        this.refresh();
        const w = this.word(index, field);
        switch (this.struct.spec[field]) {
            case 'f32':
                this._f32![w] = value;
                break;
            case 'i32':
                this._i32![w] = value;
                break;
            default:
                this._u32![w] = value >>> 0;
        }
    }

    /** Write every field of element `index` at once. */
    write(index: number, values: { readonly [K in keyof S]: number }): void {
        for (const key of Object.keys(this.struct.spec) as (keyof S)[])
            this.set(index, key, values[key]);
    }
}

/** Struct array over a fixed AS region (offsets from native-memory-layout.ts). */
export function asRegionStruct<S extends NativeStructSpec>(
    struct: NativeStruct<S>,
    offset: number,
    count: number
): NativeStructArray<S> | null {
    return asExports ? new NativeStructArray(asMemoryBuffer, struct, offset, count) : null;
}

/** Allocate `count` elements in AS memory, or null when the allocator is unavailable. */
export function asAllocStruct<S extends NativeStructSpec>(
    struct: NativeStruct<S>,
    count: number
): NativeStructArray<S> | null {
    const ptr = asMalloc(count * struct.size);
    return ptr ? new NativeStructArray(asMemoryBuffer, struct, ptr, count) : null;
}

/** Allocate `count` elements in Emscripten memory, or null when unavailable. */
export function emAllocStruct<S extends NativeStructSpec>(
    em: EmscriptenHeapSource | null | undefined,
    struct: NativeStruct<S>,
    count: number
): NativeStructArray<S> | null {
    if (!em?._malloc || !emMemoryBuffer(em)) return null;
    const ptr = em._malloc(count * struct.size) >>> 0;
    return ptr ? new NativeStructArray(() => emMemoryBuffer(em), struct, ptr, count) : null;
}
