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
import {
    areClusteredLightsEnabled,
    globalClusteredLighting,
} from '../../rendering/clustered-lighting.ts';
import { getIrradianceNode } from '../../rendering/irradiance-probes.ts';
import { applyGlitch } from '../glitch.ts';
import {
    uTime,
    uAudioHigh,
    uGlitchIntensity,
    uGlitchExplosionCenter,
    uGlitchExplosionRadius,
} from './shared-resources.ts';
import { applyDreamEnv } from './env-map.ts';
import { triplanarNoise, perturbNormal, createRimLight } from './tsl-nodes.ts';
import { $sn } from './tsl-types.ts';

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
    /** Volumetric tint for `transmission`. Set this and the legacy absorption fudge steps aside. */
    attenuationColor?: number | string | THREE.Color;
    /** World units light travels before it is fully tinted by `attenuationColor`. */
    attenuationDistance?: number;
    subsurfaceStrength?: number;
    subsurfaceColor?: number | string | THREE.Color;
    /** How far light wraps past the terminator. 0 = plain Lambert, ~0.5 = gummy. */
    subsurfaceWrap?: number;
    /** Bends the back-scatter lobe along the normal. Higher = softer, less laser-like. */
    subsurfaceDistortion?: number;
    /** Tightness of the back-scatter lobe. Higher = only a thin glowing edge. */
    subsurfacePower?: number;
    /** Per-unit-thickness extinction of the translucency term. 0 = thickness ignored. */
    subsurfaceThicknessFalloff?: number;
    /** 0 = pure `subsurfaceColor`, 1 = fully multiplied by albedo. Keeps bright hues pastel. */
    subsurfaceAlbedoTint?: number;
    /** Real `MeshPhysicalNodeMaterial` clearcoat lobe. Opt-in — 0 compiles nothing. */
    clearcoat?: number;
    clearcoatRoughness?: number;
    /** Stylized coat tint. See the note in the cookbook: glTF clearcoat has no colour. */
    clearcoatTint?: number | string | THREE.Color;
    clearcoatTintStrength?: number;
    /** Attach the shared dream-sky env (subject to the tier gate in `env-map.ts`). */
    useDreamEnv?: boolean;
    /** Scales the env contribution. Only meaningful alongside `useDreamEnv`. */
    envMapIntensity?: number;
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
        attenuationColor = null,
        attenuationDistance = null,
        subsurfaceStrength = 0.0,
        subsurfaceColor = 0xffffff,
        subsurfaceWrap = 0.5,
        subsurfaceDistortion = 0.2,
        subsurfacePower = 3.0,
        subsurfaceThicknessFalloff = 0.35,
        subsurfaceAlbedoTint = 0.5,
        clearcoat = 0.0,
        clearcoatRoughness = 0.1,
        clearcoatTint = null,
        clearcoatTintStrength = 0.2,
        useDreamEnv = false,
        envMapIntensity = 1.0,
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

    // Thickness is shared between the transmission volume and the translucency
    // term below, so it is built once here rather than inside the branch.
    let thickNode: any = float(thickness);
    if (thickness > 0.0 && thicknessDistortion > 0.0) {
        thickNode = thickNode.mul(surfaceNoise.mul(thicknessDistortion).add(1.0));
    }

    if (transmission > 0.0) {
        material.transmissionNode = float(transmission);
        material.iorNode = float(ior);
        material.transparent = true;
        material.thicknessNode = thickNode;

        if (attenuationColor !== null) {
            // r171 `MeshPhysicalNodeMaterial` reads these through
            // `materialAttenuationColor` / `materialAttenuationDistance` — plain
            // properties, no node, so this adds zero shader instructions beyond
            // the Beer-Lambert term the transmission path already runs.
            material.attenuationColor = new THREE.Color(attenuationColor as any);
            if (attenuationDistance !== null) {
                material.attenuationDistance = attenuationDistance;
            }
        } else {
            // Legacy fudge: darkens albedo by thickness so a thick gummy reads
            // dense even without a real attenuation volume. Kept for every
            // caller that has been tuned against it; `attenuationColor` opts out.
            const absorption = exp(thickNode.negate().mul(0.5));
            material.colorNode = $sn(material.colorNode).mul(absorption.add(0.2));
        }
    }

    if (subsurfaceStrength > 0.0) {
        // NOT subsurface scattering. There is no diffusion profile and no
        // multi-bounce here — this is *wrapped translucency*: a light-wrap term
        // plus a view-dependent back-scatter lobe, both extinguished by
        // thickness. Two dots, a pow and an exp; true SSS would cost a
        // screen-space blur pass we do not have a budget for. Named honestly in
        // docs/CANDY_MATERIAL_COOKBOOK.md so nobody tunes it expecting skin.
        //
        // The previous version was `(1 - max(0, N·L))^2`, which is brightest on
        // the faces pointing *away* from the light and ignores both the view
        // and the thickness — so a gummy glowed hardest exactly where it should
        // have been in shadow.
        const lightDir = normalize(vec3(0.5, 1.0, 0.5));
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const N = $sn(material.normalNode ?? normalWorld);

        // 1. Wrap: push light past the terminator instead of around the back.
        const NdotL = dot(N, lightDir);
        const wrapped = NdotL.add(float(subsurfaceWrap))
            .div(float(1.0 + subsurfaceWrap))
            .clamp();

        // 2. Back-scatter: light that entered the far side and left toward the
        //    eye. Bending the exit vector along N is what stops it reading as a
        //    hard specular dot on the silhouette.
        const exitDir = normalize(lightDir.add(N.mul(float(subsurfaceDistortion))));
        const back = max(0.0, dot(viewDir, exitDir.negate())).pow(float(subsurfacePower));

        // 3. Thickness extinction. `thickNode` carries `thicknessDistortion`, so
        //    a lumpy gummy glows through its thin spots.
        const atten =
            thickness > 0.0 && subsurfaceThicknessFalloff > 0.0
                ? exp(thickNode.negate().mul(float(subsurfaceThicknessFalloff)))
                : float(1.0);

        // 4. Pastel guard: pulling the scatter colour toward albedo keeps a
        //    saturated preset from pushing this term to white.
        const sssTint = mix(
            color(subsurfaceColor),
            color(subsurfaceColor).mul(color(hexColor)),
            float(subsurfaceAlbedoTint)
        );

        const sssEffect = back
            .add(wrapped.mul(0.35))
            .mul(float(subsurfaceStrength))
            .mul(atten)
            .mul(sssTint);

        // Added to albedo, not emissive, on purpose: it stays under the lighting
        // and the GI multiply, so it tints rather than blooms.
        material.colorNode = $sn(material.colorNode).add(sssEffect);
    }

    if (clearcoat > 0.0) {
        // The real second specular lobe (`PhysicalLightingModel`'s clearcoat
        // branch), not a fresnel fake. Opt-in because `useClearcoat` compiles
        // the extra lobe for any material whose `clearcoatNode` is non-null.
        material.clearcoat = clearcoat;
        material.clearcoatNode = float(clearcoat);
        material.clearcoatRoughnessNode = float(clearcoatRoughness);

        if (clearcoatTint !== null) {
            // glTF clearcoat is colourless, so this is a stylized extra: a
            // fresnel-weighted tint riding on top of the coat. Small values
            // only — it is emissive and will feed bloom.
            const coatFresnel = float(1.0)
                .sub(
                    abs(
                        dot(
                            $sn(material.normalNode ?? normalWorld),
                            normalize(cameraPosition.sub(positionWorld))
                        )
                    )
                )
                .pow(4.0);
            const coatGlow = color(clearcoatTint)
                .mul(coatFresnel)
                .mul(float(clearcoatTintStrength * clearcoat));
            material.emissiveNode = $sn(material.emissiveNode ?? color(0x000000)).add(coatGlow);
        }
    }

    if (useDreamEnv) {
        // One shared equirect → one shared PMREM (three keys its cache on the
        // texture), so every batcher instance reflects the same candy sky.
        applyDreamEnv(material, envMapIntensity);
    } else if (envMapIntensity !== 1.0) {
        // Honoured if a caller attaches an env map of its own afterwards.
        material.envMapIntensity = envMapIntensity;
    }

    if (iridescenceStrength > 0.0) {
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const NdotV = abs(dot(normalWorld, viewDir));

        const fresnel = float(1.0).sub(NdotV).pow(float(iridescenceFresnelPower));

        const irisR = sin(fresnel.mul(10.0));
        const irisG = sin(fresnel.mul(10.0).add(2.0));
        const irisB = sin(fresnel.mul(10.0).add(4.0));

        const rainbow = vec3(irisR, irisG, irisB).mul(0.5).add(0.5);

        // `add`, not `=`: assigning here used to silently drop an `emissive`
        // option (and, on OilSlick, anything a caller layered in before it).
        material.emissiveNode = $sn(material.emissiveNode ?? color(0x000000)).add(
            rainbow.mul(iridescenceStrength).mul(fresnel)
        );
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

    const basePos: ShaderNodeObject<Node> = $sn(
        deformationNode ?? material.positionNode ?? positionLocal
    );

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

    if (areClusteredLightsEnabled()) {
        const clusterLight = globalClusteredLighting.getLightingNode(
            positionWorld,
            positionView,
            normalWorld,
            $sn(material.colorNode)
        );
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
