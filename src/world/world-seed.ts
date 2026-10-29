/**
 * @file world-seed.ts
 * @brief Single source of truth for shareable world generation seed.
 *
 * Resolution order: URL `?seed=` → map metadata (when loaded) → CONFIG.world.seed.
 * Used by seeded-random, fauna spawn, and multiplayer presence room keys.
 * Share links (presence rooms, shared worlds) are built in `systems/net/share-links.ts`,
 * in the lazy `net` chunk.
 */

import { CONFIG } from '../core/config.ts';

/** Matches `assets/map.json` metadata.seed — keep in sync with CONFIG.world.seed. */
export const DEFAULT_WORLD_SEED = CONFIG.world.seed;

/** `metadata.version` of `assets/map.json`; a WorldDocument records it next to the seed. */
export const DEFAULT_MAP_VERSION = '1.0';

let _mapSeed: number | null = null;
let _mapVersion: string | null = null;
let _seedVersion = 0;

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
export function setMapMetadataSeed(seed: number | undefined, version?: string): void {
    if (typeof version === 'string' && version.length > 0) _mapVersion = version;
    if (typeof seed === 'number' && Number.isFinite(seed)) {
        _mapSeed = Math.floor(seed);
        _seedVersion++;
    }
}

/** Map data version the base world was generated from. */
export function getMapVersion(): string {
    return _mapVersion ?? DEFAULT_MAP_VERSION;
}

/**
 * Bumps whenever the resolved seed may have changed. Per-frame readers (the
 * season controller) compare this instead of calling getWorldSeed(), which
 * parses the URL on every call.
 */
export function getWorldSeedVersion(): number {
    return _seedVersion;
}

/** Active world seed for generation and presence room key. */
export function getWorldSeed(): number {
    const fromUrl = readSeedFromURL();
    if (fromUrl !== null) return fromUrl;
    if (_mapSeed !== null) return _mapSeed;
    return CONFIG.world.seed;
}

/** The shared world a `?world=<uuid>` link opens (#1975), or null. Link builders: `systems/net/share-links.ts`. */
export function readSharedWorldIdFromURL(search?: string): string | null {
    try {
        const raw = new URLSearchParams(search ?? window.location.search).get('world')?.trim();
        return raw && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(raw)
            ? raw.toLowerCase()
            : null;
    } catch {
        return null;
    }
}
