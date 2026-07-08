/**
 * Distance-driven aerial perspective for instanced foliage TSL graphs.
 * Desaturates mid/far instances and lifts luminance toward horizon fog color.
 *
 * Uniforms are updated once per frame from game-loop.ts (zero alloc).
 */
import * as THREE from 'three';
import {
    cameraPosition,
    dot,
    float,
    mix,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { lodFarGate, lodMidOnlyGate } from './lod-nodes.ts';
import { CONFIG } from '../core/config.ts';

/** 0 = disabled, 1 = full strength (scaled by night/fog gates on CPU). */
export const uAerialStrength = uniform(0.0);
/** Visual Impact: distance where desaturation begins (keep heroes <60u vivid). */
export const uAerialStartDist = uniform(35.0);
/** Visual Impact: distance where effect reaches full blend toward fog. */
export const uAerialEndDist = uniform(130.0);
/** Visual Impact: 0–1 desaturation weight at far end. */
export const uAerialDesat = uniform(0.62);
/** Visual Impact: 0–1 blend toward fog tint at far end. */
export const uAerialFogBlend = uniform(0.42);
/** Horizon fog color — synced from scene fog each frame. */
export const uAerialFogColor = uniform(new THREE.Color(0xffffff));

const _LUM_WEIGHT = vec3(0.299, 0.587, 0.114);

/** LOD tiers amplify aerial recession (complements impostor collapse). */
export const aerialPerspectiveLodBoost = () =>
    float(1.0).add(lodMidOnlyGate().mul(0.3)).add(lodFarGate().mul(0.55));

/**
 * Apply distance-driven desaturation + fog-color lift to a base diffuse color.
 * @param baseColor  TSL vec3 color node
 * @param worldPos   World-space position (defaults to positionWorld at call site)
 * @param lodBoost   Optional LOD multiplier node (default 1.0)
 */
export function applyAerialPerspective(
    baseColor: ReturnType<typeof vec3>,
    worldPos: ReturnType<typeof vec3>,
    lodBoost: ReturnType<typeof float> = float(1.0),
) {
    const dist = cameraPosition.distance(worldPos);
    const distT = smoothstep(uAerialStartDist, uAerialEndDist, dist);
    const effect = distT.mul(uAerialStrength).mul(lodBoost).clamp(0.0, 1.0);

    const lum = dot(baseColor, _LUM_WEIGHT);
    const grey = vec3(lum, lum, lum);
    const desaturated = mix(baseColor, grey, effect.mul(uAerialDesat));

    return mix(desaturated, uAerialFogColor, effect.mul(uAerialFogBlend));
}

const _scratchFogColor = new THREE.Color();

/**
 * CPU-side uniform update — call once per frame from game-loop (zero alloc).
 */
export function updateAerialPerspectiveUniforms(
    fogColor: THREE.Color,
    dayNightBias: number,
    fogNear: number,
    fogFar: number,
): void {
    const cfg = CONFIG.foliage.aerialPerspective;
    if (!cfg.enabled) {
        uAerialStrength.value = 0;
        return;
    }

    uAerialStartDist.value = cfg.startDist;
    uAerialEndDist.value = cfg.endDist;
    uAerialDesat.value = cfg.desatAmount;
    uAerialFogBlend.value = cfg.fogBlend;
    uAerialFogColor.value.copy(_scratchFogColor.copy(fogColor));

    const timeGate = cfg.nightFactor + (1.0 - cfg.nightFactor) * dayNightBias;
    const fogSpan = Math.max(1, fogFar - fogNear);
    const fogGate = Math.min(1.0, fogSpan / CONFIG.atmosphere.fog.minFar);
    uAerialStrength.value = cfg.strength * timeGate * fogGate;
}
