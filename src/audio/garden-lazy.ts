/**
 * Lazy garden sequencer loader (Music Garden slice B): the only part of the garden that stays in
 * `app`.
 *
 * The sequencer, clock, voices and the conductor that keeps them in time live in the `garden`
 * chunk (`audio/garden/`, `vite.config.js`). A chime tulip or drum puffball
 * (`foliage/chime-tulip.ts`, `drum-puffball.ts`) calls `gardenFloraSpawned()` when it is built,
 * through the import-free leaf `audio/garden-hooks.ts`, so the chunk loads only in a world that
 * has one. The `garden-sequencer` frame system (`core/game-loop-systems.ts`) calls
 * `updateGardenLazy` every frame; it does nothing until the chunk is in.
 *
 * Never `await` the load during bootstrap: a lazy chunk that imports `app` and is awaited at boot
 * deadlocks (`docs/APP_CHUNK_SPLIT.md`). A plant built during world generation only schedules it.
 */

import { installGardenHooks } from './garden-hooks.ts';

type GardenModule = typeof import('./garden/index.ts');

let _mod: GardenModule | null = null;
let _load: Promise<GardenModule | null> | null = null;
let _scheduled = false;

function load(): Promise<GardenModule | null> {
    _load ??= import('./garden/index.ts').then(
        (m) => {
            _mod = m;
            return m;
        },
        (err: unknown) => {
            console.warn('[Garden] Could not load the garden sequencer:', err);
            _load = null;
            return null;
        }
    );
    return _load;
}

/** A garden plant exists: load the chunk soon. No-op outside a browser. */
export function noteGardenFloraSpawned(): void {
    if (_scheduled || typeof document === 'undefined') return;
    _scheduled = true;
    setTimeout(() => void load(), 0);
}

/** The `garden-sequencer` frame system's update: free until the chunk has loaded. */
export function updateGardenLazy(dt: number, playerX: number, playerZ: number): void {
    _mod?.updateGarden(dt, playerX, playerZ);
}

/** Tear down (frame-system dispose). */
export function disposeGardenLazy(): void {
    _mod?.disposeGarden();
}

installGardenHooks(noteGardenFloraSpawned);
