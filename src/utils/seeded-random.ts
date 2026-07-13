/**
 * @file src/utils/seeded-random.ts
 * @brief Deterministic random seed override for reproducible screenshots/tests.
 *
 * Enabled via URL param `?seed=<number|string>`. When active, `Math.random()`
 * is replaced with a seeded PRNG so world generation, particles, and other
 * stochastic visuals are deterministic across runs.
 */

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

function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return h >>> 0;
}

function readSeedFromURL(): number | null {
    try {
        const raw = new URLSearchParams(window.location.search).get('seed');
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : hashString(raw);
    } catch {
        return null;
    }
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

const _seedValue = readSeedFromURL();
if (_seedValue !== null) {
    _seed = _seedValue;
    _rng = mulberry32(_seedValue);
    const originalRandom = Math.random;
    Math.random = () => _rng!();
    (Math as any).__originalRandom = originalRandom;
    console.log(`[SeededRandom] Deterministic mode enabled with seed ${_seedValue}`);
}
