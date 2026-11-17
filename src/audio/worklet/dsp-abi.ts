/**
 * The garden DSP module's numbers: parameter ids, enum values and limits,
 * mirrored from emscripten/dsp/garden_dsp.cpp. The function signatures are
 * generated (`DspExports` in src/utils/native-exports.generated.ts); these are
 * not, so tests/dsp-render.test.mjs checks them against the built module
 * (counts, limits, and every patch default read back through dsp_get_patch).
 *
 * Import-free on purpose: the AudioWorklet bundle and the main thread both use it.
 */

/** Frames per dsp_render call (the Web Audio render quantum). */
export const DSP_QUANTUM = 128;
export const DSP_MAX_VOICES = 64;
export const DSP_MAX_PATCHES = 32;

/**
 * Patch id ranges. A patch is a slot in the module's patch table; whoever
 * owns a range writes its slots at startup (GardenAudioEngine `patches`).
 */
export const PATCH_RANGE = {
    /** One per generative channel (src/audio/generative/dsp-patches.ts). */
    generative: { first: 0, count: 8 },
    /** Free for garden flora and effects. */
    free: { first: 8, count: 24 },
} as const;

export const DspEngine = { Wavetable: 0, Fm: 1, Kick: 2, Noise: 3 } as const;
export const DspWave = { Sine: 0, Triangle: 1, Saw: 2, Square: 3, Glass: 4, Organ: 5 } as const;
export const DspFilter = { Off: 0, Lowpass: 1, Bandpass: 2, Highpass: 3 } as const;
/** Ducked voices dip under the beat duck; sources trigger it and are not ducked. */
export const DspDuck = { Ducked: 0, Source: 1, Bypass: 2 } as const;

/**
 * Patch parameters in C++ `PatchParam` order (the index is the id).
 * Times are seconds (decay and release are T60: the time to fall 60 dB),
 * cutoff is Hz, filterEnv is octaves the envelope opens the filter by,
 * keyTrack 0..1 makes the cutoff follow pitch, detune is cents for the second
 * oscillator, fmIndex is radians, pitchStart is the kick's start/end pitch ratio.
 */
export const PATCH_PARAMS = [
    'engine',
    'wave',
    'gain',
    'attack',
    'decay',
    'sustain',
    'release',
    'filterMode',
    'cutoff',
    'resonance',
    'filterEnv',
    'keyTrack',
    'detune',
    'osc2Mix',
    'fmRatio',
    'fmIndex',
    'fmDecay',
    'pitchStart',
    'pitchDecay',
    'reverbSend',
    'duck',
] as const;

export type PatchParamName = (typeof PATCH_PARAMS)[number];

/** A patch as the parameters that differ from PATCH_DEFAULTS. */
export type PatchSpec = Partial<Record<PatchParamName, number>>;

/** setPatchDefaults() in garden_dsp.cpp: every patch slot after dsp_init. */
export const PATCH_DEFAULTS: Readonly<Record<PatchParamName, number>> = {
    engine: DspEngine.Wavetable,
    wave: DspWave.Sine,
    gain: 0.3,
    attack: 0.005,
    decay: 0.3,
    sustain: 0.7,
    release: 0.2,
    filterMode: DspFilter.Off,
    cutoff: 8000,
    resonance: 0.1,
    filterEnv: 0,
    keyTrack: 0,
    detune: 0,
    osc2Mix: 0,
    fmRatio: 2,
    fmIndex: 0,
    fmDecay: 0.5,
    pitchStart: 1,
    pitchDecay: 0.1,
    reverbSend: 0.2,
    duck: DspDuck.Ducked,
};

/**
 * Global parameters in C++ `GlobalParam` order. brightness is octaves added to
 * every filter cutoff; duckDepth 0..1 is how far the duck bus dips; duckRelease
 * is its T60 recovery in seconds.
 */
export const GLOBAL_PARAMS = [
    'masterGain',
    'reverbRoom',
    'reverbDamp',
    'reverbWet',
    'duckDepth',
    'duckRelease',
    'brightness',
] as const;

export type GlobalParamName = (typeof GLOBAL_PARAMS)[number];

/** setGlobalDefaults() in garden_dsp.cpp. */
export const GLOBAL_DEFAULTS: Readonly<Record<GlobalParamName, number>> = {
    masterGain: 0.8,
    reverbRoom: 0.5,
    reverbDamp: 0.5,
    reverbWet: 0.25,
    duckDepth: 0,
    duckRelease: 0.18,
    brightness: 0,
};

export function patchParamId(name: PatchParamName): number {
    return PATCH_PARAMS.indexOf(name);
}

export function globalParamId(name: GlobalParamName): number {
    return GLOBAL_PARAMS.indexOf(name);
}
