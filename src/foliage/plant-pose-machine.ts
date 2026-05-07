/**
 * plant-pose-machine.ts
 *
 * Per-plant ADSR envelope state machine for day/night pose transitions.
 *
 * Design constraints:
 * - Zero per-frame heap allocations: all state kept in flat Float32Array buffers (SoA layout).
 * - Envelope drives a single float "pose value" per instance (0 = rest/night, 1 = peak/day-bloom).
 * - Day/night bias from the world clock shifts the baseline pose even when music is silent.
 * - Channel intensity from the music reactivity pipeline triggers attack/release.
 */

export interface PlantPoseConfig {
    /** Rate at which envelopeLevel ramps toward 1.0 per second when channel is active. */
    attackRate: number;
    /** Rate at which envelopeLevel falls back toward 0.0 per second when channel is inactive. */
    releaseRate: number;
    /** Fraction of dayTarget held at peak envelope (0–1). */
    sustainLevel: number;
    /** Pose value representing full "day bloom" / active target. */
    dayTarget: number;
    /** Pose value representing "night rest" / quiet baseline. */
    nightTarget: number;
    /** Minimum channel intensity that triggers the attack phase. */
    triggerThreshold: number;
    /**
     * Audio channel index to read for intensity.
     * -1 means the batcher determines the source itself (e.g. arpeggio detection).
     */
    channelIndex?: number;
}

/**
 * ADSR-style pose envelope for one plant type.
 *
 * State is stored in three parallel Float32Arrays — one slot per instance.
 * The `update` method iterates all active slots in a single for-loop with no
 * object allocations, satisfying the zero-GC-per-frame requirement.
 */
export class PlantPoseMachine {
    /** Current smoothed pose output read by the batcher. */
    private readonly _currentPose: Float32Array;
    /** Computed target pose for this frame (baseline + envelope contribution). */
    private readonly _targetPose: Float32Array;
    /**
     * Envelope level per instance [0, 1]:
     * rises toward 1 at attackRate when channel is active,
     * falls toward 0 at releaseRate when channel is inactive.
     */
    private readonly _envelopeLevel: Float32Array;

    readonly capacity: number;

    constructor(capacity: number) {
        this.capacity = capacity;
        this._currentPose = new Float32Array(capacity);
        this._targetPose = new Float32Array(capacity);
        this._envelopeLevel = new Float32Array(capacity);
    }

    /**
     * Advance all active instance envelopes by one frame.
     *
     * @param count          Number of active instances (≤ capacity).
     * @param delta          Frame delta in seconds.
     * @param channelIntensity  Normalised channel energy [0, 1] shared for this batcher.
     * @param dayNightBias   World-clock scalar: 0 = full night, 1 = full day.
     * @param config         Per-plant-type envelope constants.
     */
    update(
        count: number,
        delta: number,
        channelIntensity: number,
        dayNightBias: number,
        config: PlantPoseConfig
    ): void {
        const { attackRate, releaseRate, sustainLevel, dayTarget, nightTarget, triggerThreshold } = config;

        // Day/night baseline: the resting pose even when music is silent.
        const baseline = nightTarget + (dayTarget - nightTarget) * dayNightBias;

        // Peak pose when the envelope is fully engaged.
        const envelopePeak = dayTarget * sustainLevel;

        // Smooth-step factor for currentPose → targetPose lerp.
        // Clamp to [0,1] so large delta values don't overshoot.
        const lerpK = Math.min(1.0, attackRate * delta);

        for (let i = 0; i < count; i++) {
            // --- Envelope advance (attack / release) ---
            if (channelIntensity > triggerThreshold) {
                this._envelopeLevel[i] += attackRate * delta;
                if (this._envelopeLevel[i] > 1.0) this._envelopeLevel[i] = 1.0;
            } else {
                this._envelopeLevel[i] -= releaseRate * delta;
                if (this._envelopeLevel[i] < 0.0) this._envelopeLevel[i] = 0.0;
            }

            // --- Target pose: baseline shifted by envelope contribution ---
            this._targetPose[i] = baseline + (envelopePeak - baseline) * this._envelopeLevel[i];

            // --- Smooth currentPose toward targetPose ---
            this._currentPose[i] += (this._targetPose[i] - this._currentPose[i]) * lerpK;
        }
    }

    /** Read the current (smoothed) pose value for instance `index`. */
    getPose(index: number): number {
        return this._currentPose[index];
    }

    /** Hard-reset an instance slot (e.g. on unregister / re-register). */
    reset(index: number, value: number = 0): void {
        this._currentPose[index] = value;
        this._targetPose[index] = value;
        this._envelopeLevel[index] = 0;
    }
}
