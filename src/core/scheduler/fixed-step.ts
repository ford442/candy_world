// src/core/scheduler/fixed-step.ts
// Accumulator for the scheduler's `fixed` phase (#1973). Pure arithmetic, no
// clock reads: the same sequence of frame deltas always yields the same steps,
// which is what replay and shared-world lockstep (#1975) build on.

export const DEFAULT_FIXED_DT = 1 / 60;
export const DEFAULT_MAX_SUBSTEPS = 5;

export class FixedStepClock {
    readonly fixedDt: number;
    readonly maxSubsteps: number;
    /** Seconds of simulation owed but not yet stepped, always in [0, fixedDt). */
    private accumulator = 0;
    /** Fixed steps taken since construction. */
    tick = 0;
    /** Seconds dropped because a frame needed more than `maxSubsteps` steps. */
    droppedSeconds = 0;

    constructor(fixedDt = DEFAULT_FIXED_DT, maxSubsteps = DEFAULT_MAX_SUBSTEPS) {
        if (!(fixedDt > 0)) throw new Error(`FixedStepClock: fixedDt must be > 0 (got ${fixedDt})`);
        this.fixedDt = fixedDt;
        this.maxSubsteps = Math.max(1, Math.floor(maxSubsteps));
    }

    /**
     * Add one frame's delta and return how many fixed steps to run now. When a
     * hitch owes more than `maxSubsteps`, the excess is dropped rather than
     * carried, so the simulation slows down instead of spiralling.
     */
    advance(dt: number): number {
        if (dt > 0) this.accumulator += dt;
        let steps = 0;
        while (this.accumulator >= this.fixedDt && steps < this.maxSubsteps) {
            this.accumulator -= this.fixedDt;
            steps++;
        }
        if (this.accumulator >= this.fixedDt) {
            const keep = this.accumulator % this.fixedDt;
            this.droppedSeconds += this.accumulator - keep;
            this.accumulator = keep;
        }
        return steps;
    }

    /** Interpolation weight between the previous and current fixed state, in [0, 1). */
    get alpha(): number {
        return this.accumulator / this.fixedDt;
    }

    reset(): void {
        this.accumulator = 0;
        this.tick = 0;
        this.droppedSeconds = 0;
    }
}
