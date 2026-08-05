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

    const pushDir = normalize(playerDistH);

    const heightFactor = positionLocal.y.max(0.0);
    const bendAmount = pushStrength.mul(1.5).mul(heightFactor);

    return vec3(pushDir.x.mul(bendAmount), float(0.0), pushDir.z.mul(bendAmount));
});

export const applyPlayerInteraction = (basePosNode: any) => {
    return basePosNode.add(calculatePlayerPush(basePosNode));
};

export const calculateWindSway = Fn<[TSLArg]>(([posNode]) => {
    const windTime = uTime.mul(uWindSpeed.add(0.5));
    const swayPhase = positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.5)).add(windTime);
    const swayAmount = sin(swayPhase).mul(0.1).mul(uWindSpeed.add(0.2));

    const heightFactor = posNode.y.max(0.0);
    const heightBend = heightFactor.pow(2.0);

    const windBend = vec3(
        uWindDirection.x.mul(swayAmount).mul(heightBend),
        float(0.0),
        uWindDirection.z.mul(swayAmount).mul(heightBend)
    );

    return windBend;
});

export const calculateWindSwayLegacy = Fn<[TSLArg]>(([posNode]) => {
    const windTime = uTime.mul(uWindSpeed.add(0.5));
    const swayPhase = positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.5)).add(windTime);
    const swayAmount = sin(swayPhase).mul(0.1).mul(uWindSpeed.add(0.2));

    const heightFactor = posNode.y.max(0.0);

    const windBend = vec3(
        uWindDirection.x.mul(swayAmount).mul(heightFactor.pow(2.0)),
        float(0.0),
        uWindDirection.z.mul(swayAmount).mul(heightFactor.pow(2.0))
    );

    return windBend;
});

export { getWindTextureData, windComputeSystem } from '../wind-compute.ts';

export const calculateFlowerBloom = (posNode?: any) => {
    const _pos = posNode || positionLocal;

    const aPoseState = attribute('aPoseState', 'float');

    const breath = sin(uTime.mul(2.0)).mul(0.05);
    const bloom = uAudioLow.mul(0.3);
    const scale = float(1.0).add(aPoseState).add(breath).add(bloom);

    return scale.mul(_pos);
};

export const applyStandardDeformation = (basePosNode: any) => {
    return applyPlayerInteraction(basePosNode.add(calculateWindSway(basePosNode)));
};
