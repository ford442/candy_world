/**
 * Season tint for material albedo (docs/SEASONS.md).
 *
 * One uniform set per material role, written once per frame by the season
 * controller. The graph is identical in every season — only uniform values
 * change — so switching season never recompiles a shader.
 *
 * Apply it to the *raw* albedo, before aerial perspective, contact AO or rim
 * light consume it, so distance haze and grounding act on the seasonal colour.
 */
import * as THREE from 'three';
import { dot, float, hash, max, min, mix, normalWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
    LUMA_B,
    LUMA_G,
    LUMA_R,
    SEASON_ROLE_INDEX,
    SEASON_ROLE_STRIDE,
    SEASON_ROLES,
    type SeasonRole,
} from '../../systems/season-core.ts';
import { $sn } from './tsl-types.ts';

type ColorNode = ReturnType<typeof vec3>;

const _roleTarget = SEASON_ROLES.map(() => uniform(new THREE.Color(1, 1, 1)));
/** x = amount, y = frost, z = chroma − 1 (so the identity is an exact 0). */
const _roleParams = SEASON_ROLES.map(() => uniform(new THREE.Vector3(0, 0, 0)));

/** Frost colour (linear). */
export const uSeasonFrostColor = uniform(new THREE.Color(1, 1, 1));

/**
 * CPU mirror of the role uniforms, in `blendSeasonPalette` layout, for code
 * that tints colours on the CPU (the far-LOD impostors).
 */
export const seasonRoleCpu = new Float32Array(SEASON_ROLES.length * SEASON_ROLE_STRIDE);
/** CPU mirror of `uSeasonFrostColor` (linear). */
export const seasonFrostCpu = new Float32Array([1, 1, 1]);

for (let r = 0; r < SEASON_ROLES.length; r++) {
    const o = r * SEASON_ROLE_STRIDE;
    seasonRoleCpu[o] = 1;
    seasonRoleCpu[o + 1] = 1;
    seasonRoleCpu[o + 2] = 1;
    seasonRoleCpu[o + 5] = 1;
}

/** Publish blended role parameters (from `blendSeasonPalette`) and the linear frost colour. */
export function writeSeasonUniforms(roleParams: Float32Array, frostRgb: Float32Array): void {
    for (let r = 0; r < SEASON_ROLES.length; r++) {
        const o = r * SEASON_ROLE_STRIDE;
        _roleTarget[r].value.setRGB(roleParams[o], roleParams[o + 1], roleParams[o + 2]);
        _roleParams[r].value.set(roleParams[o + 3], roleParams[o + 4], roleParams[o + 5] - 1);
    }
    uSeasonFrostColor.value.setRGB(frostRgb[0], frostRgb[1], frostRgb[2]);
    seasonRoleCpu.set(roleParams);
    seasonFrostCpu.set(frostRgb);
}

const _luma = vec3(LUMA_R, LUMA_G, LUMA_B);

/**
 * Seasonal albedo for one role. In order: saturation around luminance
 * (chroma ≥ 1), a luminance-preserving move toward the season's hue, then
 * powdered-sugar frost on upward-facing surfaces. Every step is exact at its
 * spring value, so spring renders the authored colour bit for bit.
 * Mirrored on the CPU by `tintRgbInPlace` in systems/season-core.ts.
 */
export function applySeasonTint(base: Node | ColorNode, role: SeasonRole): ColorNode {
    const i = SEASON_ROLE_INDEX[role];
    const params = _roleParams[i];
    const b = vec3($sn(base as Node));
    const lum = dot(b, _luma);
    const saturated = max(b.add(b.sub(lum).mul(params.z)), vec3(0.0));
    const tinted = mix(saturated, min(_roleTarget[i].mul(lum), vec3(1.0)), params.x);
    const frost = params.y.mul(smoothstep(0.2, 0.85, normalWorld.y)).mul(0.8);
    return mix(tinted, uSeasonFrostColor, frost) as unknown as ColorNode;
}

/**
 * Share of each seasonal population shown (CONFIG.season.spawnScale), applied
 * in the vertex stage by `seasonDensityKeep`. 1 = everything world generation
 * placed; seasons only ever thin it.
 */
export const uSeasonSpawn = {
    berries: uniform(1.0),
    gemFruit: uniform(1.0),
    fireflies: uniform(1.0),
};

/** Luminous-plant glow multiplier (CONFIG.season.luminousBoost). */
export const uSeasonLuminousBoost = uniform(1.0);

/** CPU copies of the spawn scales, for CPU-side spawners (dandelion seeds, falling berries). */
export const seasonSpawnCpu = { berries: 1, gemFruit: 1, fireflies: 1, dandelionSeeds: 1 };

export function writeSeasonSpawn(
    berries: number,
    gemFruit: number,
    fireflies: number,
    dandelionSeeds: number,
    luminousBoost: number
): void {
    uSeasonSpawn.berries.value = berries;
    uSeasonSpawn.gemFruit.value = gemFruit;
    uSeasonSpawn.fireflies.value = fireflies;
    uSeasonLuminousBoost.value = luminousBoost;
    seasonSpawnCpu.berries = berries;
    seasonSpawnCpu.gemFruit = gemFruit;
    seasonSpawnCpu.fireflies = fireflies;
    seasonSpawnCpu.dandelionSeeds = dandelionSeeds;
}

/** Stable 0..1 key for an instance index (PCG hash). Use only where indices never get reshuffled. */
export function instanceKey01(index: Node): ColorNode {
    return hash($sn(index)) as unknown as ColorNode;
}

/**
 * Vertex-scale multiplier: 1 for instances kept at `density`, 0 for the rest.
 * `key01` must be uniform in [0, 1) and fixed per instance, so the same
 * instances disappear first every time. The soft edge fades instances in and
 * out as density drifts across a season boundary. Exactly 1 at density 1.
 */
export function seasonDensityKeep(key01: Node | ColorNode, density: Node | ColorNode): ColorNode {
    const k = $sn(key01 as Node);
    return smoothstep(k.sub(0.04), k, float($sn(density as Node))) as unknown as ColorNode;
}
