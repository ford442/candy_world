import {
    float,
    vec3,
    Fn,
    dot,
    sin,
    smoothstep,
    normalize,
    positionLocal,
    positionWorld,
    attribute,
} from 'three/tsl';
import {
    uTime,
    uWindSpeed,
    uWindDirection,
    uWindGust,
    uWindStrength,
    uWindTurbulence,
    uAudioLow,
    uPlayerPosition,
} from './shared-resources.ts';
import type { TSLArg } from './tsl-types.ts';

export const calculatePlayerPush = Fn<[TSLArg]>(([currentPos]) => {
    const playerDistVector = positionWorld.sub(uPlayerPosition);
    const playerDistH = vec3(playerDistVector.x, float(0.0), playerDistVector.z);
    const distSq = dot(playerDistH, playerDistH);

    const interactRadiusSq = float(4.0);

    const pushStrength = smoothstep(interactRadiusSq, float(0.0), distSq);

    // TSL inlines an expression at every use site, so a node consumed twice is
    // compiled twice. Both of these feed .x and .z below — pin them to a
    // variable so normalize() and the bend product each run once per vertex.
    const pushDir = normalize(playerDistH).toVar();

    const heightFactor = positionLocal.y.max(0.0);
    const bendAmount = pushStrength.mul(1.5).mul(heightFactor).toVar();

    return vec3(pushDir.x.mul(bendAmount), float(0.0), pushDir.z.mul(bendAmount));
});

export const applyPlayerInteraction = (basePosNode: any) => {
    return basePosNode.add(calculatePlayerPush(basePosNode));
};

/**
 * Per-species wind character. Every option is a TSL **node**, never a boolean:
 * a node compiles into the one shared graph, whereas a flag would fork the
 * graph and multiply shader permutations. Options may be constants
 * (`float(2.0)`) or per-instance attributes (`attribute('aStiffness')`).
 *
 * Omitting an option omits its operation entirely, so an unparameterized call
 * generates exactly the WGSL it generated before this factory grew options.
 */
export interface WindDeformationOptions {
    /** Divides sway. >1 = stiffer (woody stems), <1 = floppier. Default: none. */
    stiffness?: TSLArg;
    /** Multiplies sway. Default: none. */
    amplitude?: TSLArg;
    /** Multiplies the sway phase rate — higher = faster, tighter waves. Default: none. */
    frequency?: TSLArg;
    /** Added to the sway phase. De-syncs species (or instances) that would
     *  otherwise march in step. Default: none — see note on positionWorld below. */
    phaseOffset?: TSLArg;
    /** Sway gains `uAudioLow * audioReactivity` on top of 1.0. Default: none. */
    audioReactivity?: TSLArg;
    /** Multiplies sway, for day/night dampening. Default: none. */
    circadianBlend?: TSLArg;
}

/**
 * Canonical wind bend. Reads the unified wind state (direction, speed, gust,
 * turbulence) so every material that calls this agrees with the GPU foliage
 * animator and the particle systems on the same frame.
 *
 * Phase comes from `positionWorld`, which is genuinely per-instance: three's
 * InstanceNode assigns `instanceMatrix * positionLocal` into `positionLocal`
 * before `NodeMaterial.setupPosition()` applies `positionNode`, so instances of
 * one batcher sway out of step for free. `phaseOffset` is therefore for
 * deliberate character, not a correctness fix.
 *
 * 🎨 PALETTE / Visual Impact: amplitude is `speed × gust`, so lulls and swells
 * travel across the whole world at once rather than per-batcher.
 */
export const calculateWindSway = (posNode: TSLArg, options: WindDeformationOptions = {}) => {
    const { stiffness, amplitude, frequency, phaseOffset, audioReactivity, circadianBlend } =
        options;

    const windTime = uTime.mul(uWindSpeed.add(0.5));
    let phase = positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.5)).add(windTime);
    if (frequency) phase = phase.mul(frequency);
    if (phaseOffset) phase = phase.add(phaseOffset);
    // Consumed by both the chop and the base sine below.
    const swayPhase = phase.toVar();

    // Turbulence adds a faster, smaller ripple on top of the shared swell.
    const chop = sin(swayPhase.mul(2.7).add(uTime)).mul(uWindTurbulence).mul(0.35);
    let sway = sin(swayPhase).add(chop).mul(0.1).mul(uWindStrength.add(0.2));
    if (amplitude) sway = sway.mul(amplitude);
    if (stiffness) sway = sway.div(stiffness);
    if (audioReactivity) sway = sway.mul(float(1.0).add(uAudioLow.mul(audioReactivity)));
    if (circadianBlend) sway = sway.mul(circadianBlend);
    // sway and the height falloff each feed .x and .z — one evaluation, two uses.
    const swayAmount = sway.toVar();

    const heightBend = posNode.y.max(0.0).pow(2.0).toVar();

    const windBend = vec3(
        uWindDirection.x.mul(swayAmount).mul(heightBend),
        float(0.0),
        uWindDirection.z.mul(swayAmount).mul(heightBend)
    );

    return windBend;
};

export { getWindTextureData, windComputeSystem } from '../wind-compute.ts';

export const calculateFlowerBloom = (posNode?: any) => {
    const _pos = posNode || positionLocal;

    const aPoseState = attribute('aPoseState', 'float');

    const breath = sin(uTime.mul(2.0)).mul(0.05);
    const bloom = uAudioLow.mul(0.3);
    // Gust makes blooms open a touch wider on a swell, matching the stems.
    const gustOpen = uWindGust.sub(1.0).mul(0.04);
    const scale = float(1.0).add(aPoseState).add(breath).add(bloom).add(gustOpen);

    return scale.mul(_pos);
};

export const applyStandardDeformation = (basePosNode: any, options?: WindDeformationOptions) => {
    return applyPlayerInteraction(basePosNode.add(calculateWindSway(basePosNode, options)));
};
