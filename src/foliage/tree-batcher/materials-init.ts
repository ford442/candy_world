import * as THREE from 'three';
import {
    color, float, vec3, positionLocal, mix, sin, cos, positionWorld,
    instanceIndex as tslInstanceIndex, add,
} from 'three/tsl';
import { varyingProperty, normalWorld } from 'three/tsl';
import { CONFIG } from '../../core/config.ts';
import { registerFoliageBatcherLod } from '../../systems/batcher-lod.ts';
import { BiomeUniforms, uCircadianPoseOffset, circadianDayGlowMult, circadianNightGlowMult } from '../../systems/biome-uniforms.ts';
import { getCylinderGeometry, getTorusKnotGeometry } from '../../utils/geometry-dedup.ts';
import { foliageGroup } from '../../world/state.ts';
import { applyAerialPerspective, aerialPerspectiveLodBoost } from '../aerial-perspective.ts';
import { applyInstanceAnimation } from '../animation-nodes.ts';
import { initInstanceLodAttribute } from '../batcher-lod-utils.ts';
import {
    CandyPresets,
    sharedGeometries,
    createJuicyRimLight,
    uTime,
    uAudioHigh,
    uAudioLow,
    uWindSpeed,
    createSugarSparkle,
} from '../index.ts';
import { applyBaseContactAO, getBaseContactHeight } from '../index.ts';
import {
    foliageDeformationOffset,
    scaleEmissiveByLod,
    lodHeroOnlyMultiplier,
    lodHeroGate,
    lodMidOnlyGate,
    applyFoliageLodMaterialFade,
} from '../lod-nodes.ts';
import { uTwilight } from '../sky.ts';
import type { TreeBatcherState } from './types.ts';


export function initializeTreeBatcherMeshes(state: TreeBatcherState, getLODMeshes: () => THREE.InstancedMesh[]): void {
    if (state.initialized) return;

        if (state.initialized) return;

        // --- 1. Trunk Batch (Cylinder) ---
        // PALETTE: Upgrade to "Clay Bark"
        // Use instanceColor but darken bottom for grounding
        const instanceColor = varyingProperty('vec3', 'vInstanceColor');
        const trunkColorRaw = mix(instanceColor.mul(0.6), instanceColor, positionLocal.y);
        const trunkColorGrounded = applyBaseContactAO(
            trunkColorRaw,
            positionLocal.y,
            float(getBaseContactHeight('tree')),
        );
        const trunkColor = applyAerialPerspective(trunkColorGrounded, positionWorld, aerialPerspectiveLodBoost());

        // Combined Deformation: Interaction + Wind + Circadian
        const animOffsetTrunk = applyInstanceAnimation();
        const circadianDroopTrunk = vec3(0, float(-0.5).mul(uCircadianPoseOffset).mul(positionLocal.y), 0);
        const baseTrunkPos = positionLocal.add(animOffsetTrunk).add(circadianDroopTrunk);
        const trunkDeform = foliageDeformationOffset(baseTrunkPos);

        // Create Material using CandyPresets.Clay for nice bump/rim
        const trunkMat = CandyPresets.Clay(0x8B4513, {
            colorNode: trunkColor,
            roughness: 0.8,
            bumpStrength: 0.2, // Bark texture
            rimStrength: 0.3,  // Subtle separation
            deformationNode: trunkDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction
            triplanar: true    // Avoid UV seams on cylinder
        });

        // 🎨 PALETTE: Add Juicy Rim Light to tree trunks
        trunkMat.emissiveNode = add(
            trunkMat.emissiveNode ?? color(0x000000),
            createJuicyRimLight(color(0x8B4513), float(1.0).add(uAudioLow.mul(0.5)), float(3.0), null)
        );

        applyFoliageLodMaterialFade(trunkMat);

        state.trunks = new THREE.InstancedMesh(sharedGeometries.unitCylinder, trunkMat, state.trunkCapacity);
        state.trunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.trunkCapacity * 3), 3);
        state.trunks.geometry.setAttribute('instanceColor', state.trunks.instanceColor);
        state.trunks.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(state.trunkCapacity), 1));
        state.trunks.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(state.trunkCapacity), 1));
        initInstanceLodAttribute(state.trunks, state.trunkCapacity);
        state.trunks.castShadow = true;
        state.trunks.receiveShadow = true;
        state.trunks.count = 0;
        foliageGroup.add(state.trunks);

        // --- 2. Sphere Batch (Leaves/Blooms) ---
        // PALETTE: "Flutter" + "Squash" Juice
        const sphereInstanceColor = varyingProperty('vec3', 'vInstanceColor');
        const sphereColor = applyAerialPerspective(
            sphereInstanceColor as unknown as ReturnType<typeof vec3>,
            positionWorld,
            aerialPerspectiveLodBoost(),
        );

        // Flutter: High frequency vertex displacement driven by wind
        const flutterSpeed = float(15.0);
        const flutterAmp = float(0.08).mul(uWindSpeed.add(0.5));
        // Use world position to decorrelate instances
        const flutterPhase = uTime.mul(flutterSpeed).add(positionWorld.x).add(positionWorld.z);
        const flutter = sin(flutterPhase).mul(flutterAmp);
        // Apply jitter to positionLocal
        const flutterOffset = vec3(flutter, flutter.mul(0.5), flutter.mul(0.8));

        // Squash: React to Kick (Low Freq)
        const kickSquash = uAudioLow.mul(0.25);
        // Squash Y, Bulge XZ (Volume preservation approximation)
        const squashScale = vec3(
            float(1.0).add(kickSquash.mul(0.5)), // X bulge
            float(1.0).sub(kickSquash),          // Y squash
            float(1.0).add(kickSquash.mul(0.5))  // Z bulge
        );

        const animOffsetSphere = applyInstanceAnimation();
        const circadianDroopSphere = vec3(0, float(-1.0).mul(uCircadianPoseOffset).mul(positionLocal.y), 0);
        const baseSpherePos = positionLocal.add(animOffsetSphere).add(circadianDroopSphere);
        const sphereBaseDeform = foliageDeformationOffset(baseSpherePos);
        const flutterWeight = lodHeroGate().add(lodMidOnlyGate().mul(0.25));
        const sphereFluttered = sphereBaseDeform.add(flutterOffset.mul(flutterWeight));
        const squashScaleLod = lodHeroOnlyMultiplier(squashScale);
        const sphereFinalDeform = sphereFluttered.mul(squashScaleLod);

        // Base Emissive logic based on High Freq Audio
        const sphereEmissive = sphereInstanceColor.mul(uAudioHigh.mul(1.5).add(0.2));

        // 🎨 PALETTE: Twilight Glow System Support

        const glowPhaseOffset = float(tslInstanceIndex).mul(0.1);
        const glowPulseFreq = float(CONFIG.glow.glowPulseFrequency);
        const glowPulseAmp = float(CONFIG.glow.glowPulseAmplitude);

        // Idle pulse responding to audio and time, with phase offset
        const idlePulse = sin(uTime.mul(glowPulseFreq).add(glowPhaseOffset)).mul(glowPulseAmp).add(1.0).mul(float(0.5)).mul(uAudioLow.mul(0.5));

        // Target glow color from config mapped to twilight
        const targetGlowColor = color(CONFIG.glow.glowColorMap['tree']);
        const twilightGlowTint = targetGlowColor.mul(uTwilight).mul(float(CONFIG.glow.glowIntensityMax)).mul(float(0.5).add(idlePulse));
        // Diurnal canopy: music shimmer rests at night; twilight tint still fires via uTwilight.
        const dayGlow = circadianDayGlowMult(0.3);
        const nightGlow = circadianNightGlowMult();

        // Add Sugar Sparkle! (Palette Polish)
        // Scale 15.0 for fine grain, Density 0.3 for sparse twinkle, Intensity 2.0
        const sugarSparkle = createSugarSparkle(normalWorld, float(15.0), float(0.3), float(2.0));

        // Material: Gummy for slight translucency/juice
        const sphereMat = CandyPresets.Gummy(0x228B22, {
            colorNode: sphereColor,
            roughness: 0.4,
            transmission: 0.3, // Semi-opaque
            thickness: 1.0,
            deformationNode: sphereFinalDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction
            rimStrength: 0.6, // Strong rim for pop
            audioReactStrength: 0.5 // Inner glow pulse
        });

        // 🎨 PALETTE: Make tree leaves pop with sparkly glow, base audio emissive, and twilight glow
        sphereMat.emissiveNode = scaleEmissiveByLod(
            sphereEmissive.mul(BiomeUniforms.arpeggioGrove.noteColor).mul(dayGlow)
                .add(sugarSparkle.mul(dayGlow))
                .add(twilightGlowTint.mul(nightGlow))
                .add(createJuicyRimLight(color(0xFFFFFF), float(1.5), float(3.0), null).mul(dayGlow))
        );
        applyFoliageLodMaterialFade(sphereMat);

        state.spheres = new THREE.InstancedMesh(sharedGeometries.unitSphere, sphereMat, state.sphereCapacity);
        state.spheres.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.sphereCapacity * 3), 3);
        state.spheres.geometry.setAttribute('instanceColor', state.spheres.instanceColor);
        state.spheres.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(state.sphereCapacity), 1));
        state.spheres.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(state.sphereCapacity), 1));
        initInstanceLodAttribute(state.spheres, state.sphereCapacity);
        state.spheres.castShadow = true;
        state.spheres.receiveShadow = true;
        state.spheres.count = 0;
        foliageGroup.add(state.spheres);

        // --- 3. Capsule Batch (Branches) ---
        const capsuleColorRaw = varyingProperty('vec3', 'vInstanceColor');
        const capsuleColorGrounded = applyBaseContactAO(
            capsuleColorRaw as unknown as ReturnType<typeof vec3>,
            positionLocal.y,
            float(getBaseContactHeight('tree')),
        );
        const capsuleColor = applyAerialPerspective(
            capsuleColorGrounded,
            positionWorld,
            aerialPerspectiveLodBoost(),
        );
        const animOffsetCapsule = applyInstanceAnimation();
        const circadianDroopCapsule = vec3(0, float(-1.0).mul(uCircadianPoseOffset).mul(positionLocal.y), 0);
        const baseCapsulePos = positionLocal.add(animOffsetCapsule).add(circadianDroopCapsule);
        const capsuleDeform = foliageDeformationOffset(baseCapsulePos);

        const capsuleMat = CandyPresets.Clay(0x8B4513, {
            colorNode: capsuleColor,
            roughness: 0.7,
            deformationNode: capsuleDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction
            rimStrength: 0.4
        });

        applyFoliageLodMaterialFade(capsuleMat);

        state.capsules = new THREE.InstancedMesh(sharedGeometries.capsule, capsuleMat, state.capsuleCapacity);
        state.capsules.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.capsuleCapacity * 3), 3);
        state.capsules.geometry.setAttribute('instanceColor', state.capsules.instanceColor);
        state.capsules.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(state.capsuleCapacity), 1));
        state.capsules.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(state.capsuleCapacity), 1));
        initInstanceLodAttribute(state.capsules, state.capsuleCapacity);
        state.capsules.castShadow = true;
        state.capsules.receiveShadow = true;
        state.capsules.count = 0;
        foliageGroup.add(state.capsules);

        // --- 4. Helix Batch (Vines/Strange Plants) ---
        // PALETTE: Neon Pulse
        const helixColor = applyAerialPerspective(
            varyingProperty('vec3', 'vInstanceColor') as unknown as ReturnType<typeof vec3>,
            positionWorld,
            aerialPerspectiveLodBoost(),
        );

        // Spiral Math for Geometry (applied in vertex shader)
        const t = positionLocal.y; // 0 to 1
        const angle = t.mul(float(Math.PI * 6.0)); // More twists
        const radius = t.mul(0.3).add(sin(uTime.mul(2.0).add(t.mul(10.0))).mul(0.05)); // Breathing radius

        const spiralPos = vec3(cos(angle).mul(radius), t, sin(angle).mul(radius));
        const animOffsetHelix = applyInstanceAnimation();
        const circadianDroopHelix = vec3(0, float(-1.0).mul(uCircadianPoseOffset).mul(t), 0);
        const baseHelixPos = spiralPos.add(animOffsetHelix).add(circadianDroopHelix);
        const helixDeform = foliageDeformationOffset(baseHelixPos, undefined, spiralPos);

        // Emissive Pulse (Scrolling light)
        const pulseSpeed = float(2.0);
        const pulsePhase = t.mul(10.0).sub(uTime.mul(pulseSpeed));
        const pulse = sin(pulsePhase).mul(0.5).add(0.5); // 0..1
        const audioBoost = uAudioHigh.mul(1.5);

        const helixMat = CandyPresets.Gummy(0x00FA9A, {
            colorNode: helixColor,
            roughness: 0.2,
            deformationNode: helixDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction
            emissive: 0xFFFFFF,
            emissiveIntensity: 1.0,
            rimStrength: 0.8
        });
        helixMat.emissiveNode = color(0xFFFFFF).mul(pulse.mul(0.5).add(audioBoost));

        applyFoliageLodMaterialFade(helixMat);

        // Geometry: Use simple cylinder, deformed by shader to spiral
        // ⚡ OPTIMIZATION: Use shared geometry via registry (deduplicated)
        const helixGeo = getCylinderGeometry(1, 1, 1, 16, 30);
        helixGeo.translate(0, 0.5, 0);

        state.helices = new THREE.InstancedMesh(helixGeo, helixMat, state.helixCapacity);
        state.helices.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.helixCapacity * 3), 3);
        state.helices.geometry.setAttribute('instanceColor', state.helices.instanceColor);
        state.helices.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(state.helixCapacity), 1));
        state.helices.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(state.helixCapacity), 1));
        initInstanceLodAttribute(state.helices, state.helixCapacity);
        state.helices.castShadow = true;
        state.helices.receiveShadow = true;
        state.helices.count = 0;
        foliageGroup.add(state.helices);

        // --- 5. Rose Batch (TorusKnot) ---
        // PALETTE: Velvet/Sugar Look
        const roseColor = applyAerialPerspective(
            varyingProperty('vec3', 'vInstanceColor') as unknown as ReturnType<typeof vec3>,
            positionWorld,
            aerialPerspectiveLodBoost(),
        );
        const animOffsetRose = applyInstanceAnimation();
        const circadianDroopRose = vec3(0, float(-1.0).mul(uCircadianPoseOffset).mul(positionLocal.y), 0);
        const baseRosePos = positionLocal.add(animOffsetRose).add(circadianDroopRose);
        const roseDeform = foliageDeformationOffset(baseRosePos);

        // Use Sugar preset for crystalline/sparkly look
        const accordionLeafGeo = new THREE.CylinderGeometry(0.05, 0.1, 1.5, 8);
        accordionLeafGeo.translate(0, 0.75, 0);
        const accordionLeafMat = CandyPresets.Clay(0xFFD700, {
            colorNode: instanceColor,
            roughness: 0.8,
            deformationNode: foliageDeformationOffset(positionLocal),
            audioReactStrength: 0.5
        });
        // Sway intensity driven by shimmer, hue shift by hueShift
        const baseSway = foliageDeformationOffset(positionLocal);
        const accordionSwayDeform = baseSway.mul(BiomeUniforms.musicalFlora.shimmer.add(1.0));
        (accordionLeafMat as any).colorNode = instanceColor.add(BiomeUniforms.musicalFlora.noteColor.mul(BiomeUniforms.musicalFlora.hueShift));
        (accordionLeafMat as any).deformationNode = accordionSwayDeform;
        (accordionLeafMat as any).emissiveNode = BiomeUniforms.musicalFlora.noteColor
            .mul(BiomeUniforms.musicalFlora.shimmer.add(0.5))
            .mul(circadianDayGlowMult(0.25));
        applyFoliageLodMaterialFade(accordionLeafMat);

        const roseMat = CandyPresets.Sugar(0xFF69B4, {
            colorNode: roseColor,
            roughness: 0.4,
            deformationNode: roseDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction
            sheen: 1.0,
            audioReactStrength: 0.8 // Strong glow response
        });

        applyFoliageLodMaterialFade(roseMat);

        // ⚡ OPTIMIZATION: Use shared geometry via registry (deduplicated)
        const roseGeo = getTorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3);
        state.roses = new THREE.InstancedMesh(roseGeo, roseMat, state.roseCapacity);
        state.accordionLeaves = new THREE.InstancedMesh(accordionLeafGeo, accordionLeafMat, state.accordionLeafCapacity);
        state.roses.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.roseCapacity * 3), 3);
        state.accordionLeaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(state.accordionLeafCapacity * 3), 3);
        state.roses.geometry.setAttribute('instanceColor', state.roses.instanceColor);
        state.roses.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(state.roseCapacity), 1));
        state.accordionLeaves.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(state.accordionLeafCapacity), 1));
        state.roses.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(state.roseCapacity), 1));
        state.accordionLeaves.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(state.accordionLeafCapacity), 1));
        initInstanceLodAttribute(state.roses, state.roseCapacity);
        initInstanceLodAttribute(state.accordionLeaves, state.accordionLeafCapacity);
        state.roses.castShadow = true;
        state.roses.receiveShadow = true;
        state.roses.count = 0;
        foliageGroup.add(state.roses);
        foliageGroup.add(state.accordionLeaves);

    state.initialized = true;
    registerFoliageBatcherLod({ id: 'tree', getMeshes: getLODMeshes });
    console.log('[TreeBatcher] Initialized tree batching system with Juicy Materials');
}
