/**
 * @file storage-buffer-attribute.ts
 * @description Typed wrapper for `StorageBufferAttribute`'s count-based constructor overload.
 *
 * three.js's runtime constructor (`three/src/renderers/common/StorageBufferAttribute.js`)
 * accepts either a pre-built `TypedArray` or a plain particle `count`:
 *
 * ```js
 * constructor(array, itemSize, typeClass = Float32Array) {
 *     if (ArrayBuffer.isView(array) === false) array = new typeClass(array * itemSize);
 *     super(array, itemSize);
 * }
 * ```
 *
 * `@types/three` only declares the `TypedArray` overload
 * (`constructor(array: TypedArray, itemSize: number)`), so passing a `count` — the
 * common case for a freshly allocated GPU buffer — fails type-checking even though it
 * is exactly how three.js itself expects to be called. TS does not support adding a
 * constructor overload to an already-declared class via module augmentation (only
 * instance members merge that way), so this wrapper carries the real contract instead.
 */
import { StorageBufferAttribute } from 'three/webgpu';

type TypedArrayConstructor =
    | Float32ArrayConstructor
    | Uint32ArrayConstructor
    | Int32ArrayConstructor
    | Uint16ArrayConstructor
    | Int16ArrayConstructor
    | Uint8ArrayConstructor;

/** The upstream constructor, widened to the overload three.js actually implements. */
type CountAwareConstructor = new (
    countOrArray: number | Float32Array | Uint32Array | Int32Array | Uint16Array | Int16Array | Uint8Array,
    itemSize: number,
    typeClass?: TypedArrayConstructor,
) => StorageBufferAttribute;

const CountAwareStorageBufferAttribute = StorageBufferAttribute as unknown as CountAwareConstructor;

/**
 * Allocate a `StorageBufferAttribute` sized for `count` elements of `itemSize`
 * components each (defaulting to a zero-filled `Float32Array`), or wrap an
 * existing typed array.
 */
export function createStorageBufferAttribute(
    countOrArray: number | Float32Array | Uint32Array | Int32Array | Uint16Array | Int16Array | Uint8Array,
    itemSize: number,
    typeClass?: TypedArrayConstructor,
): StorageBufferAttribute {
    return new CountAwareStorageBufferAttribute(countOrArray, itemSize, typeClass);
}
