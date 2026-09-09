/**
 * Fauna behaviour framework — spawn policy + state machine on top of the
 * existing boids slab.
 *
 * This layer does NOT simulate motion. `assembly/boids.ts` (or its JS mirror)
 * remains the authority for position and velocity; the runner here reads that
 * slab, decides which `FaunaState` each critter is in, and writes back at most
 * a velocity nudge:
 *
 *   - **Flee**  — a one-shot radial impulse away from the player, then a
 *                 hold timer so the flock keeps its distance for a beat.
 *   - **Perch** / **Idle** — per-frame velocity damping so the critter settles
 *                 instead of drifting. Boids re-accelerates it on the way out.
 *   - **Roam**  — nothing at all; the boid rules run untouched.
 *
 * Everything species-specific lives in a `FaunaSpeciesProfile`, so adding a
 * species is one registry entry plus geometry in the batcher. See docs/FAUNA.md.
 *
 * Allocation: the runner sizes its parallel arrays once in `resize()` and
 * allocates nothing per frame — no closures, no temporaries.
 */

import { FAUNA_BOID_STRIDE, FaunaSpecies, FaunaState, type FaunaSpawnEntry } from './types.ts';

/**
 * Tuning for one species' behaviour. Registered once at module load;
 * `updateFaunaBehaviors` reads it by species id every frame.
 */
export interface FaunaSpeciesProfile {
    species: FaunaSpecies;
    /** Human label — logs, debug overlay, docs. */
    label: string;
    /** Player distance (m) that flips a roaming critter into Flee. */
    scatterRadius: number;
    /**
     * Player distance (m) it must reach before Flee can end. Must be greater
     * than `scatterRadius`: the gap is the hysteresis band that stops a critter
     * hovering on the boundary from re-triggering every frame.
     */
    calmRadius: number;
    /** Horizontal speed (m/s) added away from the player on the scatter frame. */
    scatterImpulse: number;
    /** Vertical speed (m/s) added on scatter — hop for ground species, lift for flyers. */
    scatterLift: number;
    /** Seconds Flee is held after the last trigger, even once out of range. */
    fleeDuration: number;
    /** Minimum seconds between two impulses on the same critter. */
    scatterCooldown: number;
    /** Whether this species may enter Perch (a settled, ground/roost pose). */
    canPerch: boolean;
    /** Probability per second of leaving Roam for Perch or Idle. */
    settleChancePerSecond: number;
    /** Seconds spent settled, sampled uniformly from [min, max]. */
    settleDurationMin: number;
    settleDurationMax: number;
    /** Velocity multiplier applied per frame while settled (1 = no damping). */
    settleDamping: number;
}

/** Built-in profiles. Order is irrelevant; lookup is by `species` id. */
const _profiles = new Map<FaunaSpecies, FaunaSpeciesProfile>();

/**
 * Register (or replace) a species profile. Call before `FaunaSystem.init()`;
 * a species with no profile roams and never reacts.
 */
export function registerFaunaSpecies(profile: FaunaSpeciesProfile): void {
    if (profile.calmRadius <= profile.scatterRadius) {
        console.warn(
            `[Fauna] "${profile.label}" calmRadius must exceed scatterRadius — ` +
                'without a hysteresis band it will re-trigger every frame.'
        );
    }
    _profiles.set(profile.species, profile);
}

export function getFaunaSpeciesProfile(species: FaunaSpecies): FaunaSpeciesProfile | undefined {
    return _profiles.get(species);
}

/** Every registered profile, for docs/debug tooling. */
export function listFaunaSpeciesProfiles(): FaunaSpeciesProfile[] {
    return [..._profiles.values()];
}

registerFaunaSpecies({
    species: FaunaSpecies.GumdropBeetle,
    label: 'Gumdrop Beetle',
    scatterRadius: 4.5,
    calmRadius: 8.0,
    scatterImpulse: 3.2,
    scatterLift: 0,
    fleeDuration: 1.6,
    scatterCooldown: 0.9,
    canPerch: false,
    settleChancePerSecond: 0.18,
    settleDurationMin: 1.5,
    settleDurationMax: 4.0,
    settleDamping: 0.82,
});

registerFaunaSpecies({
    species: FaunaSpecies.JellybeanHopper,
    label: 'Jellybean Hopper',
    scatterRadius: 6.0,
    calmRadius: 11.0,
    scatterImpulse: 6.0,
    scatterLift: 3.0,
    fleeDuration: 1.2,
    scatterCooldown: 0.7,
    canPerch: false,
    settleChancePerSecond: 0.1,
    settleDurationMin: 0.8,
    settleDurationMax: 2.0,
    settleDamping: 0.85,
});

registerFaunaSpecies({
    species: FaunaSpecies.SugarMoth,
    label: 'Sugar Moth',
    scatterRadius: 5.0,
    calmRadius: 9.0,
    scatterImpulse: 4.0,
    scatterLift: 1.5,
    fleeDuration: 2.4,
    scatterCooldown: 1.2,
    canPerch: true,
    settleChancePerSecond: 0.25,
    settleDurationMin: 2.0,
    settleDurationMax: 6.0,
    settleDamping: 0.75,
});

/**
 * Called once per frame in which at least one critter scattered, with the
 * centroid of the burst. Wired by `FaunaSystem` to the rigid-body radial
 * impulse when that layer is present; null in tests and when RB is off.
 */
export type FaunaScatterSink = (x: number, y: number, z: number, count: number) => void;

let _scatterSink: FaunaScatterSink | null = null;

/** Install (or clear) the physical-reaction hook. */
export function setFaunaScatterSink(sink: FaunaScatterSink | null): void {
    _scatterSink = sink;
}

function mulberry32(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface FaunaBehaviorStats {
    roam: number;
    flee: number;
    perch: number;
    idle: number;
    /** Critters that received a scatter impulse this frame. */
    scattered: number;
}

/**
 * Per-critter state machine over the boid slab.
 *
 * One instance is owned by `FaunaSystem`. Kept as a class (not module state)
 * so tests can drive an isolated runner without touching the live world.
 */
export class FaunaBehaviorRunner {
    /** Seconds remaining in the current Flee hold, per entry index. */
    private _fleeTimer = new Float32Array(0);
    /** Seconds remaining in the current Perch/Idle, per entry index. */
    private _settleTimer = new Float32Array(0);
    /** Seconds until this critter may be impulsed again. */
    private _cooldown = new Float32Array(0);
    private readonly _rng: () => number;

    readonly stats: FaunaBehaviorStats = { roam: 0, flee: 0, perch: 0, idle: 0, scattered: 0 };

    constructor(seed = 0xfa) {
        this._rng = mulberry32(seed);
    }

    /** Grow the timer arrays to hold `count` entries. Idempotent. */
    resize(count: number): void {
        if (this._fleeTimer.length >= count) return;
        this._fleeTimer = new Float32Array(count);
        this._settleTimer = new Float32Array(count);
        this._cooldown = new Float32Array(count);
    }

    /**
     * Advance every critter's state. Call after the boids step so positions are
     * this frame's; velocity writes land on the next step.
     *
     * @param entries   spawn entries — `component.state` is updated in place
     * @param heap      the boid slab
     * @param baseIndex float index of slot 0 (`bufferByteOffset >> 2`)
     */
    update(
        entries: readonly FaunaSpawnEntry[],
        heap: Float32Array,
        baseIndex: number,
        dt: number,
        playerX: number,
        playerY: number,
        playerZ: number
    ): FaunaBehaviorStats {
        const stats = this.stats;
        stats.roam = 0;
        stats.flee = 0;
        stats.perch = 0;
        stats.idle = 0;
        stats.scattered = 0;

        const clampedDt = Math.max(0, Math.min(dt, 0.1));
        this.resize(entries.length);

        let burstX = 0;
        let burstZ = 0;

        for (let i = 0; i < entries.length; i++) {
            const component = entries[i].component;
            const profile = _profiles.get(component.species);
            if (!profile) {
                component.state = FaunaState.Wander;
                stats.roam++;
                continue;
            }

            const b = baseIndex + component.slot * FAUNA_BOID_STRIDE;
            const x = heap[b];
            const y = heap[b + 1];
            const z = heap[b + 2];

            const dx = x - playerX;
            const dz = z - playerZ;
            const d2 = dx * dx + dz * dz;

            if (this._cooldown[i] > 0) this._cooldown[i] -= clampedDt;

            // --- Trigger: player inside the scatter radius ---
            if (d2 < profile.scatterRadius * profile.scatterRadius) {
                const wasFleeing = component.state === FaunaState.Flee;
                component.state = FaunaState.Flee;
                this._fleeTimer[i] = profile.fleeDuration;
                this._settleTimer[i] = 0;

                if (!wasFleeing && this._cooldown[i] <= 0) {
                    this._impulse(heap, b, dx, dz, d2, profile);
                    this._cooldown[i] = profile.scatterCooldown;
                    stats.scattered++;
                    burstX += x;
                    burstZ += z;
                }
                stats.flee++;
                continue;
            }

            // --- Flee hold: run until the timer expires AND we are clear ---
            if (component.state === FaunaState.Flee) {
                this._fleeTimer[i] -= clampedDt;
                if (this._fleeTimer[i] <= 0 && d2 > profile.calmRadius * profile.calmRadius) {
                    component.state = FaunaState.Wander;
                    stats.roam++;
                } else {
                    stats.flee++;
                }
                continue;
            }

            // --- Settled: Perch or Idle, damping toward a stop ---
            if (component.state === FaunaState.Perch || component.state === FaunaState.Rest) {
                this._settleTimer[i] -= clampedDt;
                if (this._settleTimer[i] <= 0) {
                    component.state = FaunaState.Wander;
                    stats.roam++;
                } else {
                    heap[b + 3] *= profile.settleDamping;
                    heap[b + 4] *= profile.settleDamping;
                    heap[b + 5] *= profile.settleDamping;
                    if (component.state === FaunaState.Perch) stats.perch++;
                    else stats.idle++;
                }
                continue;
            }

            // --- Roam: occasionally settle ---
            if (this._rng() < profile.settleChancePerSecond * clampedDt) {
                component.state = profile.canPerch ? FaunaState.Perch : FaunaState.Rest;
                this._settleTimer[i] =
                    profile.settleDurationMin +
                    this._rng() * (profile.settleDurationMax - profile.settleDurationMin);
                if (component.state === FaunaState.Perch) stats.perch++;
                else stats.idle++;
            } else {
                stats.roam++;
            }
        }

        if (stats.scattered > 0 && _scatterSink) {
            _scatterSink(
                burstX / stats.scattered,
                playerY,
                burstZ / stats.scattered,
                stats.scattered
            );
        }

        return stats;
    }

    /** One-shot radial kick away from the player, written into slab velocity. */
    private _impulse(
        heap: Float32Array,
        b: number,
        dx: number,
        dz: number,
        d2: number,
        profile: FaunaSpeciesProfile
    ): void {
        // Directly under the player: pick a deterministic bearing rather than
        // dividing by ~0 and sending the critter to infinity.
        let nx: number;
        let nz: number;
        if (d2 < 0.0001) {
            const a = this._rng() * Math.PI * 2;
            nx = Math.sin(a);
            nz = Math.cos(a);
        } else {
            const inv = 1 / Math.sqrt(d2);
            nx = dx * inv;
            nz = dz * inv;
        }
        heap[b + 3] += nx * profile.scatterImpulse;
        heap[b + 4] += profile.scatterLift;
        heap[b + 5] += nz * profile.scatterImpulse;
    }

    /** Clear all timers (respawn / teardown). */
    reset(): void {
        this._fleeTimer.fill(0);
        this._settleTimer.fill(0);
        this._cooldown.fill(0);
    }
}
