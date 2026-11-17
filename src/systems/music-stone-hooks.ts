/**
 * @file src/systems/music-stone-hooks.ts
 * @brief What a music stone calls into: an import-free leaf between the stone and the composer.
 *
 * `foliage/music-stone.ts` is reached from the foliage registry, which the composer chunk reaches
 * too (through the world commands), so the stone cannot import the composer stub without making
 * an import cycle. It calls these hooks instead; `systems/composer-lazy.ts` installs them when it
 * is evaluated (at boot, from the input pipeline). A stone built before that is remembered and
 * reported on install.
 */

import type * as THREE from 'three';

export interface MusicStoneHooks {
    /** A stone was built: the composer chunk should load. */
    spawned(): void;
    /** The player interacted with `stone`. */
    open(stone: THREE.Object3D): void;
}

let _hooks: MusicStoneHooks | null = null;
let _pendingSpawn = false;

export function installMusicStoneHooks(hooks: MusicStoneHooks): void {
    _hooks = hooks;
    if (_pendingSpawn) {
        _pendingSpawn = false;
        hooks.spawned();
    }
}

export function musicStoneSpawned(): void {
    if (_hooks) _hooks.spawned();
    else _pendingSpawn = true;
}

export function openMusicStone(stone: THREE.Object3D): void {
    _hooks?.open(stone);
}

let _composerOpen = false;

/** True while the composer's editor is open (it set this through `setComposerOpen`). */
export function isComposerOpen(): boolean {
    return _composerOpen;
}

export function setComposerOpen(open: boolean): void {
    _composerOpen = open;
}
