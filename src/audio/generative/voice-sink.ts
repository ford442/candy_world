import type { GlobalParamName } from '../worklet/dsp-abi.ts';
import {
    BASE_REVERB_WET,
    GENERATIVE_GLOBALS,
    brightnessOctaves,
    generativePatch,
} from './dsp-patches.ts';
import { noteNameToMidi } from './scales.ts';

/**
 * Where the generative engine sends notes. Two implementations: SynthVoice
 * (Web Audio nodes per note, the fallback) and DspVoiceSink (the garden DSP
 * AudioWorklet). `when` is AudioContext time; velocity is 0..127.
 */
export interface GenerativeVoiceSink {
    playNote(
        note: string,
        channel: number,
        velocity: number,
        when: number,
        durationSec: number,
        pan?: number
    ): void;
    setBrightness(brightness: number): void;
    setReverbWet(wet: number): void;
    /** Drop notes scheduled ahead and release what is sounding (stop). */
    allOff?(): void;
    /** False when the sink broke and the engine should use its fallback. */
    readonly healthy?: boolean;
}

/**
 * The part of GardenAudioEngine a sink needs. Tests implement it over an
 * EventRing drained by GardenDspHost, so the real module renders offline.
 */
export interface GardenNoteTarget {
    readonly healthy: boolean;
    noteOn(
        time: number,
        patch: number,
        note: number,
        velocity: number,
        durationSec: number,
        pan?: number,
        tag?: number
    ): boolean;
    setGlobal(name: GlobalParamName, value: number): void;
    allOff(): void;
}

export class DspVoiceSink implements GenerativeVoiceSink {
    readonly engine: GardenNoteTarget;
    private brightness = -1;
    private reverbWet = -1;

    constructor(engine: GardenNoteTarget) {
        this.engine = engine;
        for (const [name, value] of Object.entries(GENERATIVE_GLOBALS)) {
            engine.setGlobal(name as GlobalParamName, value);
        }
        this.setReverbWet(0);
    }

    get healthy(): boolean {
        return this.engine.healthy;
    }

    playNote(
        note: string,
        channel: number,
        velocity: number,
        when: number,
        durationSec: number,
        pan = 0
    ): void {
        const midi = noteNameToMidi(note);
        if (midi < 0) return;
        this.engine.noteOn(when, generativePatch(channel), midi, velocity / 127, durationSec, pan);
    }

    setBrightness(brightness: number): void {
        // Called every frame during biome blends; only send changes.
        if (Math.abs(brightness - this.brightness) < 1e-3) return;
        this.brightness = brightness;
        this.engine.setGlobal('brightness', brightnessOctaves(brightness));
    }

    /** Season reverb (0..~0.3, winter most) on top of the base room. */
    setReverbWet(wet: number): void {
        const w = Math.max(0, Math.min(1, wet));
        if (Math.abs(w - this.reverbWet) < 1e-3) return;
        this.reverbWet = w;
        this.engine.setGlobal('reverbWet', BASE_REVERB_WET + w);
        this.engine.setGlobal(
            'reverbRoom',
            Math.min(0.9, (GENERATIVE_GLOBALS.reverbRoom ?? 0.5) + w)
        );
    }

    allOff(): void {
        this.engine.allOff();
    }
}
