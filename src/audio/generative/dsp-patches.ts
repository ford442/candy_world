import {
    DspDuck,
    DspEngine,
    DspFilter,
    DspWave,
    PATCH_RANGE,
    type GlobalParamName,
    type PatchSpec,
} from '../worklet/dsp-abi.ts';
import { NUM_CHANNELS } from './sequencer.ts';

/**
 * The generative soundtrack's instruments on the garden DSP engine: one patch
 * per sequencer channel (CHANNEL_VOICES roles), in PATCH_RANGE.generative.
 * Each keeps its channel's SynthVoice waveform and register; the engine adds
 * real envelopes, a detuned saw pad, FM bells and a kick that ducks the pads.
 */
export const GENERATIVE_PATCH_BASE = PATCH_RANGE.generative.first;

/** Patch slot for sequencer channel `ch`. */
export function generativePatch(ch: number): number {
    return GENERATIVE_PATCH_BASE + Math.max(0, Math.min(NUM_CHANNELS - 1, ch));
}

/** Patch specs by channel (CHANNEL_VOICES order). */
export const GENERATIVE_CHANNEL_PATCHES: readonly PatchSpec[] = [
    // 0 kick: sine swept down from 3.5x to the key's root, triggers the duck
    {
        engine: DspEngine.Kick,
        gain: 0.55,
        attack: 0.002,
        decay: 0.32,
        sustain: 0,
        release: 0.05,
        pitchStart: 3.5,
        pitchDecay: 0.14,
        reverbSend: 0.04,
        duck: DspDuck.Source,
    },
    // 1 lead pad: triangle, gently filtered
    {
        wave: DspWave.Triangle,
        gain: 0.3,
        attack: 0.02,
        decay: 0.8,
        sustain: 0.55,
        release: 0.35,
        filterMode: DspFilter.Lowpass,
        cutoff: 2400,
        resonance: 0.25,
        filterEnv: 0.5,
        reverbSend: 0.25,
    },
    // 2 melody: sine carrier with a soft, decaying FM edge
    {
        engine: DspEngine.Fm,
        gain: 0.28,
        attack: 0.008,
        decay: 0.5,
        sustain: 0.45,
        release: 0.3,
        fmRatio: 1,
        fmIndex: 0.8,
        fmDecay: 0.35,
        reverbSend: 0.3,
    },
    // 3 arpeggio A: triangle pluck, filter snaps open on each note
    {
        wave: DspWave.Triangle,
        gain: 0.24,
        attack: 0.002,
        decay: 0.22,
        sustain: 0.1,
        release: 0.12,
        filterMode: DspFilter.Lowpass,
        cutoff: 1800,
        resonance: 0.3,
        filterEnv: 1.5,
        reverbSend: 0.3,
    },
    // 4 arpeggio B: glass pluck an octave up
    {
        wave: DspWave.Glass,
        gain: 0.16,
        attack: 0.002,
        decay: 0.35,
        sustain: 0,
        release: 0.1,
        filterMode: DspFilter.Lowpass,
        cutoff: 5000,
        reverbSend: 0.4,
    },
    // 5 pad / hue: two detuned saws, slow swell, pumps under the kick
    {
        wave: DspWave.Saw,
        gain: 0.18,
        attack: 0.25,
        decay: 1.5,
        sustain: 0.6,
        release: 0.9,
        detune: 9,
        osc2Mix: 0.7,
        filterMode: DspFilter.Lowpass,
        cutoff: 1200,
        resonance: 0.2,
        filterEnv: 0.8,
        reverbSend: 0.35,
    },
    // 6 global shimmer: inharmonic FM bell
    {
        engine: DspEngine.Fm,
        gain: 0.14,
        attack: 0.005,
        decay: 0.8,
        sustain: 0,
        release: 0.4,
        fmRatio: 3.5,
        fmIndex: 2,
        fmDecay: 0.25,
        reverbSend: 0.6,
    },
    // 7 global hue: sine blip
    {
        wave: DspWave.Sine,
        gain: 0.18,
        attack: 0.003,
        decay: 0.25,
        sustain: 0,
        release: 0.1,
        reverbSend: 0.45,
    },
];

/** [slot, spec] pairs for GardenAudioEngine.create({ patches }). */
export const GENERATIVE_PATCHES: ReadonlyArray<readonly [number, PatchSpec]> =
    GENERATIVE_CHANNEL_PATCHES.map((spec, ch) => [generativePatch(ch), spec] as const);

/** Engine-wide settings while the generative soundtrack plays. */
export const GENERATIVE_GLOBALS: Readonly<Partial<Record<GlobalParamName, number>>> = {
    masterGain: 0.8,
    duckDepth: 0.35,
    duckRelease: 0.22,
    reverbRoom: 0.55,
    reverbDamp: 0.45,
};

/** Reverb wet with no season shaping: the engine's reverb is cheap, so there is always a little room. */
export const BASE_REVERB_WET = 0.1;

/**
 * SynthVoice's filter is 800 + brightness * 7200 Hz; the DSP expresses the
 * same thing as octaves over each patch's own cutoff (2400 Hz on the filtered
 * channels, SynthVoice's default), so a biome sounds as bright on either path.
 */
export function brightnessOctaves(brightness: number): number {
    const hz = 800 + Math.max(0, Math.min(1, brightness)) * 7200;
    return Math.log2(hz / 2400);
}
