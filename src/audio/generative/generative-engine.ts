import type { ChannelData, VisualState } from '../audio-system-core.ts';
import { decayTowards, noteToFreq } from '../audio-system-core.ts';
import {
    getBiomeProfile,
    blendProfiles,
    _blendScratch,
    type BiomeMusicProfile,
} from './biome-profiles.ts';
import { GenerativeSequencer, NUM_CHANNELS, CHANNEL_VOICES, STEPS_PER_BAR } from './sequencer.ts';
import { SynthVoice } from './synth-voice.ts';
import { noteNameToChromaticIndex } from './scales.ts';

export type GenerativeNoteCallback = (note: string, velocity: number, channelIndex: number) => void;

export interface GenerativeEngineOptions {
    seed?: number;
    /** Initial biome tag. */
    biome?: string;
}

/**
 * In-browser generative soundtrack engine.
 * Drives visualState directly from the sequencer (no FFT) and synthesizes
 * audio through the shared AudioSystem master bus.
 */
export class GenerativeEngine {
    private ctx: AudioContext | null = null;
    private busGain: GainNode | null = null;
    private synth: SynthVoice | null = null;
    private sequencer: GenerativeSequencer;
    private readonly visualState: VisualState;
    private readonly channelScratch: ChannelData[];
    private readonly chromaticBands: number[][];

    private isRunning = false;
    private stepAccumulator = 0;
    private dayNightBias = 0.5;
    private targetBiome = 'global';
    private previousBiome = 'global';
    private biomeBlend = 1.0;
    private activeProfile: BiomeMusicProfile;
    private onNoteCallback: GenerativeNoteCallback | null = null;
    private readonly seed: number;
    private masterVolume = 1.0;

    constructor(options: GenerativeEngineOptions = {}) {
        this.seed = options.seed ?? 0xca4d0001;
        this.targetBiome = options.biome ?? 'global';
        this.previousBiome = this.targetBiome;
        this.activeProfile = getBiomeProfile(this.targetBiome);
        this.sequencer = new GenerativeSequencer(this.seed, this.activeProfile);

        this.chromaticBands = [];
        for (let i = 0; i < NUM_CHANNELS; i++) {
            this.chromaticBands.push(new Array(12).fill(0));
        }

        this.channelScratch = [];
        for (let i = 0; i < NUM_CHANNELS; i++) {
            this.channelScratch.push({
                volume: 0,
                pan: 0,
                trigger: 0,
                note: '',
                freq: 0,
                instrument: 0,
                activeEffect: 0,
                effectValue: 0,
                notes: this.chromaticBands[i],
            });
        }

        this.visualState = {
            beatPhase: 0,
            kickTrigger: 0,
            grooveAmount: 0,
            activeChannels: NUM_CHANNELS,
            channelData: this.channelScratch,
            bpm: this.activeProfile.tempo,
            patternIndex: 0,
            row: 0,
        };
    }

    /** Wire into AudioSystem graph (reuse master bus). */
    attach(audioContext: AudioContext, masterGain: GainNode): void {
        this.ctx = audioContext;
        this.busGain = masterGain;
        this.synth = new SynthVoice(audioContext, masterGain, 800 + this.activeProfile.brightness * 7200);
    }

    onNote(cb: GenerativeNoteCallback): void {
        this.onNoteCallback = cb;
    }

    setMasterVolume(vol: number): void {
        this.masterVolume = Math.max(0, Math.min(1, vol));
    }

    /** Update biome crossfade target (call each frame from game loop). */
    setBiomeContext(biomeId: string, blendT = 1.0): void {
        if (biomeId !== this.targetBiome && blendT >= 0.99) {
            this.previousBiome = this.targetBiome;
            this.targetBiome = biomeId;
            this.biomeBlend = 0;
        } else if (biomeId !== this.targetBiome) {
            this.previousBiome = this.targetBiome;
            this.targetBiome = biomeId;
            this.biomeBlend = 0;
        } else {
            this.biomeBlend = Math.min(1, this.biomeBlend + 0.015);
        }

        const from = getBiomeProfile(this.previousBiome);
        const to = getBiomeProfile(this.targetBiome);
        blendProfiles(from, to, this.biomeBlend, _blendScratch);
        this.activeProfile = _blendScratch;
        this.sequencer.setProfile(this.activeProfile);
        this.synth?.setBrightness(this.activeProfile.brightness);
    }

    setDayNightBias(bias: number): void {
        this.dayNightBias = bias;
    }

    async start(): Promise<void> {
        if (!this.ctx || !this.busGain || !this.synth) return;
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        this.isRunning = true;
    }

    stop(): void {
        this.isRunning = false;
    }

    get running(): boolean {
        return this.isRunning;
    }

    getVisualState(): VisualState {
        return this.visualState;
    }

    getTitle(): string {
        return `Generative · ${this.activeProfile.mood}`;
    }

    /** Per-frame update — advances sequencer, schedules audio, updates channel data. */
    update(deltaSec: number): VisualState {
        if (!this.isRunning) {
            return this.decayVisuals(deltaSec);
        }

        const bpm = this.sequencer.getBpm(this.dayNightBias);
        this.visualState.bpm = bpm;
        this.visualState.grooveAmount = this.activeProfile.groove;

        const stepDuration = 60 / (bpm * 4); // 16th note seconds
        this.stepAccumulator += deltaSec;

        while (this.stepAccumulator >= stepDuration) {
            this.stepAccumulator -= stepDuration;
            this.processStep();
        }

        this.visualState.beatPhase = this.sequencer.getBeatPhase(this.dayNightBias);
        this.visualState.row = this.sequencer.getRow();
        this.visualState.patternIndex = this.sequencer.getPatternIndex();

        return this.decayVisuals(deltaSec);
    }

    private processStep(): void {
        const events = this.sequencer.tick(this.dayNightBias);
        const ctx = this.ctx;
        const synth = this.synth;
        const when = ctx ? ctx.currentTime + 0.02 : 0;
        const stepDuration = ctx
            ? 60 / (this.visualState.bpm * 4)
            : 0.125;

        let anyKick = false;

        for (const ev of events) {
            const ch = ev.channel;
            const dest = this.channelScratch[ch];
            const vol = ev.velocity / 127;
            dest.volume = vol * this.masterVolume;
            dest.trigger = 1.0;
            // Pseudo-MIDI for mapNoteToColor (pitch class via % 12); callback gets full name
            dest.note = String(60 + noteNameToChromaticIndex(ev.note));
            dest.freq = noteToFreq(ev.note);

            if (ch === 0) anyKick = true;

            const bandIdx = noteNameToChromaticIndex(ev.note);
            const bands = this.chromaticBands[ch];
            for (let i = 0; i < 12; i++) bands[i] *= 0.5;
            bands[bandIdx] = vol;

            const voice = CHANNEL_VOICES[ch];
            const noteLen = voice.length * stepDuration;

            if (synth && ctx && this.masterVolume > 0) {
                const pan = (ch % 2 === 0 ? -1 : 1) * 0.25 * (ch / NUM_CHANNELS);
                synth.playNote(ev.note, ch, ev.velocity, when, noteLen, pan);
            }

            if (this.onNoteCallback) {
                this.onNoteCallback(ev.note, ev.velocity, ch);
            }
        }

        if (anyKick) {
            this.visualState.kickTrigger = 1.0;
        }
    }

    private decayVisuals(deltaSec: number): VisualState {
        this.visualState.kickTrigger = decayTowards(this.visualState.kickTrigger, 0, 8, deltaSec);
        for (let i = 0; i < NUM_CHANNELS; i++) {
            const ch = this.channelScratch[i];
            ch.trigger = decayTowards(ch.trigger, 0, 10, deltaSec);
            ch.volume = decayTowards(ch.volume, 0, 6, deltaSec);
            if (ch.trigger < 0.02) ch.note = '';
        }
        return this.visualState;
    }
}

export { NUM_CHANNELS, STEPS_PER_BAR };
