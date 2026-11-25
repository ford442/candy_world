import { FEATURE_FLAGS } from '../../core/config.ts';
import type { SeasonMusicModifier } from '../../systems/environment/season-core.ts';
import type { ChannelData, VisualState } from '../audio-system-core.ts';
import { decayTowards, noteToFreq } from '../audio-system-core.ts';
import {
    getBiomeProfile,
    blendProfiles,
    _blendScratch,
    type BiomeMusicProfile,
} from './biome-profiles.ts';
import { ENGINE_PATCHES } from './dsp-patches.ts';
import { noteNameToChromaticIndex } from './scales.ts';
import { applySeasonMusicModifier } from './season-music.ts';
import {
    GenerativeSequencer,
    NUM_CHANNELS,
    CHANNEL_VOICES,
    STEPS_PER_BAR,
    authoredNote,
    AUTHORED_VELOCITY,
    type AuthoredPattern,
    type NoteEvent,
} from './sequencer.ts';
import { SynthVoice } from './synth-voice.ts';
import { DspVoiceSink, type GardenNoteTarget, type GenerativeVoiceSink } from './voice-sink.ts';

export type GenerativeNoteCallback = (note: string, velocity: number, channelIndex: number) => void;
/** A step is heard: its row and the notes it played (the array is reused; copy what you keep). */
export type GenerativeStepListener = (row: number, events: readonly NoteEvent[]) => void;
/**
 * A step is being queued for the audio thread: `time` is its AudioContext time, `step` the
 * sixteenth of the bar it plays (0..15, the `step` of its NoteEvents; a step listener's `row` is
 * the one after it) and `stepSec` the length of a sixteenth. Fired for every step, notes or
 * not, up to SCHEDULE_AHEAD_SEC before it is heard. The garden sequencer schedules its notes on
 * the same grid through this (`audio/garden/`).
 */
export type GenerativeScheduleListener = (time: number, step: number, stepSec: number) => void;

/** What the garden sequencer plays through: the engine's context, bus and voices. */
export interface GardenOutput {
    readonly ctx: AudioContext;
    /** The DSP engine while it is loaded and healthy, else null. */
    readonly dsp: GardenNoteTarget | null;
    /** The Web Audio fallback voices (what plays when `dsp` is null). */
    readonly synth: GenerativeVoiceSink;
    /** The shared master bus. */
    readonly destination: AudioNode;
}

export interface GenerativeEngineOptions {
    seed?: number;
    /** Initial biome tag. */
    biome?: string;
}

export interface GenerativeAttachOptions {
    /** Play through the garden DSP worklet when it loads (default: FEATURE_FLAGS.gardenDsp). */
    dsp?: boolean;
    /** The fallback voices (default: a SynthVoice on the master bus). Tests and offline renders pass their own. */
    fallback?: GenerativeVoiceSink;
}

/**
 * Steps are queued this far ahead of the audio clock, so a main-thread hitch
 * shorter than this (shader warmup, chunk streaming) moves no note. Visuals
 * fire when a step is heard, not when it is queued, so the lookahead is
 * invisible; it only delays a tempo change by this much. At 120 ms, boot-time
 * stalls still made a few notes late in a production build; 200 ms absorbed them.
 */
export const SCHEDULE_AHEAD_SEC = 0.2;
/** A step this far behind the clock (a long hitch, a background tab) is skipped, not played in a burst. */
export const MAX_LATE_SEC = 0.4;
/** First step this long after start(). */
const START_LEAD_SEC = 0.05;
/** start() waits at most this long for the DSP worklet before falling back to SynthVoice. */
const DSP_LOAD_TIMEOUT_MS = 5000;
/** Steps scheduled but not yet heard (a few at most: SCHEDULE_AHEAD_SEC is about one step). */
const STEP_QUEUE_CAPACITY = 64;

/** A step whose notes are queued for the audio thread; its visuals fire when it is heard. */
interface ScheduledStep {
    time: number;
    row: number;
    patternIndex: number;
    beatPhase: number;
    events: NoteEvent[];
}

/**
 * In-browser generative soundtrack engine.
 * Drives visualState directly from the sequencer (no FFT) and synthesizes
 * audio through the shared AudioSystem master bus: the garden DSP worklet
 * when it is available, Web Audio nodes (SynthVoice) otherwise.
 *
 * Timing: update() runs at frame rate but schedules every step on the audio
 * clock up to SCHEDULE_AHEAD_SEC ahead, and fires each step's visuals and note
 * callbacks only once ctx.currentTime (less the output latency) reaches it.
 */
export class GenerativeEngine {
    private ctx: AudioContext | null = null;
    private busGain: GainNode | null = null;
    private synth: GenerativeVoiceSink | null = null;
    private dsp: DspVoiceSink | null = null;
    private dspLoading: Promise<void> | null = null;
    private sequencer: GenerativeSequencer;
    private readonly visualState: VisualState;
    private readonly channelScratch: ChannelData[];
    private readonly chromaticBands: number[][];

    private isRunning = false;
    /** Audio-clock time of the next step to schedule. */
    private nextStepTime = 0;
    /** Fallback clock (seconds of update() deltas) when there is no AudioContext. */
    private clock = 0;
    private readonly stepQueue: ScheduledStep[] = [];
    private stepHead = 0;
    private stepCount = 0;
    private dayNightBias = 0.5;
    private targetBiome = 'global';
    private previousBiome = 'global';
    private biomeBlend = 1.0;
    private activeProfile: BiomeMusicProfile;
    private onNoteCallback: GenerativeNoteCallback | null = null;
    private readonly stepListeners: GenerativeStepListener[] = [];
    private readonly scheduleListeners: GenerativeScheduleListener[] = [];
    private readonly seed: number;
    private masterVolume = 1.0;
    /** Season shaping applied after every biome blend; identity until the game loop sets it. */
    private readonly seasonMod: SeasonMusicModifier = {
        tempoScale: 1,
        brightnessShift: 0,
        densityScale: 1,
        reverbWet: 0,
    };

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
                freq: 0,
                instrument: 0,
                activeEffect: 0,
                effectValue: 0,
                note: '',
                notes: this.chromaticBands[i],
            });
        }

        for (let i = 0; i < STEP_QUEUE_CAPACITY; i++) {
            this.stepQueue.push({ time: 0, row: 0, patternIndex: 0, beatPhase: 0, events: [] });
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

    /** Wire into AudioSystem graph (reuse master bus); starts loading the DSP worklet. */
    attach(
        audioContext: AudioContext,
        masterGain: GainNode,
        options: GenerativeAttachOptions = {}
    ): void {
        this.ctx = audioContext;
        this.busGain = masterGain;
        this.synth =
            options.fallback ??
            new SynthVoice(audioContext, masterGain, 800 + this.activeProfile.brightness * 7200);
        if (options.dsp ?? FEATURE_FLAGS.gardenDsp) {
            this.dspLoading = this.loadDsp(audioContext, masterGain);
        }
    }

    private async loadDsp(ctx: AudioContext, destination: AudioNode): Promise<void> {
        try {
            const { GardenAudioEngine } = await import('../worklet/garden-engine.ts');
            const engine = await GardenAudioEngine.create(ctx, destination, {
                patches: ENGINE_PATCHES,
            });
            if (engine) this.useDspSink(new DspVoiceSink(engine));
        } catch (err) {
            console.warn('[GenerativeEngine] DSP worklet failed to load; using SynthVoice:', err);
        }
    }

    /** The sink notes go to: the DSP worklet while it is healthy, else SynthVoice. */
    private voiceSink(): GenerativeVoiceSink | null {
        if (this.dsp && this.dsp.healthy) return this.dsp;
        return this.synth;
    }

    /** Which voices play right now (diagnostics, tests). */
    get voiceBackend(): 'dsp' | 'synth' | 'none' {
        const sink = this.voiceSink();
        return sink === null ? 'none' : sink === this.dsp ? 'dsp' : 'synth';
    }

    /** Use `sink` as the DSP path (it is what loadDsp() installs). Offline renders and tests. */
    useDspSink(sink: DspVoiceSink): void {
        this.dspLoading = null;
        sink.setBrightness(this.activeProfile.brightness);
        sink.setReverbWet(this.seasonMod.reverbWet);
        this.dsp = sink;
    }

    onNote(cb: GenerativeNoteCallback): void {
        this.onNoteCallback = cb;
    }

    /** Observe every heard step (after its visuals and note callbacks). Returns an unsubscribe. */
    addStepListener(listener: GenerativeStepListener): () => void {
        this.stepListeners.push(listener);
        return () => {
            const i = this.stepListeners.indexOf(listener);
            if (i >= 0) this.stepListeners.splice(i, 1);
        };
    }

    /** Observe every step as it is queued (see `GenerativeScheduleListener`). Returns an unsubscribe. */
    addScheduleListener(listener: GenerativeScheduleListener): () => void {
        this.scheduleListeners.push(listener);
        return () => {
            const i = this.scheduleListeners.indexOf(listener);
            if (i >= 0) this.scheduleListeners.splice(i, 1);
        };
    }

    /**
     * What the garden's planted flora play through, or null before `attach()`. In a build without
     * the worklet (`?no_dsp`, no wasm, a failed load) `dsp` is null and the garden plays through
     * `synth`, as the soundtrack does.
     */
    get gardenOutput(): GardenOutput | null {
        if (!this.ctx || !this.busGain || !this.synth) return null;
        const dsp = this.dsp && this.dsp.healthy ? this.dsp.engine : null;
        return { ctx: this.ctx, dsp, synth: this.synth, destination: this.busGain };
    }

    /**
     * Play an authored pattern (a music stone's, `systems/composer/`) instead of the generated
     * one, or resume generating with null. Same bus, voices, visuals and note callbacks.
     */
    setAuthoredPattern(pattern: AuthoredPattern | null): void {
        this.sequencer.setAuthoredPattern(pattern);
    }

    get playingAuthored(): boolean {
        return this.sequencer.playingAuthored;
    }

    /** The key, scale and tempo notes resolve against right now. */
    getActiveProfile(): Readonly<BiomeMusicProfile> {
        return this.activeProfile;
    }

    /**
     * Sound one authored cell right away (the composer's audition of a single key). Returns the
     * note name, or null when there is nothing to play it on.
     */
    previewNote(channel: number, degree: number): string | null {
        if (degree < 0 || channel < 0 || channel >= NUM_CHANNELS) return null;
        const note = authoredNote(this.activeProfile, channel, degree);
        const sink = this.ctx && this.masterVolume > 0 ? this.voiceSink() : null;
        if (!sink || !this.ctx) return note;
        const stepDuration = 60 / (this.sequencer.getBpm(this.dayNightBias) * 4);
        const len = Math.max(1, CHANNEL_VOICES[channel].length) * stepDuration;
        sink.playNote(note, channel, AUTHORED_VELOCITY, this.ctx.currentTime + 0.01, len, 0);
        return note;
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
        applySeasonMusicModifier(_blendScratch, this.seasonMod);
        this.activeProfile = _blendScratch;
        this.sequencer.setProfile(this.activeProfile);
        this.synth?.setBrightness(this.activeProfile.brightness);
        this.synth?.setReverbWet(this.seasonMod.reverbWet);
        this.dsp?.setBrightness(this.activeProfile.brightness);
        this.dsp?.setReverbWet(this.seasonMod.reverbWet);
    }

    /** Season shaping (systems/environment/season-core.ts); takes effect at the next biome update. */
    setSeasonModifier(mod: Readonly<SeasonMusicModifier>): void {
        this.seasonMod.tempoScale = mod.tempoScale;
        this.seasonMod.brightnessShift = mod.brightnessShift;
        this.seasonMod.densityScale = mod.densityScale;
        this.seasonMod.reverbWet = mod.reverbWet;
    }

    setDayNightBias(bias: number): void {
        this.dayNightBias = bias;
    }

    async start(): Promise<void> {
        if (!this.ctx || !this.busGain || !this.synth) return;
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        if (this.dspLoading) {
            const loading = this.dspLoading;
            this.dspLoading = null;
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
                loading,
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, DSP_LOAD_TIMEOUT_MS);
                }),
            ]);
            clearTimeout(timer);
        }
        if (!this.isRunning) {
            this.nextStepTime = this.now() + START_LEAD_SEC;
            this.stepCount = 0;
        }
        this.isRunning = true;
    }

    stop(): void {
        if (this.isRunning) this.voiceSink()?.allOff?.();
        this.isRunning = false;
        this.stepCount = 0;
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

    private now(): number {
        return this.ctx ? this.ctx.currentTime : this.clock;
    }

    /** Time the listener is hearing now: the audio clock less the output latency. */
    private heardNow(now: number): number {
        const ctx = this.ctx;
        if (!ctx) return now;
        const latency = ctx.outputLatency || ctx.baseLatency || 0;
        return now - Math.max(0, Math.min(0.2, latency));
    }

    /** Per-frame update — schedules steps ahead on the audio clock, fires the ones now heard. */
    update(deltaSec: number): VisualState {
        this.clock += deltaSec;
        if (!this.isRunning) {
            return this.decayVisuals(deltaSec);
        }

        const bpm = this.sequencer.getBpm(this.dayNightBias);
        this.visualState.bpm = bpm;
        this.visualState.grooveAmount = this.activeProfile.groove;

        const now = this.now();
        if (now - this.nextStepTime > MAX_LATE_SEC) {
            // Fell far behind (a long hitch or a background tab): skip the missed
            // steps rather than play them all at once.
            this.nextStepTime = now + START_LEAD_SEC;
        }
        const stepDuration = 60 / (bpm * 4); // 16th note seconds
        const horizon = now + (this.ctx ? SCHEDULE_AHEAD_SEC : 0);
        while (this.nextStepTime <= horizon) {
            this.scheduleStep(this.nextStepTime, stepDuration);
            this.nextStepTime += stepDuration;
        }

        this.fireDueSteps(this.heardNow(now));
        return this.decayVisuals(deltaSec);
    }

    /** Advance the sequencer one step: its notes go to the audio thread now, its visuals wait. */
    private scheduleStep(time: number, stepDuration: number): void {
        const events = this.sequencer.tick(this.dayNightBias);
        if (this.stepCount === STEP_QUEUE_CAPACITY) this.fireOldestStep();
        const slot = this.stepQueue[(this.stepHead + this.stepCount) % STEP_QUEUE_CAPACITY];
        this.stepCount++;
        slot.time = time;
        slot.row = this.sequencer.getRow();
        slot.patternIndex = this.sequencer.getPatternIndex();
        slot.beatPhase = this.sequencer.getBeatPhase(this.dayNightBias);
        slot.events.length = 0;

        // slot.row is the sequencer's position after this tick (the next sixteenth); the step
        // that plays at `time` is the one before it, the `step` of its NoteEvents.
        const playedStep = (slot.row + STEPS_PER_BAR - 1) % STEPS_PER_BAR;
        for (let i = 0; i < this.scheduleListeners.length; i++) {
            try {
                this.scheduleListeners[i](time, playedStep, stepDuration);
            } catch (err) {
                console.warn('[GenerativeEngine] Schedule listener failed:', err);
            }
        }

        const sink = this.ctx && this.masterVolume > 0 ? this.voiceSink() : null;
        for (const ev of events) {
            slot.events.push(ev);
            if (!sink) continue;
            const ch = ev.channel;
            const noteLen = CHANNEL_VOICES[ch].length * stepDuration;
            const pan = (ch % 2 === 0 ? -1 : 1) * 0.25 * (ch / NUM_CHANNELS);
            sink.playNote(ev.note, ch, ev.velocity, time, noteLen, pan);
        }
    }

    private fireDueSteps(heardNow: number): void {
        while (this.stepCount > 0 && this.stepQueue[this.stepHead].time <= heardNow) {
            this.fireOldestStep();
        }
    }

    private fireOldestStep(): void {
        const slot = this.stepQueue[this.stepHead];
        this.stepHead = (this.stepHead + 1) % STEP_QUEUE_CAPACITY;
        this.stepCount--;
        this.applyStepVisuals(slot);
    }

    private applyStepVisuals(slot: ScheduledStep): void {
        let anyKick = false;

        for (const ev of slot.events) {
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

            if (this.onNoteCallback) {
                this.onNoteCallback(ev.note, ev.velocity, ch);
            }
        }
        for (let i = 0; i < this.stepListeners.length; i++) {
            try {
                this.stepListeners[i](slot.row, slot.events);
            } catch (err) {
                console.warn('[GenerativeEngine] Step listener failed:', err);
            }
        }
        slot.events.length = 0;

        if (anyKick) {
            this.visualState.kickTrigger = 1.0;
        }
        this.visualState.beatPhase = slot.beatPhase;
        this.visualState.row = slot.row;
        this.visualState.patternIndex = slot.patternIndex;
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
