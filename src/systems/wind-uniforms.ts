/**
 * Unified wind state — the single source of truth for direction, gust,
 * turbulence and music coupling.
 *
 * Everything that sways reads from here: the TSL deform helpers
 * (`material-core/deformation.ts`), the GPU foliage animator
 * (`compute/gpu-foliage-animator.ts`) and the GPU particle systems
 * (`foliage/pollen.ts`, dandelion seeds). Before this module each of those
 * rolled its own sine offset, so on a gusty day trees, clouds and pollen
 * disagreed about which way the wind was blowing.
 *
 * Nodes are created ONCE at module-init and mutated in place each frame by
 * `updateWind()` — zero per-frame allocations. Update loops mutate `.value`
 * only; never reassign a node.
 *
 * 🎨 PALETTE / Visual Impact: gust is the readable part of wind. It is a
 * slow multi-octave swell around 1.0, so foliage breathes between lulls and
 * gusts instead of vibrating at a constant amplitude. `low` quality drops to
 * a single octave — the swell survives, the fine chatter does not.
 */

import * as THREE from 'three';
import { uniform, vec3, float } from 'three/tsl';

/** Gust octave weights, strongest (slowest) first. */
const GUST_OCTAVES: ReadonlyArray<{ freq: number; amp: number }> = [
    { freq: 0.23, amp: 0.3 },
    { freq: 0.61, amp: 0.14 },
    { freq: 1.47, amp: 0.06 },
];

/** Octave count per graphics tier — `low` keeps only the slow swell. */
const OCTAVES_FOR_TIER: Record<'low' | 'medium' | 'high', number> = {
    low: 1,
    medium: 2,
    high: 3,
};

/**
 * Shared wind uniforms. Import these rather than declaring local wind state.
 *
 * - `direction` — normalized world-space wind heading (Y is ~0).
 * - `speed`     — smoothed base wind speed (weather + BPM coupled).
 * - `gust`      — multi-octave swell multiplier, roughly 0.5–1.5.
 * - `turbulence` — 0–1 high-frequency chaos, rises with storms.
 * - `musicCoupling` — 0–1 how much the track is driving the wind right now.
 */
export const WindUniforms = {
    direction: uniform(vec3(1, 0, 0)),
    speed: uniform(0.0),
    gust: uniform(1.0),
    turbulence: uniform(0.0),
    musicCoupling: uniform(0.0),
};

/**
 * Effective sway strength = base speed × gust. Every consumer should scale by
 * this instead of by `speed` alone, so a gust reads across trees, clouds,
 * cloth and particles at the same instant.
 */
export const uWindStrength = WindUniforms.speed.mul(WindUniforms.gust);

/** Convenience aliases matching the historical `shared-resources` names. */
export const uWindSpeed = WindUniforms.speed;
export const uWindDirection = WindUniforms.direction;
export const uWindGust = WindUniforms.gust;
export const uWindTurbulence = WindUniforms.turbulence;

/** Horizontal wind vector (direction × strength) as a TSL node. */
export const windVectorNode = vec3(
    WindUniforms.direction.x,
    float(0.0),
    WindUniforms.direction.z
).mul(uWindStrength);

let _octaves = OCTAVES_FOR_TIER.medium;
let _elapsed = 0;

/** Plain-JS mirror of the uniforms, for CPU consumers and the debug arrow. */
const _state = {
    directionX: 1,
    directionY: 0,
    directionZ: 0,
    speed: 0,
    gust: 1,
    turbulence: 0,
    musicCoupling: 0,
};

export type WindState = Readonly<typeof _state>;

/**
 * Set gust detail. Call once from startup capability resolution; `low` drops
 * to a single octave (≈2 fewer sin() per frame and a calmer silhouette on
 * weak GPUs, where foliage is already LOD-simplified).
 */
export function setWindQuality(tier: 'low' | 'medium' | 'high'): void {
    _octaves = OCTAVES_FOR_TIER[tier] ?? OCTAVES_FOR_TIER.medium;
}

export interface WindUpdateInput {
    /** Weather system's 0–1 base wind. */
    weatherWind: number;
    /** Weather wind heading; read in place, never retained. */
    direction: THREE.Vector3 | null | undefined;
    /** Current track BPM (0 / undefined when silent). */
    bpm?: number;
    /** 0–1 low-band audio energy — couples bass to gust. */
    audioLow?: number;
    /** 0–1 storminess, drives turbulence. */
    stormIntensity?: number;
}

/**
 * Advance the shared wind by `delta` seconds and publish it to every uniform.
 * Allocation-free: only scalar writes plus one in-place `Vector3.set`.
 */
export function updateWind(delta: number, input: WindUpdateInput): void {
    _elapsed += delta;

    // Base speed: weather wind, nudged by tempo so a fast track feels breezier.
    const bpmFactor = THREE.MathUtils.clamp(((input.bpm || 120) - 60) / 120, 0, 1.5);
    const target = (1.0 + input.weatherWind * 4.0) * (1.0 + bpmFactor * 0.5);
    _state.speed = THREE.MathUtils.lerp(_state.speed, target, 0.05);

    // Gust: sum of slow sines around 1.0, plus a bass-coupled kick.
    let swell = 0;
    for (let i = 0; i < _octaves; i++) {
        const o = GUST_OCTAVES[i];
        swell += Math.sin(_elapsed * o.freq + i * 1.7) * o.amp;
    }
    const audioLow = input.audioLow || 0;
    const coupling = THREE.MathUtils.clamp(audioLow * (bpmFactor * 0.5 + 0.5), 0, 1);
    _state.gust = 1.0 + swell + coupling * 0.25;
    _state.musicCoupling = coupling;

    _state.turbulence = THREE.MathUtils.clamp(
        (input.stormIntensity || 0) * 0.7 + Math.abs(swell) * 0.5,
        0,
        1
    );

    if (input.direction) {
        _state.directionX = input.direction.x;
        _state.directionY = input.direction.y;
        _state.directionZ = input.direction.z;
    }

    (WindUniforms.direction.value as unknown as THREE.Vector3).set(
        _state.directionX,
        _state.directionY,
        _state.directionZ
    );
    WindUniforms.speed.value = _state.speed;
    WindUniforms.gust.value = _state.gust;
    WindUniforms.turbulence.value = _state.turbulence;
    WindUniforms.musicCoupling.value = _state.musicCoupling;
}

/** Current wind as plain numbers — for CPU sims, WGSL uniforms and debug UI. */
export function getWindState(): WindState {
    return _state;
}

/** Base speed × gust: the number every consumer should scale sway by. */
export function getWindStrength(): number {
    return _state.speed * _state.gust;
}
