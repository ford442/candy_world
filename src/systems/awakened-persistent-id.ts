/**
 * Stable persistentId derivation — hash(quantized worldPosition, typeId).
 * Shared by awakened-persistence and foliage batchers (no batcher imports here).
 */

/** Quantize world position to ~0.01u before hashing */
export const POSITION_QUANTIZE = 100;

export const LUMINOUS_PLANT_TYPE_ID = 'luminous_plant';

/** FNV-1a 32-bit over integers and type string chars */
export function computePersistentId(x: number, z: number, typeId: string): number {
    const qx = Math.round(x * POSITION_QUANTIZE);
    const qz = Math.round(z * POSITION_QUANTIZE);
    let h = 2166136261 >>> 0;
    const mixInt = (n: number) => {
        h ^= n & 0xff;
        h = Math.imul(h, 16777619);
        h ^= (n >>> 8) & 0xff;
        h = Math.imul(h, 16777619);
        h ^= (n >>> 16) & 0xff;
        h = Math.imul(h, 16777619);
        h ^= (n >>> 24) & 0xff;
        h = Math.imul(h, 16777619);
    };
    mixInt(qx);
    mixInt(qz);
    for (let i = 0; i < typeId.length; i++) {
        h ^= typeId.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function persistentIdFromString(id: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
