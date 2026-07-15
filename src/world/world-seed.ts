/**
 * @file world-seed.ts
 * @brief Single source of truth for shareable world generation seed.
 *
 * Resolution order: URL `?seed=` → map metadata (when loaded) → CONFIG.world.seed.
 * Used by seeded-random, fauna spawn, and multiplayer presence room keys.
 */

import { CONFIG } from '../core/config.ts';

/** Matches `assets/map.json` metadata.seed — keep in sync with CONFIG.world.seed. */
export const DEFAULT_WORLD_SEED = CONFIG.world.seed;

const SEED_STORAGE_KEY = 'candy_world_seed';

let _mapSeed: number | null = null;

function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return h >>> 0;
}

/** Parse `?seed=` from the current URL. Returns null when absent. */
export function readSeedFromURL(): number | null {
    try {
        const raw = new URLSearchParams(window.location.search).get('seed');
        if (raw === null || raw.trim().length === 0) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? Math.floor(n) : hashString(raw);
    } catch {
        return null;
    }
}

/** Called once map metadata is available (optional refinement of default). */
export function setMapMetadataSeed(seed: number | undefined): void {
    if (typeof seed === 'number' && Number.isFinite(seed)) {
        _mapSeed = Math.floor(seed);
    }
}

/** Active world seed for generation and presence room key. */
export function getWorldSeed(): number {
    const fromUrl = readSeedFromURL();
    if (fromUrl !== null) return fromUrl;
    if (_mapSeed !== null) return _mapSeed;
    return CONFIG.world.seed;
}

/** Whether the URL explicitly sets a seed (share link / room join). */
export function hasExplicitSeedInURL(): boolean {
    return readSeedFromURL() !== null;
}

/** Persist seed choice for share links across reloads. */
export function rememberWorldSeed(seed: number): void {
    try {
        localStorage.setItem(SEED_STORAGE_KEY, String(seed));
    } catch {
        /* ignore quota / private mode */
    }
}

/** Add `?seed=` to the URL without reload when missing. */
export function ensureSeedInUrl(seed: number = getWorldSeed()): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('seed')) return;
    url.searchParams.set('seed', String(seed));
    window.history.replaceState({}, '', url.toString());
}

/** Build a shareable link for the current room. */
export function buildShareUrl(
    seed: number = getWorldSeed(),
    opts?: { presence?: boolean }
): string {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(seed));
    if (opts?.presence) {
        url.searchParams.set('presence', '1');
    } else {
        url.searchParams.delete('presence');
    }
    return url.toString();
}
