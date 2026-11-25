/**
 * @file src/audio/garden/player.ts
 * @brief Plays the sequencer's notes on the audio clock and reports each step when it is heard
 * (Music Garden slice B).
 *
 * Two ways to be on time:
 * - **Riding the soundtrack.** While the generative engine runs, `scheduleStep` is called from
 *   its schedule listener with the step's exact AudioContext time, so planted notes share the
 *   soundtrack's grid, tempo and swing-free sixteenths. Visuals are released by the engine's
 *   heard-step listener (`fireDue`), the same path the grove composer uses.
 * - **Keeping its own time.** With a tracker module playing, or no music, `run` drives a
 *   `GardenClock` at the tracker's tempo (`lockBeat` trims it to the tracker's beat) or the
 *   biome's. Visuals fire when the audio clock, less the output latency, reaches each step.
 *
 * Either way a step's notes go to the audio thread the moment it is scheduled, up to 200 ms
 * before they sound, and the plants' visuals wait in a small queue until the step is heard, so
 * the light lands on the note, not on the moment it was queued.
 *
 * No DOM, no Three.js: the output and the heard callback are injected, so the tests drive it with
 * a fake clock and recording sinks.
 */

import type { GardenOutput } from '../generative/generative-engine.ts';
import { GardenClock } from './clock.ts';
import { GardenSequencer, type GardenNote } from './sequencer.ts';
import { playGardenNote } from './voices.ts';

/** Steps scheduled but not yet heard: a few at most (the lookahead is about one step). */
const QUEUE_CAPACITY = 32;
/** Notes one step can hold (`GARDEN_MAX_PLANTS`, with room for a doubled chime). */
const NOTES_PER_STEP = 48;

/** A step whose notes are with the audio thread and whose visuals are waiting to be heard. */
interface QueuedStep {
    time: number;
    step: number;
    count: number;
    ids: string[];
    instruments: string[];
    velocities: number[];
}

/** What a heard step tells the visuals: which plants played, how hard. Arrays are reused. */
export interface HeardStep {
    step: number;
    count: number;
    ids: readonly string[];
    velocities: readonly number[];
}

export type HeardCallback = (heard: HeardStep) => void;

export class GardenPlayer {
    readonly clock = new GardenClock();
    private readonly queue: QueuedStep[] = [];
    private head = 0;
    private size = 0;
    private readonly heard: HeardStep = { step: 0, count: 0, ids: [], velocities: [] };
    /** Notes sent to each path since the last `resetStats` (diagnostics and tests). */
    readonly sent = { dsp: 0, synth: 0, steps: 0 };

    constructor(
        readonly sequencer: GardenSequencer,
        private readonly output: () => GardenOutput | null,
        private readonly onHeard: HeardCallback
    ) {
        for (let i = 0; i < QUEUE_CAPACITY; i++) {
            this.queue.push({
                time: 0,
                step: 0,
                count: 0,
                ids: new Array<string>(NOTES_PER_STEP).fill(''),
                instruments: new Array<string>(NOTES_PER_STEP).fill(''),
                velocities: new Array<number>(NOTES_PER_STEP).fill(0),
            });
        }
    }

    /** Steps waiting to be heard. */
    get pending(): number {
        return this.size;
    }

    /**
     * Queue `step`'s notes at AudioContext time `time` (`stepSec` is a sixteenth). Returns how
     * many notes it sent: 0 when no plant plays on it or there is no output yet.
     */
    scheduleStep(time: number, step: number, stepSec: number): number {
        const out = this.output();
        if (!out) return 0;
        const notes = this.sequencer.notesAt(step);
        if (notes.length === 0) return 0;
        if (this.size === QUEUE_CAPACITY) this.dropOldest();
        const slot = this.queue[(this.head + this.size) % QUEUE_CAPACITY];
        this.size++;
        slot.time = time;
        slot.step = step;
        let count = 0;
        for (let i = 0; i < notes.length && i < NOTES_PER_STEP; i++) {
            const n = notes[i];
            this.send(out, n, time, stepSec);
            slot.ids[count] = n.plantId;
            slot.instruments[count] = n.instrument;
            slot.velocities[count] = n.velocity;
            count++;
        }
        slot.count = count;
        this.sent.steps++;
        return count;
    }

    private send(out: GardenOutput, n: GardenNote, time: number, stepSec: number): void {
        const path = playGardenNote(
            out,
            n.instrument,
            n.midi,
            n.velocity,
            time,
            n.steps * stepSec,
            n.pan
        );
        this.sent[path]++;
    }

    /** Own clock: queue every step due before `now` + lookahead at `bpm`. */
    run(now: number, bpm: number): number {
        return this.clock.run(now, bpm, (time, step, stepSec) =>
            this.scheduleStep(time, step, stepSec)
        );
    }

    /**
     * Report every queued step whose time the listener has reached. Own clock: every frame, with
     * the audio clock less the output latency. Riding the soundtrack: when the engine's heard-step
     * listener fires (it fires exactly when the soundtrack's own step is heard), with the same
     * `heardNow`, so a planted note lights up with the step it sits on.
     */
    fireDue(heardNow: number): void {
        while (this.size > 0 && this.queue[this.head].time <= heardNow) this.fireOldest();
    }

    /** Forget everything queued: the mode changed, or the player is being torn down. */
    clear(): void {
        this.head = 0;
        this.size = 0;
    }

    resetStats(): void {
        this.sent.dsp = 0;
        this.sent.synth = 0;
        this.sent.steps = 0;
    }

    private dropOldest(): void {
        this.head = (this.head + 1) % QUEUE_CAPACITY;
        this.size--;
    }

    private fireOldest(): void {
        const slot = this.queue[this.head];
        this.head = (this.head + 1) % QUEUE_CAPACITY;
        this.size--;
        const h = this.heard;
        h.step = slot.step;
        h.count = slot.count;
        h.ids = slot.ids;
        h.velocities = slot.velocities;
        try {
            this.onHeard(h);
        } catch (err) {
            console.warn('[Garden] Heard-step callback failed:', err);
        }
    }
}
