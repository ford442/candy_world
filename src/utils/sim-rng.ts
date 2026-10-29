/**
 * @file src/utils/sim-rng.ts
 * @brief Seeded RNG for fixed-step simulation (#1973).
 *
 * The frame scheduler hands this stream to systems as `ctx.rng`, and code under
 * the `fixed` phase that has no `ctx` (the player physics helpers) imports
 * `simRng` directly; both are the same instance. Draw from it only inside
 * `fixed`: the number of fixed steps depends on game time alone, so the stream
 * replays identically at any frame rate. World generation uses the world-seed
 * stream instead (`getSeededRandom()` in `seeded-random.ts`).
 */

export class SimRng {
    private seed: number;

    constructor(seed: number = 123456789) {
        this.seed = seed >>> 0;
    }

    public setSeed(seed: number) {
        this.seed = seed >>> 0;
    }

    /** Mulberry32 — the same generator as `seeded-random.ts`. Returns [0, 1). */
    public next(): number {
        let t = (this.seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}
export const simRng = new SimRng();
