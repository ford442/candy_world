/**
 * @file src/systems/objective-signals.ts
 * @brief Live, present-tense signals the Melody objectives read: the biome the player stands in,
 * the beat phase, and a cue bus that says "look again" (#2028, triggers slice).
 *
 * Producers sit in `app` (the game loop, the season controller, the authored-entity registry) and
 * must not import the lazy `objectives` chunk, so they write here instead. Import-free, so it stays
 * in `app` beside `progress-events.ts`. Nothing here is saved: a cue only asks the objective system
 * to re-read current state, which is what keeps replayed or duplicated cues harmless.
 */

export type ObjectiveCue =
    { kind: 'visit'; biome: string } | { kind: 'season' } | { kind: 'build' };

type Listener = (cue: ObjectiveCue) => void;
const _listeners: Listener[] = [];

export function onObjectiveCue(listener: Listener): () => void {
    _listeners.push(listener);
    return () => {
        const i = _listeners.indexOf(listener);
        if (i >= 0) _listeners.splice(i, 1);
    };
}

export function emitObjectiveCue(cue: ObjectiveCue): void {
    for (const listener of _listeners.slice()) {
        try {
            listener(cue);
        } catch (err) {
            console.warn('[ObjectiveSignals] Listener failed:', err);
        }
    }
}

let _biome = 'global';

/** The biome under the player (`getBiomeAtPosition`). Emits a `visit` cue only on a change. */
export function reportBiome(biome: string): void {
    if (biome === _biome) return;
    _biome = biome;
    emitObjectiveCue({ kind: 'visit', biome });
}

export function getCurrentBiome(): string {
    return _biome;
}

let _beatPhase = 0;

/** Written once per frame by the audio clock source; 0..1 from one beat to the next. */
export function setBeatPhase(phase: number): void {
    _beatPhase = Number.isFinite(phase) ? phase : 0;
}

export function getBeatPhase(): number {
    return _beatPhase;
}

/** Fraction of a beat either side of it that still counts as "on the beat". */
export const ON_BEAT_WINDOW = 0.15;

/** True when `phase` is within `window` of a beat (phase 0, which is also phase 1). */
export function isOnBeat(phase: number, window: number = ON_BEAT_WINDOW): boolean {
    return phase <= window || phase >= 1 - window;
}

export function __resetObjectiveSignalsForTests(): void {
    _listeners.length = 0;
    _biome = 'global';
    _beatPhase = 0;
}
