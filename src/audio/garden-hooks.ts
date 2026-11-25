/**
 * @file src/audio/garden-hooks.ts
 * @brief What a garden flora calls into: an import-free leaf between the plant and the sequencer.
 *
 * `foliage/chime-tulip.ts` and `drum-puffball.ts` are reached from the foliage registry, which the
 * garden chunk reaches too (through the world state), so a plant cannot import the lazy stub
 * (`audio/garden-lazy.ts`) without making an import cycle (the same shape as
 * `systems/music-stone-hooks.ts`). It calls this instead; the stub installs the loader when it is
 * evaluated at boot. A plant built before that is remembered and reported on install.
 */

let _onSpawned: (() => void) | null = null;
let _pending = false;

export function installGardenHooks(onSpawned: () => void): void {
    _onSpawned = onSpawned;
    if (_pending) {
        _pending = false;
        onSpawned();
    }
}

/** A garden instrument was built: the garden chunk should load. */
export function gardenFloraSpawned(): void {
    if (_onSpawned) _onSpawned();
    else _pending = true;
}
