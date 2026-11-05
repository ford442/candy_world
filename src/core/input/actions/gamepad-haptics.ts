/**
 * Beat haptics (#2027 slice 2): a light dual-rumble on kick drums, and a
 * stronger one that gameplay can ask for (`pulse('strong')`).
 *
 * Off by default (`settings.gamepad.haptics`). Two audio signals drive it:
 *
 * - The kick: `onAudioFrame()` reads the audio's `kickTrigger` every frame.
 *   Both the tracker and the generative engine set it to 1 on a hit and let it
 *   decay, so a rise is a kick. Kicks rarely land on the beat-phase wrap (by
 *   then `kickTrigger` has usually decayed), so the wrap alone can't be the
 *   trigger.
 * - The beat: `onBeat()` (a `BeatCallback`, from `BeatSync`) opens one slot
 *   per beat. At most one effect is queued per beat, whichever asks first.
 *
 * With no music playing, strong pulses are spaced by `MIN_GAP_MS` instead.
 * Pads without `vibrationActuator` are skipped, and a rejected `playEffect`
 * never throws.
 */

import type { ActionLayer } from './action-layer.ts';

/** The part of `GamepadHapticActuator` this uses. */
export interface RumbleActuator {
    playEffect?(
        type: 'dual-rumble',
        params: {
            duration: number;
            startDelay?: number;
            strongMagnitude: number;
            weakMagnitude: number;
        }
    ): unknown;
}

export interface RumblePad {
    readonly vibrationActuator?: RumbleActuator | null;
}

/** A rise in `kickTrigger` to at least this is a kick (it jumps to 1 on a hit). */
export const KICK_THRESHOLD = 0.5;

const EFFECTS = {
    kick: { duration: 60, strongMagnitude: 0.08, weakMagnitude: 0.35 },
    strong: { duration: 160, strongMagnitude: 0.6, weakMagnitude: 0.8 },
} as const;

export type PulseKind = keyof typeof EFFECTS;

/** Two effects never start closer than this, beat or no beat. */
export const MIN_GAP_MS = 120;
/** No beat for this long: the music stopped, and the per-beat slot no longer applies. */
const BEAT_STALE_MS = 1500;

export class BeatHaptics {
    /** This beat already rumbled. */
    private slotUsed = false;
    private lastBeatAt = -Infinity;
    private lastAt = -Infinity;
    private prevKick = 0;

    constructor(
        private readonly layer: ActionLayer,
        private readonly pads: () => readonly RumblePad[],
        private readonly now: () => number = () => globalThis.performance?.now() ?? Date.now()
    ) {}

    enabled(): boolean {
        return this.layer.getSettings().gamepad.haptics;
    }

    /** A `BeatCallback`: a new beat, so a new slot for one effect. */
    readonly onBeat = (): void => {
        this.slotUsed = false;
        this.lastBeatAt = this.now();
    };

    /** Once per frame with the audio's visual state: a rising `kickTrigger` rumbles. */
    onAudioFrame(state: { kickTrigger?: number } | null | undefined): void {
        const kick = state?.kickTrigger ?? 0;
        const rose = kick > this.prevKick && kick >= KICK_THRESHOLD;
        this.prevKick = kick;
        if (rose) this.pulse('kick', kick);
    }

    /**
     * Rumble every connected pad once. Returns how many actuators were asked;
     * 0 when off, when this beat already rumbled, or when no pad can.
     */
    pulse(kind: PulseKind, intensity = 1): number {
        if (!this.enabled()) return 0;
        const t = this.now();
        const beating = t - this.lastBeatAt < BEAT_STALE_MS;
        if ((this.slotUsed && beating) || t - this.lastAt < MIN_GAP_MS) return 0;
        const e = EFFECTS[kind];
        const k = Math.max(0, Math.min(1, intensity));
        let played = 0;
        for (const pad of this.pads()) {
            const act = pad.vibrationActuator;
            if (!act || typeof act.playEffect !== 'function') continue;
            try {
                const r = act.playEffect('dual-rumble', {
                    duration: e.duration,
                    startDelay: 0,
                    strongMagnitude: e.strongMagnitude * k,
                    weakMagnitude: e.weakMagnitude * k,
                });
                // A pad unplugged mid-effect rejects; nothing to do about it.
                if (r && typeof (r as Promise<unknown>).catch === 'function') {
                    (r as Promise<unknown>).catch(() => {});
                }
                played++;
            } catch {
                // Some pads expose the actuator but throw on effects they lack.
            }
        }
        if (played > 0) {
            this.slotUsed = true;
            this.lastAt = t;
        }
        return played;
    }
}
