import {
    color,
    float,
    vec3,
    Fn,
    dot,
    max,
    mx_noise_float,
    positionWorld,
    positionLocal,
    normalWorld,
    normalLocal,
    cameraPosition,
    sin,
    mix,
    abs,
    normalize,
    smoothstep,
} from 'three/tsl';
import { uTime, uAudioHigh } from './shared-resources.ts';
import type { TSLArg, TSLArgOpt } from './tsl-types.ts';

export const triplanarNoise = Fn<[TSLArg, TSLArg]>(([pos, scale]) => {
    const p = pos.mul(scale);
    const n = abs(normalWorld);

    const noiseX = mx_noise_float(vec3(p.y, p.z, 0.0));
    const noiseY = mx_noise_float(vec3(p.x, p.z, 0.0));
    const noiseZ = mx_noise_float(vec3(p.x, p.y, 0.0));

    const blend = n.div(n.x.add(n.y).add(n.z));
    return noiseX.mul(blend.x).add(noiseY.mul(blend.y)).add(noiseZ.mul(blend.z));
});

export const perturbNormal = Fn<[TSLArg, TSLArg, TSLArg, TSLArg]>(
    ([pos, normal, scale, strength]) => {
        const eps = float(0.01);
        const s = scale;

        const n0 = mx_noise_float(pos.mul(s));
        const nX = mx_noise_float(pos.add(vec3(eps, 0.0, 0.0)).mul(s));
        const nY = mx_noise_float(pos.add(vec3(0.0, eps, 0.0)).mul(s));
        const nZ = mx_noise_float(pos.add(vec3(0.0, 0.0, eps)).mul(s));

        const dx = nX.sub(n0).div(eps);
        const dy = nY.sub(n0).div(eps);
        const dz = nZ.sub(n0).div(eps);

        const noiseGrad = vec3(dx, dy, dz);
        const perturbed = normalize(normal.sub(noiseGrad.mul(strength)));
        return perturbed;
    }
);

export const createRimLight = Fn<[TSLArg, TSLArg, TSLArg, TSLArgOpt]>(
    ([colorNode, intensity, power, normalNode]) => {
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const N = normalNode || normalWorld;

        const NdotV = abs(dot(N, viewDir));
        const rim = float(1.0).sub(NdotV).pow(power);
        return colorNode.mul(rim).mul(intensity);
    }
);

export const createJuicyRimLight = Fn<[TSLArg, TSLArg, TSLArg, TSLArgOpt]>(
    ([baseColor, intensity, power, normalNode]) => {
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const N = normalNode || normalWorld;
        const NdotV = abs(dot(N, viewDir));
        const rim = float(1.0).sub(NdotV).pow(power);

        const pulse = sin(uTime.mul(3.0)).mul(0.2).add(0.8);
        const audioBoost = uAudioHigh.mul(2.0);

        const magicColor = color(0x00ffff);
        const colorMix = rim.mul(0.5).add(audioBoost.mul(0.2)).min(1.0);
        const finalColor = mix(baseColor, magicColor, colorMix);

        const finalIntensity = intensity.mul(pulse).add(audioBoost);

        return finalColor.mul(rim).mul(finalIntensity);
    }
);

export const createSugarSparkle = Fn<[TSLArgOpt, TSLArg, TSLArg, TSLArg]>(
    ([normalNode, scale, density, intensity]) => {
        const viewDir = normalize(cameraPosition.sub(positionWorld));

        const noiseCoord = positionLocal.mul(scale).add(viewDir.mul(2.0));

        const noiseVal = mx_noise_float(noiseCoord);

        const threshold = float(1.0).sub(density);

        const sparkle = smoothstep(threshold, float(1.0), noiseVal);

        const audioBoost = uAudioHigh.mul(3.0).add(1.0);

        const effectiveNormal = normalNode ?? normalLocal;
        const NdotV = abs(dot(effectiveNormal, viewDir));
        const fresnel = float(1.0).sub(NdotV).pow(2.0).add(0.5);

        return sparkle.mul(intensity).mul(audioBoost).mul(fresnel);
    }
);

export const addRimLight = Fn<[TSLArg, TSLArgOpt]>(([baseColorNode, normalNode]) => {
    return baseColorNode.add(createRimLight(color(0xffffff), float(0.5), float(3.0), normalNode));
});

export const colorFromNote = Fn<[TSLArg]>(([noteIndex]) => {
    const angle = noteIndex.div(12.0).mul(6.28318);

    const r = sin(angle).mul(0.5).add(0.5);
    const g = sin(angle.add(2.0944)).mul(0.5).add(0.5);
    const b = sin(angle.add(4.1888)).mul(0.5).add(0.5);

    return vec3(r, g, b);
});
