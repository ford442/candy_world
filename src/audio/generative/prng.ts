/**
 * Deterministic seeded PRNG (mulberry32).
 * Same seed → same sequence across sessions and platforms.
 */
export class SeededRng {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0 || 0x6d2b79f5;
    }

    /** Uniform float in [0, 1). */
    next(): number {
        let t = (this.state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Integer in [min, max] inclusive. */
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /** Pick one element from array. */
    pick<T>(arr: readonly T[]): T {
        return arr[this.int(0, arr.length - 1)];
    }
}

/** Hash a string into a 32-bit seed. */
export function hashSeed(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
