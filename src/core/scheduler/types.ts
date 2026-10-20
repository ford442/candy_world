// src/core/scheduler/types.ts
// Phase, FrameContext and System contracts for the SystemScheduler (#1973).
// Type-only module: nothing here may import runtime code, so any module can
// depend on it without adding to the import graph.

import type * as THREE from 'three';
import type { VisualState } from '../../audio/audio-system-core.ts';
import type { PlatformCapabilities } from '../platform/capabilities.ts';

/**
 * Frame phases, in run order. A system belongs to exactly one phase; within a
 * phase, systems run in registration order unless `after`/`before` say otherwise.
 *
 * - `input`        read devices / raycasts, clamp the player to streamed terrain
 * - `fixed`        deterministic simulation; runs 0..maxSubsteps times per frame at `fixedDt`
 * - `simulate`     variable-step simulation (player physics until it moves to `fixed`, gameplay, fauna)
 * - `animate`      sky/weather/lighting, foliage, particles, rigs — everything that reads the settled sim
 * - `audio`        push this frame's world state into the music engine
 * - `render-prep`  post-FX uniforms, camera handoff, GPU compute dispatch
 * - `postfx`       the render itself
 * - `ui`           DOM / HUD work that must see the rendered frame
 */
export const PHASES = [
    'input',
    'fixed',
    'simulate',
    'animate',
    'audio',
    'render-prep',
    'postfx',
    'ui',
] as const;

export type Phase = (typeof PHASES)[number];

/** Audio analysis sampled once at the top of the frame (`AudioSystem.update()`). */
export type AudioFrame = VisualState;

export interface PlayerFrame {
    readonly position: THREE.Vector3;
    readonly velocity: THREE.Vector3;
}

export interface FrameContext {
    /** Clamped, photo-mode-scaled frame delta (seconds). */
    readonly dt: number;
    /** Unclamped wall-clock delta from the frame clock (seconds). */
    readonly rawDt: number;
    /** Fixed simulation step (seconds). Constant for the scheduler's lifetime. */
    readonly fixedDt: number;
    /** Leftover accumulator / fixedDt in [0, 1): interpolation weight between the last two fixed states. */
    readonly fixedAlpha: number;
    /** Fixed steps taken so far, ever. In the `fixed` phase this is the current tick's index. */
    readonly fixedTick: number;
    /** BPM-scaled game time (seconds). */
    readonly time: number;
    /** Frames run by this scheduler, starting at 0. */
    readonly frame: number;
    readonly audio: AudioFrame | null;
    readonly player: PlayerFrame;
    readonly camera: THREE.PerspectiveCamera;
    readonly caps: PlatformCapabilities;
    /** Dev explore/orbit camera owns the view this frame (player physics is paused). */
    readonly exploreActive: boolean;
}

/** Per-frame inputs the game loop supplies; the scheduler fills in the rest. */
export type FrameInput = Omit<FrameContext, 'fixedDt' | 'fixedAlpha' | 'fixedTick' | 'frame'>;

export interface System {
    readonly id: string;
    readonly phase: Phase;
    /** Ids (same phase) that must run before this one. Unknown ids are ignored. */
    readonly after?: readonly string[];
    /** Ids (same phase) that must run after this one. Unknown ids are ignored. */
    readonly before?: readonly string[];
    /**
     * Consecutive throwing frames before the scheduler stops calling this
     * system. Default `DEFAULT_MAX_CONSECUTIVE_ERRORS`; `Infinity` never trips.
     */
    readonly maxConsecutiveErrors?: number;
    /** Tier / feature-flag gate, checked every frame before `update`. */
    enabled?(ctx: FrameContext): boolean;
    update(ctx: FrameContext): void;
    dispose?(): void;
}

export interface SystemStats {
    readonly id: string;
    readonly phase: Phase;
    /** Turned off with `setEnabled(id, false)`. */
    readonly paused: boolean;
    /** Tripped by the circuit breaker; stays off until `setEnabled(id, true)`. */
    readonly tripped: boolean;
    /** Total throws over the system's lifetime. */
    readonly errors: number;
    /** Wall time of the last `update` (ms; summed over substeps in `fixed`). */
    readonly lastMs: number;
    /** Exponential moving average of `lastMs`. */
    readonly avgMs: number;
}
