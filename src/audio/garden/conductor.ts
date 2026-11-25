/**
 * @file src/audio/garden/conductor.ts
 * @brief Decides how the garden keeps time and runs it each frame (Music Garden slice B).
 *
 * Three modes, from what the audio system is doing:
 * - **generative**: the soundtrack is running. The garden rides its grid: the engine's schedule
 *   listener gives each step's exact time, and its heard-step listener releases the plants'
 *   visuals when that step is heard. Key and tempo are the engine's (the biome blend and season
 *   it is already playing).
 * - **tracker**: a module is playing (the generative engine does not run then). The garden keeps
 *   its own `GardenClock` at the tracker's tempo, and every beat `BeatSync` reports (`onBeat`)
 *   trims the clock so planted notes stay on the tracker's beat. The lock is to the tempo and
 *   the beat the visuals follow: the tracker's own rows are not exposed with audio times.
 * - **idle**: no music. The garden plays on its own clock at the biome's tempo, scaled by the
 *   season.
 *
 * In the last two the key is the biome's at the player's feet. Notes go to the DSP worklet when
 * it is healthy and to `SynthVoice` otherwise (`voices.ts`). If the generative engine was never
 * created (a tracker file from the start) the conductor asks the audio system to build and attach
 * it, without starting the soundtrack, so the worklet loads.
 *
 * Everything the world and the audio system provide is injected (`ConductorDeps`), so the tests
 * drive the real mode logic with fakes.
 */

import type { GardenOutput, GenerativeScheduleListener } from '../generative/generative-engine.ts';
import type { NoteName } from '../generative/scales.ts';
import { GardenPlayer, type HeardCallback } from './player.ts';
import {
    GardenSequencer,
    type GardenKey,
    type GardenListener,
    type GardenPlant,
} from './sequencer.ts';

export type GardenMode = 'generative' | 'tracker' | 'idle';

/** How often the live plants are rescanned and the nearest ones re-chosen (s). */
export const GARDEN_SCAN_INTERVAL = 0.25;

/** The slice of `GenerativeEngine` the garden uses. */
export interface GardenEngineLike {
    readonly gardenOutput: GardenOutput | null;
    getActiveProfile(): Readonly<{ root: NoteName; scale: readonly number[]; tempo: number }>;
    addScheduleListener(listener: GenerativeScheduleListener): () => void;
    addStepListener(listener: () => void): () => void;
}

/** The slice of `AudioSystem` the garden uses. */
export interface GardenAudioLike {
    readonly generativeEngine: GardenEngineLike | null;
    readonly audioContext: unknown;
    readonly musicSourceMode: 'tracker' | 'generative';
    readonly isPlaying: boolean;
    readonly visualState: { readonly bpm: number };
    isGenerativeActive(): boolean;
    ensureGenerativeEngine(): Promise<unknown>;
}

/** The slice of `BeatSync` the garden uses. */
export interface GardenBeatsLike {
    onBeat(cb: (state: { bpm: number }) => void): void;
    offBeat(cb: (state: { bpm: number }) => void): void;
}

export interface GardenPlantView extends GardenPlant {
    /** The live object, for the visuals. */
    object: unknown;
}

export interface ConductorDeps {
    audio(): GardenAudioLike | null;
    beats(): GardenBeatsLike | null;
    /** Every live garden plant (the world scan). */
    plants(): Iterable<GardenPlantView>;
    /** The biome's key and tempo at a point, for the modes that do not follow the engine. */
    biomeKey(
        x: number,
        z: number
    ): Readonly<{ root: NoteName; scale: readonly number[]; tempo: number }>;
    /** Season tempo scale (1 = unchanged) for the idle clock. */
    seasonTempoScale(): number;
    /** A heard step: these plants played now (visuals). */
    onHeard(plants: ReadonlyArray<{ object: unknown; id: string; velocity: number }>): void;
}

export interface GardenFrame {
    dt: number;
    x: number;
    z: number;
    /** Right-hand direction on the ground (unit length); the camera's. */
    rightX: number;
    rightZ: number;
}

const MAX_LATENCY = 0.2;
const FALLBACK_BPM = 100;

export class GardenConductor {
    readonly sequencer = new GardenSequencer();
    readonly player: GardenPlayer;
    mode: GardenMode = 'idle';

    private scanAcc = GARDEN_SCAN_INTERVAL;
    private objects = new Map<string, unknown>();
    private haveBeats = false;
    private engine: GardenEngineLike | null = null;
    private unlisten: Array<() => void> = [];
    private ensuring = false;
    private lastOutput: GardenOutput | null = null;
    private beatBpm = FALLBACK_BPM;
    private lastX = 0;
    private lastZ = 0;
    private readonly heardScratch: Array<{ object: unknown; id: string; velocity: number }> = [];

    private readonly onBeat = (state: { bpm: number }): void => {
        const out = this.lastOutput;
        if (this.mode !== 'tracker' || !out) return;
        this.beatBpm = state.bpm > 0 ? state.bpm : this.beatBpm;
        this.player.clock.lockBeat(out.ctx.currentTime, this.beatBpm);
    };

    constructor(private readonly deps: ConductorDeps) {
        const heard: HeardCallback = (h) => {
            const list = this.heardScratch;
            list.length = 0;
            for (let i = 0; i < h.count; i++) {
                const object = this.objects.get(h.ids[i]);
                if (object !== undefined) {
                    list.push({ object, id: h.ids[i], velocity: h.velocities[i] });
                }
            }
            if (list.length > 0) this.deps.onHeard(list);
        };
        this.player = new GardenPlayer(this.sequencer, () => this.lastOutput, heard);
    }

    /** Time the listener is hearing now: the audio clock less the output latency. */
    private heardNow(out: GardenOutput): number {
        const ctx = out.ctx;
        const latency = ctx.outputLatency || ctx.baseLatency || 0;
        return ctx.currentTime - Math.max(0, Math.min(MAX_LATENCY, latency));
    }

    private subscribe(engine: GardenEngineLike | null): void {
        if (engine === this.engine) return;
        for (const off of this.unlisten) off();
        this.unlisten = [];
        this.engine = engine;
        this.player.clear();
        if (!engine) return;
        this.unlisten.push(
            engine.addScheduleListener((time, step, stepSec) => {
                if (this.mode === 'generative') this.player.scheduleStep(time, step, stepSec);
            }),
            engine.addStepListener(() => {
                const out = this.lastOutput;
                if (this.mode === 'generative' && out) this.player.fireDue(this.heardNow(out));
            })
        );
    }

    private setMode(mode: GardenMode): void {
        if (mode === this.mode) return;
        this.mode = mode;
        this.player.clear();
        // An own clock starts on a bar of its own; a lock is only good while the tracker plays.
        this.player.clock.reset();
    }

    private scan(frame: GardenFrame): void {
        const views: GardenPlantView[] = [];
        const objects = new Map<string, unknown>();
        for (const view of this.deps.plants()) {
            views.push(view);
            objects.set(view.id, view.object);
        }
        this.objects = objects;
        const listener: GardenListener = {
            x: frame.x,
            z: frame.z,
            rightX: frame.rightX,
            rightZ: frame.rightZ,
        };
        this.sequencer.setPlants(views, listener);
    }

    /** One frame: rescan the plants a few times a second, pick the mode, keep the clock. */
    update(frame: GardenFrame): void {
        const audio = this.deps.audio();
        this.lastX = frame.x;
        this.lastZ = frame.z;
        this.scanAcc += frame.dt;
        if (this.scanAcc >= GARDEN_SCAN_INTERVAL) {
            this.scanAcc = 0;
            this.scan(frame);
        }
        if (!audio) return;
        if (this.objects.size === 0) {
            // Nothing planted: stay out of the audio system's way entirely.
            if (this.player.pending > 0) this.player.clear();
            return;
        }

        const engine = audio.generativeEngine;
        if (!engine && audio.audioContext && !this.ensuring) {
            // A tracker file from the start never built the engine; it carries the DSP worklet.
            this.ensuring = true;
            audio.ensureGenerativeEngine().then(
                () => {
                    this.ensuring = false;
                },
                (err: unknown) => {
                    console.warn('[Garden] Could not prepare the audio engine:', err);
                    // Try again in a while rather than every frame.
                    setTimeout(() => {
                        this.ensuring = false;
                    }, 5000);
                }
            );
        }
        this.subscribe(engine);
        const out = engine?.gardenOutput ?? null;
        this.lastOutput = out;
        if (!engine || !out) return;

        const generative = audio.isGenerativeActive();
        const tracker = !generative && audio.musicSourceMode === 'tracker' && audio.isPlaying;
        this.setMode(generative ? 'generative' : tracker ? 'tracker' : 'idle');

        // Key: the soundtrack's while it plays, else the biome at the player's feet.
        const profile = generative
            ? engine.getActiveProfile()
            : this.deps.biomeKey(frame.x, frame.z);
        const key: GardenKey = { root: profile.root, scale: profile.scale };
        this.sequencer.setKey(key);

        if (generative) return; // the engine's listeners drive the steps
        if (out.ctx.state !== 'running') return; // no gesture yet, or suspended

        if (tracker && !this.haveBeats) {
            const beats = this.deps.beats();
            if (beats) {
                beats.onBeat(this.onBeat);
                this.haveBeats = true;
            }
        }
        const trackerBpm = audio.visualState.bpm;
        const bpm = tracker
            ? trackerBpm > 0
                ? trackerBpm
                : FALLBACK_BPM
            : profile.tempo * this.deps.seasonTempoScale();
        this.beatBpm = bpm;
        this.player.run(out.ctx.currentTime, bpm);
        this.player.fireDue(this.heardNow(out));
    }

    /** What the garden is doing (diagnostics; `window.__gardenStats()` in a live page). */
    stats(): {
        mode: GardenMode;
        /** Plants in the world scan (any distance). */
        scanned: number;
        /** Plants close enough to sound. */
        plants: number;
        listener: { x: number; z: number };
        voices: 'dsp' | 'synth' | 'none';
        sent: { dsp: number; synth: number; steps: number };
        pending: number;
        locked: boolean;
    } {
        const out = this.lastOutput;
        return {
            mode: this.mode,
            scanned: this.objects.size,
            plants: this.sequencer.playing,
            listener: { x: this.lastX, z: this.lastZ },
            voices: out ? (out.dsp ? 'dsp' : 'synth') : 'none',
            sent: { ...this.player.sent },
            pending: this.player.pending,
            locked: this.player.clock.isLocked,
        };
    }

    dispose(): void {
        for (const off of this.unlisten) off();
        this.unlisten = [];
        if (this.haveBeats) this.deps.beats()?.offBeat(this.onBeat);
        this.haveBeats = false;
        this.player.clear();
    }
}
