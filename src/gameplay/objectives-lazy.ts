/**
 * Lazy objectives loader (#2028 slice B) — the only part of the Melody layer that stays in `app`.
 *
 * The state machine, the Melody files, valibot and the journal live in the `objectives` chunk
 * (`vite.config.js`). This stub starts it after `__sceneReady`, from `shader-warmup.ts`, the way
 * `preloadGameplay()` starts the ability chunk.
 *
 * Call it with `void`, never `await`. `core/main.ts` runs `void runBootstrap()` on purpose:
 * awaiting a lazy chunk that imports `app` during bootstrap deadlocks the `weather` ↔ `app` cycle.
 */

let _load: Promise<void> | null = null;

/**
 * Start (or reuse) the dynamic import. Resolves when the chunk has loaded and registered itself;
 * never rejects, because Melodies are optional: a failed load warns once and the world plays on
 * (state a document applied meanwhile is still held by `systems/melody-progress.ts`).
 */
export function preloadObjectives(): Promise<void> {
    if (!_load) {
        _load = import('./objectives/index.ts').then(
            () => undefined,
            (err: unknown) => {
                console.warn('[Objectives] Could not load the Melody layer:', err);
            }
        );
    }
    return _load;
}
