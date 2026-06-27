/**
 * TSL nodes for three-tier foliage LOD (hero / mid / far).
 * Hero tier (factor ≈ 0) preserves pre-LOD visuals; mid/far simplify motion and emissive.
 */
import { attribute, float, mix, positionLocal, smoothstep, vec3 } from 'three/tsl';
import { calculatePlayerPush, calculateWindSway } from './material-core.ts';

/** Continuous LOD factor: 0 = hero, 1 = mid, 2 = far, 3+ = culled */
export const aInstanceLodFactor = attribute('instanceLodFactor', 'float');

export const lodHeroGate = () => smoothstep(float(1.05), float(0.85), aInstanceLodFactor);
export const lodMidOnlyGate = () => {
    const aboveHero = smoothstep(float(0.85), float(1.05), aInstanceLodFactor);
    const belowFar = smoothstep(float(1.95), float(1.55), aInstanceLodFactor);
    return aboveHero.mul(belowFar);
};
export const lodFarGate = () => smoothstep(float(1.55), float(1.95), aInstanceLodFactor);

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

    // Far tier: collapse toward instance origin (impostor-style proxy)
    const collapse = float(1).sub(lodFarGate().mul(0.72));
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
