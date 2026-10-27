/**
 * @file src/systems/net/share-links.ts
 * @brief Share links: presence rooms (`?seed=&presence=1`) and shared worlds
 * (`?world=<uuid>&seed=`, plus `&invite=` for builders). In the lazy `net`
 * chunk with everything that builds them; `app` only reads `?world=`
 * (`readSharedWorldIdFromURL` in world-seed.ts).
 */

import { getWorldSeed, readSeedFromURL } from '../../world/world-seed.ts';

const SEED_STORAGE_KEY = 'candy_world_seed';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** The builder invite a `?invite=` link carries, or null. */
export function readWorldInviteFromURL(search?: string): string | null {
    try {
        const raw = new URLSearchParams(search ?? window.location.search).get('invite')?.trim();
        return raw && UUID_RE.test(raw) ? raw.toLowerCase() : null;
    } catch {
        return null;
    }
}

/**
 * A shared world link. It carries the world's seed too, so the terrain the
 * document was built on generates before the document is even fetched.
 */
export function buildWorldShareUrl(
    worldId: string,
    seed: number,
    opts: { invite?: string; base?: string } = {}
): string {
    const url = new URL(opts.base ?? window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('world', worldId);
    url.searchParams.set('seed', String(seed));
    if (opts.invite) url.searchParams.set('invite', opts.invite);
    return url.toString();
}
