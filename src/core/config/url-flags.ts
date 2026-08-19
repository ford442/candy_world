// ---------------------------------------------------------------------------
// FEATURE FLAGS
//
// URL query params let you disable heavy subsystems without touching code:
//   ?no_luminous          — skip luminous plant batcher + lake-island plants
//   ?no_musical           — skip musical flora (arpeggio fern, vibrato violet, etc.)
//   ?no_procedural        — skip procedural extras (random filler objects)
//   ?no_batchers          — skip tree / mushroom / flower GPU batch systems
//   ?no_audio_react       — skip beat-sync and music-reactivity hooks
//   ?no_fireflies         — skip firefly particle system
//   ?no_grass             — skip GPU grass instancing
//   ?no_fauna             — skip ambient fauna boids + batchers
//   ?awakened             — enable durable glow for music-awakened flora (default off)
//   ?presence=1           — show shared-presence opt-in UI (still requires explicit join)
//   ?generative=1         — in-browser generative soundtrack (or ?music=generative)
//   ?photo=1              — cinematic photo mode (or ?mode=photo)
//   ?lights=1             — show local point/spot helpers (also implied by ?debug=1)
//   ?no_gpu_compute       — force WASM/JS fallback for batch LOD + foliage scalar batches
//   ?nativeMusicAccum=0   — force TS arpeggio_grove channel accumulate (A/B vs AS)
//   ?nativeMusicAccum=1   — prefer AS accumulate when candy_physics export present (default)
//
// Combine flags to isolate regressions: ?no_luminous&no_musical
// All flags default to ENABLED (absent = feature on).
// ---------------------------------------------------------------------------

export function hasUrlFlag(key: string): boolean {
    try {
        return new URLSearchParams(window.location.search).has(key);
    } catch {
        return false; // non-browser (test) environment — all features on
    }
}

/** Read a *valued* URL flag, e.g. ?postfx=low → 'low'. Returns null when absent. */
export function getUrlFlag(key: string): string | null {
    try {
        return new URLSearchParams(window.location.search).get(key);
    } catch {
        return null; // non-browser (test) environment
    }
}

/** @internal postfx resolution */
export const _hasFlag = hasUrlFlag;
/** @internal postfx resolution */
export const _getFlag = getUrlFlag;

export function isPresenceFeatureEnabled(): boolean {
    if (hasUrlFlag('presence')) return true;
    const flag = getUrlFlag('presence');
    if (flag === '1' || flag === '') return true;
    try {
        if (
            typeof localStorage !== 'undefined' &&
            localStorage.getItem('candy_presence_opt_in') === '1'
        ) {
            return true;
        }
    } catch {
        /* private mode */
    }
    return false;
}

export const FEATURE_FLAGS = {
    luminousPlants: !hasUrlFlag('no_luminous'),
    myceliumRealm: !hasUrlFlag('no_mycelium'),
    musicalFlora: !hasUrlFlag('no_musical'),
    proceduralExtras: !hasUrlFlag('no_procedural'),
    batchers: !hasUrlFlag('no_batchers'),
    audioReactivity: !hasUrlFlag('no_audio_react'),
    fireflies: !hasUrlFlag('no_fireflies'),
    grass: !hasUrlFlag('no_grass'),
    fauna: !hasUrlFlag('no_fauna'),
    reliableBoot: !hasUrlFlag('no_reliable_boot'),
    /**
     * Persist soft glow for music-awakened flora across reloads.
     * Runtime URL flag (?awakened) — default off for safe rollout.
     * Rollup cannot prune this branch; use import.meta.env for zero bundle cost later.
     */
    awakenedPersistence: hasUrlFlag('awakened'),
    /** Shared multiplayer presence UI + networking (opt-in join; no traffic until joined). */
    get presence(): boolean {
        return isPresenceFeatureEnabled();
    },
    /**
     * In-browser generative soundtrack (?generative=1 or ?music=generative).
     * Drives music-reactivity from sequencer events instead of FFT/VU analysis.
     */
    generativeMusic: hasUrlFlag('generative') || getUrlFlag('music') === 'generative',
    /** Cinematic photo mode (?photo=1 or ?mode=photo). */
    photoMode: hasUrlFlag('photo') || getUrlFlag('mode') === 'photo',
} as const;

// Log active overrides once at startup so the console makes the state obvious.
if (typeof window !== 'undefined') {
    const disabled = Object.entries(FEATURE_FLAGS)
        .filter(([, v]) => !v)
        .map(([k]) => k);
    if (disabled.length > 0) {
        console.warn(`[FeatureFlags] Disabled via URL: ${disabled.join(', ')}`);
    }
}
