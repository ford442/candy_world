/**
 * TSL nodes for three-tier foliage LOD (hero / mid / far).
 * Hero tier (factor ≈ 0) preserves pre-LOD visuals; mid/far simplify motion and emissive.
 */
import { attribute, float, mix, positionLocal, smoothstep, uniform, vec3, floor, mod } from 'three/tsl';
import { calculatePlayerPush, calculateWindSway } from './material-core.ts';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { CONFIG } from '../core/config.ts';

/** Continuous LOD factor: 0 = hero, 1 = mid, 2 = far, 3+ = culled */
export const aInstanceLodFactor = attribute('instanceLodFactor', 'float');

/** Synced from CONFIG.foliage.lod each frame (batcher-lod.ts). */
export const uLodImpostorMin = uniform(1.55);
export const uLodImpostorMax = uniform(2.05);
/** Debug: tint instances in tier blend bands (set via ?debug=1 panel). */
export const uLodDebugHighlight = uniform(0.0);

export const lodHeroGate = () => smoothstep(float(1.05), float(0.85), aInstanceLodFactor);
export const lodMidOnlyGate = () => {
    const aboveHero = smoothstep(float(0.85), float(1.05), aInstanceLodFactor);
    const belowFar = smoothstep(float(1.95), float(1.55), aInstanceLodFactor);
    return aboveHero.mul(belowFar);
};
export const lodFarGate = () => smoothstep(float(1.55), float(1.95), aInstanceLodFactor);

/** 0→1 weight for impostor cross-fade (meshes fade out as this rises). */
export const lodImpostorBlend = () =>
    smoothstep(uLodImpostorMin, uLodImpostorMax, aInstanceLodFactor);

/** Mesh opacity during impostor handoff — dither-friendly alpha multiplier. */
export const lodMeshOpacity = () => float(1.0).sub(lodImpostorBlend());

/** Instances actively cross-fading between tiers (hero↔mid or mid↔far/impostor). */
export const lodBlendBandGate = () => {
    const f = aInstanceLodFactor;
    const heroMid = smoothstep(float(0.75), float(0.85), f).mul(smoothstep(float(1.15), float(1.05), f));
    const midFar = smoothstep(float(1.45), float(1.55), f).mul(smoothstep(float(2.15), float(1.95), f));
    return heroMid.add(midFar).clamp(0.0, 1.0);
};

/** Bayer-style screen dither for opacity (reduces hard alpha pops). */
export const lodDitheredOpacity = (baseOpacity: ReturnType<typeof float> = lodMeshOpacity()) => {
    const cell = floor(positionLocal.x.mul(40.0)).add(floor(positionLocal.y.mul(40.0)).mul(3.0));
    const threshold = mod(cell, float(4.0)).div(4.0);
    return baseOpacity.sub(threshold).mul(4.0).clamp(0.0, 1.0);
};

/**
 * Apply impostor cross-fade opacity to a foliage material (call once per material).
 * Hero tier (<120u) opacity stays 1.0 — only far handoff fades.
 */
export function applyFoliageLodMaterialFade(material: MeshStandardNodeMaterial): void {
    if ((material as unknown as { userData: Record<string, unknown> }).userData?.foliageLodFadeApplied) return;
    (material as unknown as { userData: Record<string, unknown> }).userData.foliageLodFadeApplied = true;
    material.transparent = true;
    const existing = material.opacityNode;
    const fade = lodDitheredOpacity();
    material.opacityNode = existing ? existing.mul(fade) : fade;
    const debugTint = vec3(1.0, 0.55, 1.0);
    const band = lodBlendBandGate().mul(uLodDebugHighlight);
    if (material.colorNode) {
        material.colorNode = mix(material.colorNode, material.colorNode.mul(debugTint), band);
    }
}

/** Push CONFIG.foliage.lod impostor thresholds to TSL uniforms (zero alloc). */
export function syncFoliageLodUniforms(): void {
    const lod = CONFIG.foliage?.lod;
    uLodImpostorMin.value = lod?.impostorMinFactor ?? 1.55;
    uLodImpostorMax.value = lod?.impostorMaxFactor ?? 2.05;
}

/** Player push only within hero band */
export const applyPlayerInteractionWithLod = (basePosNode: Parameters<typeof calculatePlayerPush>[0]) => {
    const push = calculatePlayerPush(basePosNode).mul(lodHeroGate());
    return basePosNode.add(push);
};

/** Wind sway attenuated in mid/far tiers */
export const calculateWindSwayWithLod = (posNode: Parameters<typeof calculateWindSway>[0]) => {
    const wind = calculateWindSway(posNode);
    const weight = lodHeroGate().add(lodMidOnlyGate().mul(0.45));
    return wind.mul(weight);
};

/**
 * Full foliage motion offset for LOD-enabled objects.
 * (deformationNode semantics: displaced position minus positionLocal).
 * 🏗️ ARCHITECT: Single source of truth for LOD deformation.
 * Internally composes wind sway and player push. DO NOT wrap with applyPlayerInteraction.
 */
export const foliageDeformationOffset = (
    baseWithAnimPos: Parameters<typeof calculatePlayerPush>[0],
    extraOffset?: ReturnType<typeof float>,
    subtractNode: typeof positionLocal = positionLocal
) => {
    const heroPos = baseWithAnimPos
        .add(calculatePlayerPush(baseWithAnimPos))
        .add(calculateWindSway(baseWithAnimPos));
    const midPos = baseWithAnimPos.add(calculateWindSway(baseWithAnimPos).mul(0.5));
    const farPos = baseWithAnimPos;

    const heroMid = mix(midPos, heroPos, lodHeroGate());
    let blended = mix(farPos, heroMid, float(1).sub(lodFarGate()));

    if (extraOffset) {
        const extraWeight = lodHeroGate().add(lodMidOnlyGate().mul(0.35));
        blended = blended.add(extraOffset.mul(extraWeight));
    }

    // Far tier: collapse in sync with impostor cross-fade (not a hard pop)
    const impostorBlend = lodImpostorBlend();
    const collapse = float(1.0).sub(impostorBlend.mul(0.85));
    blended = blended.mul(collapse);

    return blended.sub(subtractNode);
};

/** Absolute displaced position (for materials using positionNode directly) */
export const foliageMotionPosition = (
    baseWithAnimPos: Parameters<typeof calculatePlayerPush>[0],
    extraOffset?: ReturnType<typeof float>
) => foliageDeformationOffset(baseWithAnimPos, extraOffset).add(positionLocal);

/** Scale emissive / sparkle intensity by LOD tier */
export const scaleEmissiveByLod = (emissiveNode: ReturnType<typeof float>) => {
    const weight = lodHeroGate().add(lodMidOnlyGate().mul(0.42)).add(lodFarGate().mul(0.12));
    return emissiveNode.mul(weight);
};

/** Mix a hero-only multiplier toward 1.0 in mid/far (e.g. audio squash) */
export const lodHeroOnlyMultiplier = (heroValue: ReturnType<typeof vec3>, identity = vec3(1, 1, 1)) =>
    mix(identity, heroValue, lodHeroGate());

/**
 * 🏗️ ARCHITECT: Standardized TSL deformation chain for LOD-enabled objects
 * that manually compose their offsets instead of using foliageDeformationOffset.
 */
export const applyStandardDeformationWithLod = (basePosNode: any) => {
    return applyPlayerInteractionWithLod(basePosNode.add(calculateWindSwayWithLod(basePosNode)));
};
