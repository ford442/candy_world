/**
 * @file src/audio/garden/voices.ts
 * @brief Where a planted note sounds: the garden DSP worklet, or SynthVoice without it.
 *
 * `playGardenNote` picks per note: while `GardenOutput.dsp` is set (the worklet loaded and
 * healthy) the note goes to the engine's garden patch (`GARDEN_PATCH`, `dsp-patches.ts`); in a
 * `?no_dsp` build, with no `candy_dsp.wasm`, after a worklet failure or before it has loaded, it
 * goes to the soundtrack's own `SynthVoice` (`out.synth`): chimes and the kick through its
 * generative channels, the snare and hat through a short filtered noise burst (SynthVoice has no
 * noise voice a channel can reach).
 *
 * The same `GardenOutput` the generative engine plays through, so the garden sits on the same
 * master bus and moves with the same volume.
 */

import { GARDEN_PATCH, type GardenInstrument } from '../generative/dsp-patches.ts';
import type { GardenOutput } from '../generative/generative-engine.ts';
import { CHROMATIC } from '../generative/scales.ts';

/** SynthVoice channels (`CHANNEL_VOICES`): 0 is the kick, 4 a high sine pluck. */
const SYNTH_CHANNEL: Record<'chime' | 'kick', number> = { chime: 4, kick: 0 };

/** Note name (`C#4`) of a MIDI number, the form `SynthVoice.playNote` takes. */
export function midiToNoteName(midi: number): string {
    const m = Math.max(0, Math.min(127, Math.round(midi)));
    return `${CHROMATIC[m % 12]}${Math.floor(m / 12) - 1}`;
}

/** Noise bursts for the fallback snare and hat, one shared buffer per context. */
const _noise = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
    let buf = _noise.get(ctx);
    if (!buf) {
        const length = Math.floor(ctx.sampleRate * 0.4);
        buf = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buf.getChannelData(0);
        // Seeded, so the fallback drums sound the same on every client.
        let seed = 0x9a7d3c11;
        for (let i = 0; i < length; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            data[i] = seed / 2147483648 - 1;
        }
        _noise.set(ctx, buf);
    }
    return buf;
}

function synthNoiseDrum(
    out: GardenOutput,
    instrument: 'snare' | 'hat',
    velocity: number,
    when: number,
    pan: number
): void {
    const ctx = out.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const snare = instrument === 'snare';
    filter.type = snare ? 'bandpass' : 'highpass';
    filter.frequency.setValueAtTime(snare ? 2400 : 7500, when);
    filter.Q.value = snare ? 0.9 : 0.7;
    const len = snare ? 0.16 : 0.05;
    const peak = velocity * (snare ? 0.3 : 0.16);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, when + len);
    src.connect(filter);
    filter.connect(gain);
    if (Math.abs(pan) > 0.01) {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), when);
        gain.connect(panner);
        panner.connect(out.destination);
    } else {
        gain.connect(out.destination);
    }
    src.start(when);
    src.stop(when + len + 0.05);
}

/**
 * Sound one planted note at AudioContext time `when`. `velocity` is 0..1, `durationSec` how long
 * it is held. Returns which path took it, for diagnostics and tests.
 */
export function playGardenNote(
    out: GardenOutput,
    instrument: GardenInstrument,
    midi: number,
    velocity: number,
    when: number,
    durationSec: number,
    pan: number
): 'dsp' | 'synth' {
    if (out.dsp) {
        out.dsp.noteOn(when, GARDEN_PATCH[instrument], midi, velocity, durationSec, pan);
        return 'dsp';
    }
    if (instrument === 'snare' || instrument === 'hat') {
        synthNoiseDrum(out, instrument, velocity, when, pan);
    } else {
        out.synth.playNote(
            midiToNoteName(midi),
            SYNTH_CHANNEL[instrument],
            Math.round(velocity * 127),
            when,
            durationSec,
            pan
        );
    }
    return 'synth';
}
