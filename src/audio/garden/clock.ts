/**
 * @file src/audio/garden/clock.ts
 * @brief The garden's own sixteenth-note clock on the audio clock (Music Garden slice B).
 *
 * Used whenever the generative engine is not the one keeping time: a tracker module is playing,
 * or no music is. (While the soundtrack runs, the sequencer rides the engine's own grid
 * instead, so planted notes land on the soundtrack's steps; see `player.ts`.)
 *
 * Same discipline as `GenerativeEngine.update()`: steps are queued up to `aheadSec` ahead of the
 * audio clock on an exact grid, so a main-thread hitch shorter than that moves no note; a hitch
 * longer than `maxLateSec` skips the missed steps (keeping the bar position) instead of playing
 * them in a burst.
 *
 * No Web Audio, no DOM: time is whatever the caller passes, so tests drive it deterministically.
 */

import { GARDEN_STEPS } from '../../world/document/garden-flora.ts';

/** As `SCHEDULE_AHEAD_SEC` / `MAX_LATE_SEC` in `generative-engine.ts`. */
export const GARDEN_AHEAD_SEC = 0.2;
export const GARDEN_MAX_LATE_SEC = 0.4;
const START_LEAD_SEC = 0.05;
/** A beat observed this far (as a fraction of a step) off the grid is pulled in, not ignored. */
const LOCK_TOLERANCE = 0.08;
/** Each observed beat closes this much of the error: a jittery observation cannot yank the grid. */
const LOCK_GAIN = 0.25;
/** ...and never moves the next step by more than this fraction of a step at once. */
const LOCK_MAX_NUDGE = 0.1;

export type GardenStepEmitter = (time: number, step: number, stepSec: number) => void;

export function stepSeconds(bpm: number): number {
    return 60 / (Math.max(20, Math.min(300, bpm || 120)) * 4);
}

export class GardenClock {
    /** AudioContext time of the next step to queue. */
    nextTime = 0;
    /** The sixteenth (0..15) that step is. */
    step = 0;
    private started = false;
    /** The beat phase still has to be matched to a tracker beat (the first lock after `unlock`). */
    private needsPhase = true;
    private locked = false;

    constructor(
        private readonly aheadSec = GARDEN_AHEAD_SEC,
        private readonly maxLateSec = GARDEN_MAX_LATE_SEC
    ) {}

    /** Forget the position: the next `run` starts a bar `START_LEAD_SEC` after its `now`. */
    reset(): void {
        this.started = false;
        this.step = 0;
        this.needsPhase = true;
        this.locked = false;
    }

    get isLocked(): boolean {
        return this.locked;
    }

    /**
     * Queue every step due before `now + aheadSec` at `bpm`. Returns how many it queued.
     * `emit(time, step, stepSec)` receives each one in order.
     */
    run(now: number, bpm: number, emit: GardenStepEmitter): number {
        const stepSec = stepSeconds(bpm);
        if (!this.started) {
            this.started = true;
            this.nextTime = now + START_LEAD_SEC;
            this.step = 0;
        } else if (now - this.nextTime > this.maxLateSec) {
            // Fell far behind (a long hitch, a background tab): skip, but stay on the bar.
            const resume = now + START_LEAD_SEC;
            const skipped = Math.ceil((resume - this.nextTime) / stepSec);
            this.step = (this.step + skipped) % GARDEN_STEPS;
            this.nextTime += skipped * stepSec;
        }
        let queued = 0;
        const horizon = now + this.aheadSec;
        while (this.nextTime <= horizon) {
            emit(this.nextTime, this.step, stepSec);
            this.nextTime += stepSec;
            this.step = (this.step + 1) % GARDEN_STEPS;
            queued++;
        }
        return queued;
    }

    /**
     * The tracker's beat boundary was observed at audio time `time` (`BeatSync.onBeat`). The first
     * one after `reset`/`unlock` also puts the bar's downbeat on a beat; later ones only trim the
     * grid's timing, a fraction of the error at a time, so the garden follows the tracker's tempo
     * without a jolt. Returns the nudge applied to the next step (seconds).
     */
    lockBeat(time: number, bpm: number): number {
        if (!this.started) return 0;
        const stepSec = stepSeconds(bpm);
        // Nearest grid point to `time`, counted in steps from the next one to be queued.
        const n = Math.round((time - this.nextTime) / stepSec);
        const gridTime = this.nextTime + n * stepSec;
        if (this.needsPhase) {
            this.needsPhase = false;
            // Step index the grid has at `time`; make it a multiple of 4 (a beat).
            const at = (((this.step + n) % GARDEN_STEPS) + GARDEN_STEPS) % GARDEN_STEPS;
            this.step = (this.step - (at % 4) + GARDEN_STEPS) % GARDEN_STEPS;
        }
        this.locked = true;
        const error = time - gridTime;
        if (Math.abs(error) <= LOCK_TOLERANCE * stepSec) return 0;
        const limit = LOCK_MAX_NUDGE * stepSec;
        const nudge = Math.max(-limit, Math.min(limit, error * LOCK_GAIN));
        this.nextTime += nudge;
        return nudge;
    }

    /** The tracker stopped: keep running free, and match the phase again next time. */
    unlock(): void {
        this.needsPhase = true;
        this.locked = false;
    }
}
