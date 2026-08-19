import * as THREE from 'three';
import type { ShaderNodeObject } from 'three/src/nodes/tsl/TSLCore.js';
import {
    color,
    float,
    uv,
    mix,
    vec3,
    dot,
    max,
    mx_noise_float,
    positionLocal,
    positionWorld,
    positionView,
    normalWorld,
    normalLocal,
    cameraPosition,
    sin,
    abs,
    normalize,
    smoothstep,
    exp,
} from 'three/tsl';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { globalClusteredLighting } from '../../rendering/clustered-lighting.ts';
import { getIrradianceNode } from '../../rendering/irradiance-probes.ts';
import { applyGlitch } from '../glitch.ts';
import {
    uTime,
    uAudioHigh,
    uGlitchIntensity,
    uGlitchExplosionCenter,
    uGlitchExplosionRadius,
} from './shared-resources.ts';
import { triplanarNoise, perturbNormal, createRimLight } from './tsl-nodes.ts';
import { $sn } from './tsl-types.ts';
import { getLocalLightStats } from '../../rendering/lights.ts';

export interface UnifiedMaterialOptions {
    colorNode?: Node;
    deformationNode?: Node;
    roughness?: number;
    metalness?: number;
    bumpStrength?: number;
    noiseScale?: number;
    triplanar?: boolean;
    side?: THREE.Side;
    transmission?: number;
    thickness?: number;
    ior?: number;
    thicknessDistortion?: number;
    subsurfaceStrength?: number;
    subsurfaceColor?: number | string | THREE.Color;
    iridescenceStrength?: number;
    iridescenceFresnelPower?: number;
    sheen?: number;
    sheenColor?: number | string | THREE.Color;
    sheenRoughness?: number;
    animateMoisture?: boolean;
    animatePulse?: boolean;
    audioReactStrength?: number;
    emissive?: number | string | THREE.Color;
    emissiveIntensity?: number;
    contactDarkening?: number;
    contactDarkeningHeight?: number;
    rimStrength?: number;
    rimColor?: number | string | THREE.Color;
    rimPower?: number;
}

export function createUnifiedMaterial(
    hexColor: number | string | THREE.Color,
    options: UnifiedMaterialOptions = {}
) {
    const {
        colorNode = null,
        deformationNode = null,
        roughness = 0.5,
        metalness = 0.0,
        bumpStrength = 0.0,
        noiseScale = 5.0,
        triplanar = false,
        side = THREE.FrontSide,
        emissive = null,
        emissiveIntensity = 1.0,
        transmission = 0.0,
        thickness = 0.0,
        ior = 1.5,
        thicknessDistortion = 0.0,
        subsurfaceStrength = 0.0,
        subsurfaceColor = 0xffffff,
        iridescenceStrength = 0.0,
        iridescenceFresnelPower = 4.0,
        sheen = 0.0,
        sheenColor = 0xffffff,
        sheenRoughness = 1.0,
        animateMoisture = false,
        animatePulse = false,
        audioReactStrength = 0.0,
        contactDarkening = 0.0,
        contactDarkeningHeight = 1.0,
        rimStrength = 0.0,
        rimColor = 0xffffff,
        rimPower = 3.0,
    } = options;

    const material = new MeshPhysicalNodeMaterial();

    if (colorNode) {
        material.colorNode = colorNode;
    } else {
        material.colorNode = color(hexColor);
    }

    if (contactDarkening > 0.0) {
        const gradient = smoothstep(float(0.0), float(contactDarkeningHeight), positionLocal.y).pow(
            2.0
        );
        const aoFactor = mix(float(1.0).sub(float(contactDarkening)), float(1.0), gradient);
        material.colorNode = $sn(material.colorNode).mul(aoFactor);
    }
    material.roughnessNode = float(roughness);
    material.metalnessNode = float(metalness);
    material.side = side;

    if (emissive !== null) {
        material.emissiveNode = color(emissive).mul(float(emissiveIntensity));
    }

    let surfaceNoise: any = float(0.0);

    if (bumpStrength > 0.0 || thicknessDistortion > 0.0 || animateMoisture) {
        let pos = positionLocal;
        if (animateMoisture) {
            const timeOffset = vec3(0.0, uTime.mul(0.2), 0.0);
            pos = pos.add(timeOffset);
        }

        if (triplanar) {
            surfaceNoise = triplanarNoise(pos, float(noiseScale));
        } else {
            surfaceNoise = mx_noise_float(pos.mul(float(noiseScale)));
        }
    }

    if (bumpStrength > 0.0) {
        material.normalNode = perturbNormal(
            positionLocal,
            normalWorld,
            float(noiseScale),
            float(bumpStrength)
        );

        const cavity = smoothstep(0.3, 0.7, surfaceNoise);
        material.colorNode = $sn(material.colorNode).mul(cavity.mul(0.5).add(0.5));
    }

    if (animateMoisture) {
        const wetness = surfaceNoise.mul(0.3);
        material.roughnessNode = $sn(material.roughnessNode).sub(wetness);
    }

    if (transmission > 0.0) {
        material.transmissionNode = float(transmission);
        material.iorNode = float(ior);
        material.transparent = true;

        let thickNode = float(thickness);
        if (thicknessDistortion > 0.0) {
            thickNode = thickNode.mul(surfaceNoise.mul(thicknessDistortion).add(1.0));
        }
        material.thicknessNode = thickNode;

        const absorption = exp(thickNode.negate().mul(0.5));
        material.colorNode = $sn(material.colorNode).mul(absorption.add(0.2));
    }

    if (subsurfaceStrength > 0.0) {
        const lightDir = normalize(vec3(0.5, 1.0, 0.5));

        const NdotL = dot(normalWorld, lightDir);
        const wrap = float(1.0).sub(max(0.0, NdotL)).pow(2.0);

        const sssColorNode = color(subsurfaceColor);
        const sssEffect = wrap.mul(subsurfaceStrength).mul(sssColorNode);
        material.colorNode = $sn(material.colorNode).add(sssEffect);
    }

    if (iridescenceStrength > 0.0) {
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const NdotV = abs(dot(normalWorld, viewDir));

        const fresnel = float(1.0).sub(NdotV).pow(float(iridescenceFresnelPower));

        const irisR = sin(fresnel.mul(10.0));
        const irisG = sin(fresnel.mul(10.0).add(2.0));
        const irisB = sin(fresnel.mul(10.0).add(4.0));

        const rainbow = vec3(irisR, irisG, irisB).mul(0.5).add(0.5);

        material.emissiveNode = rainbow.mul(iridescenceStrength).mul(fresnel);
    }

    if (animatePulse) {
        const pulse = sin(uTime.mul(3.0)).mul(0.2).add(0.8);
        material.emissiveNode = $sn(material.emissiveNode ?? color(0x000000)).add(
            $sn(material.colorNode).mul(pulse.mul(0.2))
        );
    }

    if (sheen > 0.0) {
        material.sheen = sheen;
        material.sheenNode = color(sheenColor);
        material.sheenRoughnessNode = float(sheenRoughness);
    }

    const basePos: ShaderNodeObject<Node> = $sn(deformationNode ?? material.positionNode ?? positionLocal);

    const distToGlitch = positionWorld.distance(uGlitchExplosionCenter);
    const localGlitchFactor = float(1.0).sub(
        smoothstep(float(0.0), uGlitchExplosionRadius, distToGlitch)
    );
    const isActive = uGlitchExplosionRadius.greaterThan(0.0);
    const localIntensity = localGlitchFactor.mul(float(1.5));
    const combinedIntensity = uGlitchIntensity.add(isActive.select(localIntensity, float(0.0)));

    const glitchRes = applyGlitch(uv(), basePos, combinedIntensity);

    material.positionNode = glitchRes.position;

    if (audioReactStrength > 0.0) {
        const singPulse = uAudioHigh.mul(audioReactStrength);

        const singGlow = $sn(material.colorNode).mul(singPulse).mul(0.5);
        material.emissiveNode = $sn(material.emissiveNode ?? color(0x000000)).add(singGlow);

        const currentPos: ShaderNodeObject<Node> = $sn(material.positionNode ?? positionLocal);

        const vibrationScale = float(20.0);
        const vibrationSpeed = float(10.0);
        const flutterNoise = mx_noise_float(
            positionLocal.mul(vibrationScale).add(uTime.mul(vibrationSpeed))
        );

        const flutterAmp = singPulse.mul(0.02);

        const vibration = normalLocal.mul(flutterNoise).mul(flutterAmp);

        material.positionNode = currentPos.add(vibration);
    }

    if (rimStrength > 0.0) {
        const rimColorNode = color(rimColor);
        const rimEffect = createRimLight(
            rimColorNode,
            float(rimStrength),
            float(rimPower),
            material.normalNode
        );

        material.emissiveNode = $sn(material.emissiveNode ?? color(0x000000)).add(rimEffect);
    }

    if (!getLocalLightStats().webgl) {
        const clusterLight = globalClusteredLighting.getLightingNode(positionWorld,
    positionView, normalWorld, $sn(material.colorNode));
        material.emissiveNode = $sn(material.emissiveNode ?? color(0x000000)).add(clusterLight);
    }

    // Lightweight GI: a soft bounce term from the irradiance probe volume,
    // multiplied by albedo so it tints the material rather than washing it out.
    // Null (and therefore free) whenever the volume was not allocated — `low`
    // tier, CI, `?gi=off`. See docs/IRRADIANCE_PROBES.md.
    const bounce = getIrradianceNode(positionWorld, normalWorld);
    if (bounce) {
        material.emissiveNode = $sn(material.emissiveNode ?? color(0x000000)).add(
            $sn(bounce).mul($sn(material.colorNode))
        );
    }

    material.userData.isUnified = true;
    return material;
}
