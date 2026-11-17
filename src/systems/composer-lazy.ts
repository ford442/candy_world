/**
 * Lazy grove composer loader (#1976 slice C): the only part of the composer that stays in `app`.
 *
 * The pattern editor, the proximity playback system and the voice table live in the `composer`
 * chunk (`systems/composer/`, `vite.config.js`). A music stone (`foliage/music-stone.ts`) reaches
 * `noteMusicStoneSpawned()` when it is built, so the chunk loads only in a world that has one,
 * and `openComposer()` when the player interacts with it, through `music-stone-hooks.ts`, which
 * this module installs itself into when it is evaluated.
 *
 * Call both with `void`, never `await`: a lazy chunk that imports `app` and is awaited during
 * bootstrap deadlocks (`docs/APP_CHUNK_SPLIT.md`). Stones built during world generation therefore
 * only schedule the load.
 */

import type * as THREE from 'three';
import { installMusicStoneHooks } from './music-stone-hooks.ts';

type ComposerModule = typeof import('./composer/index.ts');

let _load: Promise<ComposerModule | null> | null = null;
let _scheduled = false;

/**
 * True while the pattern editor is open. Opening it releases pointer lock so the mouse can reach
 * the keys; the input session asks this before raising the pause menu on that unlock.
 */
export { isComposerOpen } from './music-stone-hooks.ts';

function load(): Promise<ComposerModule | null> {
    _load ??= import('./composer/index.ts').then(
        (m) => m,
        (err: unknown) => {
            console.warn('[Composer] Could not load the grove composer:', err);
            _load = null;
            return null;
        }
    );
    return _load;
}

/** A stone exists: load the chunk soon (it starts proximity playback). No-op outside a browser. */
export function noteMusicStoneSpawned(): void {
    if (_scheduled || typeof document === 'undefined') return;
    _scheduled = true;
    setTimeout(() => void load(), 0);
}

/** Open the pattern editor on `stone`. Resolves once it is open (or failed to load). */
export async function openComposer(stone: THREE.Object3D): Promise<void> {
    const m = await load();
    m?.openComposerFor(stone);
}

installMusicStoneHooks({
    spawned: noteMusicStoneSpawned,
    open: (stone) => void openComposer(stone),
});
