/**
 * @file src/utils/seeded-random.ts
 * @brief Deterministic random seed override for reproducible screenshots/tests/multiplayer.
 *
 * Enabled via URL param `?seed=<number|string>` or `applyWorldSeed()` before world gen.
 * When active, `Math.random()` is replaced with a seeded PRNG so world generation,
 * particles, and other stochastic visuals are deterministic across runs.
 */

import { readSeedFromURL } from '../world/world-seed.ts';

let _seed: number | null = null;
let _rng: (() => number) | null = null;

/** Mulberry32 PRNG — fast, seedable, decent quality for visual determinism. */
function mulberry32(a: number): () => number {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Current deterministic seed, or null when not seeded. */
export function getSeed(): number | null {
    return _seed;
}

/** Whether deterministic random mode is active. */
export function isSeeded(): boolean {
    return _seed !== null;
}

/** Seeded random if a seed is set, otherwise falls back to Math.random(). */
export function getSeededRandom(): number {
    return _rng ? _rng() : Math.random();
}

/** Apply (or re-apply) a world seed before generation. Safe to call from opt-in UI. */
export function applyWorldSeed(seed: number): void {
    const normalized = Math.floor(seed) >>> 0;
    if (_seed === normalized && _rng) return;

    _seed = normalized;
    _rng = mulberry32(normalized);

    const mathObj = Math as typeof Math & { __originalRandom?: () => number };
    if (!mathObj.__originalRandom) {
        mathObj.__originalRandom = Math.random;
    }
    Math.random = () => _rng!();
    console.log(`[SeededRandom] Deterministic mode enabled with seed ${normalized}`);
}

const _seedValue = readSeedFromURL();
if (_seedValue !== null) {
    applyWorldSeed(_seedValue);
}
