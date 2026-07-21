import { safeRemoveAndDispose } from "../utils/dispose-utils.ts";
import { getGroundAlignedQuaternion } from '../world/placement-utils.ts';
// src/foliage/tree-batcher.ts
// Lazy dynamic buffer growth: Starts with INITIAL_INSTANCES=100, doubles capacity as needed.
// Reduces startup allocation from 93,000 to ~500 instances for typical maps.

import * as THREE from 'three';
import { instanceIndex, foliageGroup } from '../world/state.ts';
import {
    CandyPresets,
    createStandardNodeMaterial,
    sharedGeometries,
    createJuicyRimLight,
    uTime,
    uAudioHigh,
    uAudioLow,
    uWindSpeed,
    uGlitchIntensity,
    applyPlayerInteraction,
    applyBaseContactAO,
    getBaseContactHeight,
} from './index.ts';
import {
    color, float, vec3, positionLocal, mix, attribute, uv, sin, cos, positionWorld, smoothstep,
    mx_noise_float, normalWorld, varyingProperty, instanceIndex as tslInstanceIndex
} from 'three/tsl';
import { applyGlitch } from './glitch.ts';
import { getCylinderGeometry, getTorusKnotGeometry } from '../utils/geometry-dedup.ts';
import { createSugarSparkle } from './index.ts';
import { uTwilight } from './sky.ts';
import { BiomeUniforms, uCircadianPoseOffset } from '../systems/biome-uniforms.ts';
import { CONFIG } from '../core/config.ts';
import { applyInstanceAnimation, ANIMATION_TYPES } from './animation-nodes.ts';
import {
    foliageDeformationOffset,
    scaleEmissiveByLod,
    lodHeroOnlyMultiplier,
    lodHeroGate,
    lodMidOnlyGate,
    applyFoliageLodMaterialFade,
} from './lod-nodes.ts';
import { initInstanceLodAttribute, copyInstanceLodOnGrow } from './batcher-lod-utils.ts';
import { registerFoliageBatcherLod, refreshFoliageLodMesh } from '../systems/batcher-lod.ts';
import { getCIAdjustedCount } from '../core/config.ts';
import { applyAerialPerspective, aerialPerspectiveLodBoost } from './aerial-perspective.ts';
import { batchComposeMatrices_c } from '../utils/wasm-batch.ts';
import { isEmscriptenReady } from '../utils/wasm-loader-core.ts';

const _scratchTreeMatrix = new THREE.Matrix4();
const _scratchTreeOriginalQuaternion = new THREE.Quaternion();
const _scratchTreeFinalQuaternion = new THREE.Quaternion();
const _scratchPosition = new THREE.Vector3();
const _scratchScale = new THREE.Vector3();

// Zero-allocation static batch queue buffers
const BATCH_QUEUE_LIMIT = 500 * 6; // MAX_INSTANCES * (trunks+spheres+capsules+helices+roses+leaves)
const _batchPositions = new Float32Array(BATCH_QUEUE_LIMIT * 3);
const _batchQuaternions = new Float32Array(BATCH_QUEUE_LIMIT * 4);
const _batchScales = new Float32Array(BATCH_QUEUE_LIMIT * 3);
const _batchOutputMatrices = new Float32Array(BATCH_QUEUE_LIMIT * 16);

interface PendingInstance {
    mesh: THREE.InstancedMesh;
    index: number;
    color: THREE.Color;
    animType: number;
    animOffset: number;
}

const _defaultColorWhite = new THREE.Color(0xFFFFFF);
const _defaultColorOrange = new THREE.Color(0xFF4500);
const _defaultColorGreen = new THREE.Color(0x00FA9A);

// Initial capacity - grows dynamically as needed (doubles each time, capped at MAX)
const INITIAL_INSTANCES = getCIAdjustedCount(100, 0.5, 50);
const MAX_INSTANCES = getCIAdjustedCount(500, 0.1, 50); // Cap to prevent WebGPU uniform buffer overflow (64KB limit)

export class TreeBatcher {
    private static instance: TreeBatcher;
    private initialized = false;

    // Batches
    private trunks: THREE.InstancedMesh;
    private spheres: THREE.InstancedMesh;
    private capsules: THREE.InstancedMesh;
    private helices: THREE.InstancedMesh;
    private roses: THREE.InstancedMesh;

    // Instance counts
    private trunkCount = 0;
    private sphereCount = 0;
    private capsuleCount = 0;
    private helixCount = 0;
    private roseCount = 0;

    // Capacity tracking (dynamic growth)
    private trunkCapacity = INITIAL_INSTANCES;
    private sphereCapacity = INITIAL_INSTANCES;
    private capsuleCapacity = INITIAL_INSTANCES;
    private helixCapacity = INITIAL_INSTANCES;
    private roseCapacity = INITIAL_INSTANCES;
    private accordionLeafCount = 0;
    private accordionLeafCapacity = INITIAL_INSTANCES;
    private accordionLeaves!: THREE.InstancedMesh;

    // Batch queue for WASM matrix composition
    private _pendingInstances: PendingInstance[] = [];

    private constructor() {
        // Deferred initialization
    }

    /**
     * Pre-allocate a larger initial capacity before init() to avoid runtime growth spikes.
     * This is map-driven and optional; values are clamped to safe WebGPU limits.
     */
    setInitialCapacity(target: number): void {
        if (this.initialized) return;
        if (!Number.isFinite(target)) return;
        const clamped = Math.min(MAX_INSTANCES, Math.max(INITIAL_INSTANCES, Math.floor(target)));
        this.trunkCapacity = clamped;
        this.sphereCapacity = clamped;
        this.capsuleCapacity = clamped;
        this.helixCapacity = clamped;
        this.roseCapacity = clamped;
        this.accordionLeafCapacity = clamped;
    }

    static getInstance(): TreeBatcher {
        if (!TreeBatcher.instance) {
            TreeBatcher.instance = new TreeBatcher();
        }
        return TreeBatcher.instance;
    }

    init() {
        if (this.initialized) return;

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

        applyFoliageLodMaterialFade(trunkMat);

        this.trunks = new THREE.InstancedMesh(sharedGeometries.unitCylinder, trunkMat, this.trunkCapacity);
        this.trunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.trunkCapacity * 3), 3);
        this.trunks.geometry.setAttribute('instanceColor', this.trunks.instanceColor);
        this.trunks.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(this.trunkCapacity), 1));
        this.trunks.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(this.trunkCapacity), 1));
        initInstanceLodAttribute(this.trunks, this.trunkCapacity);
        this.trunks.castShadow = true;
        this.trunks.receiveShadow = true;
        this.trunks.count = 0;
        foliageGroup.add(this.trunks);

        // --- 2. Sphere Batch (Leaves/Blooms) ---
        // PALETTE: "Flutter" + "Squash" Juice
        const sphereInstanceColor = varyingProperty('vec3', 'vInstanceColor');
        const sphereColor = applyAerialPerspective(
            sphereInstanceColor,
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
            sphereEmissive.mul(BiomeUniforms.arpeggioGrove.noteColor).add(sugarSparkle).add(twilightGlowTint).add(createJuicyRimLight(color(0xFFFFFF), float(1.5), float(3.0), null))
        );
        applyFoliageLodMaterialFade(sphereMat);

        this.spheres = new THREE.InstancedMesh(sharedGeometries.unitSphere, sphereMat, this.sphereCapacity);
        this.spheres.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.sphereCapacity * 3), 3);
        this.spheres.geometry.setAttribute('instanceColor', this.spheres.instanceColor);
        this.spheres.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(this.sphereCapacity), 1));
        this.spheres.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(this.sphereCapacity), 1));
        initInstanceLodAttribute(this.spheres, this.sphereCapacity);
        this.spheres.castShadow = true;
        this.spheres.receiveShadow = true;
        this.spheres.count = 0;
        foliageGroup.add(this.spheres);

        // --- 3. Capsule Batch (Branches) ---
        const capsuleColorRaw = varyingProperty('vec3', 'vInstanceColor');
        const capsuleColorGrounded = applyBaseContactAO(
            capsuleColorRaw,
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

        this.capsules = new THREE.InstancedMesh(sharedGeometries.capsule, capsuleMat, this.capsuleCapacity);
        this.capsules.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capsuleCapacity * 3), 3);
        this.capsules.geometry.setAttribute('instanceColor', this.capsules.instanceColor);
        this.capsules.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(this.capsuleCapacity), 1));
        this.capsules.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(this.capsuleCapacity), 1));
        initInstanceLodAttribute(this.capsules, this.capsuleCapacity);
        this.capsules.castShadow = true;
        this.capsules.receiveShadow = true;
        this.capsules.count = 0;
        foliageGroup.add(this.capsules);

        // --- 4. Helix Batch (Vines/Strange Plants) ---
        // PALETTE: Neon Pulse
        const helixColor = applyAerialPerspective(
            varyingProperty('vec3', 'vInstanceColor'),
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
            emissiveIntensity: pulse.mul(0.5).add(audioBoost), // Dynamic glow
            rimStrength: 0.8
        });

        applyFoliageLodMaterialFade(helixMat);

        // Geometry: Use simple cylinder, deformed by shader to spiral
        // ⚡ OPTIMIZATION: Use shared geometry via registry (deduplicated)
        const helixGeo = getCylinderGeometry(1, 1, 1, 16, 30);
        helixGeo.translate(0, 0.5, 0);

        this.helices = new THREE.InstancedMesh(helixGeo, helixMat, this.helixCapacity);
        this.helices.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.helixCapacity * 3), 3);
        this.helices.geometry.setAttribute('instanceColor', this.helices.instanceColor);
        this.helices.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(this.helixCapacity), 1));
        this.helices.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(this.helixCapacity), 1));
        initInstanceLodAttribute(this.helices, this.helixCapacity);
        this.helices.castShadow = true;
        this.helices.receiveShadow = true;
        this.helices.count = 0;
        foliageGroup.add(this.helices);

        // --- 5. Rose Batch (TorusKnot) ---
        // PALETTE: Velvet/Sugar Look
        const roseColor = applyAerialPerspective(
            varyingProperty('vec3', 'vInstanceColor'),
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
        (accordionLeafMat as any).emissiveNode = BiomeUniforms.musicalFlora.noteColor.mul(BiomeUniforms.musicalFlora.shimmer.add(0.5));
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
        this.roses = new THREE.InstancedMesh(roseGeo, roseMat, this.roseCapacity);
        this.accordionLeaves = new THREE.InstancedMesh(accordionLeafGeo, accordionLeafMat, this.accordionLeafCapacity);
        this.roses.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.roseCapacity * 3), 3);
        this.accordionLeaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.accordionLeafCapacity * 3), 3);
        this.roses.geometry.setAttribute('instanceColor', this.roses.instanceColor);
        this.roses.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(this.roseCapacity), 1));
        this.accordionLeaves.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(this.accordionLeafCapacity), 1));
        this.roses.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(this.roseCapacity), 1));
        this.accordionLeaves.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(this.accordionLeafCapacity), 1));
        initInstanceLodAttribute(this.roses, this.roseCapacity);
        initInstanceLodAttribute(this.accordionLeaves, this.accordionLeafCapacity);
        this.roses.castShadow = true;
        this.roses.receiveShadow = true;
        this.roses.count = 0;
        foliageGroup.add(this.roses);
        foliageGroup.add(this.accordionLeaves);

        this.initialized = true;
        registerFoliageBatcherLod({ id: 'tree', getMeshes: () => this.getLODMeshes() });
        console.log('[TreeBatcher] Initialized tree batching system with Juicy Materials');
    }

    getLODMeshes(): THREE.InstancedMesh[] {
        if (!this.initialized) return [];
        return [this.trunks, this.spheres, this.capsules, this.helices, this.roses];
    }

    // --- Dynamic Buffer Growth ---

    /**
     * Helper to properly dispose of InstancedMesh resources to prevent VRAM leaks.
     */
    private disposeInstancedMesh(mesh: THREE.InstancedMesh) {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
            } else {
                mesh.material.dispose();
            }
        }

        // Ensure custom instance attributes are disposed if supported
        if (mesh.instanceColor && typeof (mesh.instanceColor as any).dispose === 'function') {
            try { (mesh.instanceColor as any).dispose(); } catch (e) {}
        }
    }

    private growTrunkBuffer() {
        this.flushRegistrations();
        if (this.trunkCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.trunks;
        this.trunkCapacity = Math.min(this.trunkCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.trunkCapacity);
        
        // Copy existing matrix data
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.trunkCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        // Copy existing color data
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(this.trunkCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(this.trunkCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(this.trunkCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, this.trunkCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        // Replace in scene
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        this.trunks = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew trunk buffer to ${this.trunkCapacity}`);
    }

    private growSphereBuffer() {
        this.flushRegistrations();
        if (this.sphereCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.spheres;
        this.sphereCapacity = Math.min(this.sphereCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.sphereCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.sphereCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(this.sphereCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(this.sphereCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(this.sphereCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, this.sphereCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        this.spheres = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew sphere buffer to ${this.sphereCapacity}`);
    }

    private growCapsuleBuffer() {
        this.flushRegistrations();
        if (this.capsuleCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.capsules;
        this.capsuleCapacity = Math.min(this.capsuleCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.capsuleCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.capsuleCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(this.capsuleCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(this.capsuleCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(this.capsuleCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, this.capsuleCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        this.capsules = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew capsule buffer to ${this.capsuleCapacity}`);
    }

    private growHelixBuffer() {
        this.flushRegistrations();
        if (this.helixCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.helices;
        this.helixCapacity = Math.min(this.helixCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.helixCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.helixCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(this.helixCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(this.helixCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(this.helixCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, this.helixCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        this.helices = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew helix buffer to ${this.helixCapacity}`);
    }

    private growRoseBuffer() {
        this.flushRegistrations();
        if (this.roseCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.roses;
        this.roseCapacity = Math.min(this.roseCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.roseCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.roseCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);
        
        if (oldMesh.instanceColor) {
            const oldColorArray = oldMesh.instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(this.roseCapacity * 3);
            newColorArray.set(oldColorArray);
            newMesh.instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', newMesh.instanceColor);
        }
        
        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(this.roseCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(this.roseCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        copyInstanceLodOnGrow(oldMesh, newMesh, this.roseCapacity);

        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        safeRemoveAndDispose(foliageGroup, oldMesh);
        foliageGroup.add(newMesh);

        
        this.roses = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew rose buffer to ${this.roseCapacity}`);
    }

    register(group: THREE.Group, type: string) {
        if (!this.initialized) this.init();

        // ⚡ OPTIMIZATION: Ensure world matrix is ready for child components
        // Avoids multiple updateWorldMatrix calls or manual premultiplications later
        const slopeQ = group.userData.groundSlopeQuaternion as THREE.Quaternion | undefined;
        if (slopeQ) {
            _scratchTreeOriginalQuaternion.copy(group.quaternion);
            group.quaternion.copy(getGroundAlignedQuaternion(group, _scratchTreeFinalQuaternion));
            group.updateWorldMatrix(false, false);
            group.quaternion.copy(_scratchTreeOriginalQuaternion);
        } else {
            group.updateWorldMatrix(false, false);
        }

        let animTypeEnum = ANIMATION_TYPES.STATIC;
        const typeStr = group.userData.animationType;
        if (typeStr === 'gentleSway') animTypeEnum = ANIMATION_TYPES.GENTLE_SWAY;
        else if (typeStr === 'bounce' || (Array.isArray(typeStr) && typeStr.indexOf('bounce') !== -1)) animTypeEnum = ANIMATION_TYPES.BOUNCE;
        else if (typeStr === 'shiver' || (Array.isArray(typeStr) && typeStr.indexOf('shiver') !== -1)) animTypeEnum = ANIMATION_TYPES.SHIVER;
        else if (typeStr === 'spring' || (Array.isArray(typeStr) && typeStr.indexOf('spring') !== -1)) animTypeEnum = ANIMATION_TYPES.SPRING;
        else if (typeStr === 'vineSway' || (Array.isArray(typeStr) && typeStr.indexOf('vineSway') !== -1)) animTypeEnum = ANIMATION_TYPES.VINE_SWAY;
        else if (typeStr === 'hop' || (Array.isArray(typeStr) && typeStr.indexOf('hop') !== -1)) animTypeEnum = ANIMATION_TYPES.HOP;
        else if (typeStr === 'wobble' || (Array.isArray(typeStr) && typeStr.indexOf('wobble') !== -1)) animTypeEnum = ANIMATION_TYPES.WOBBLE;
        else if (typeStr === 'accordion' || (Array.isArray(typeStr) && typeStr.indexOf('accordion') !== -1)) animTypeEnum = ANIMATION_TYPES.ACCORDION;
        else if (typeStr === 'accordionStretch') animTypeEnum = ANIMATION_TYPES.ACCORDION_STRETCH;
        else if (typeStr === 'spiralWave' || (Array.isArray(typeStr) && typeStr.indexOf('spiralWave') !== -1)) animTypeEnum = ANIMATION_TYPES.SPIRAL_WAVE;
        else if (typeStr === 'fiberWhip') animTypeEnum = ANIMATION_TYPES.FIBER_WHIP;

        group.userData._animTypeEnum = animTypeEnum;
        group.userData._animOffset = group.userData.animationOffset || 0;

        if (type === 'bubbleWillow' || type === 'willow') {
            this.registerBubbleWillow(group, group.userData._animTypeEnum, group.userData._animOffset);
        } else if (type === 'balloonBush' || type === 'shrub') {
            this.registerBalloonBush(group, group.userData._animTypeEnum, group.userData._animOffset);
        } else if (type === 'helixPlant' || type === 'helix') {
            this.registerHelixPlant(group, group.userData._animTypeEnum, group.userData._animOffset);
        } else if (type === 'accordion_palm' || type === 'accordionPalm') {
            this.registerAccordionPalm(group, group.userData._animTypeEnum, group.userData._animOffset);
        } else if (type === 'tree' || type === 'floweringTree' || type === 'prismRoseBush') {
            this.registerFloweringTree(group, group.userData._animTypeEnum, group.userData._animOffset);
        }

        // ⚡ OPTIMIZATION: Flush batch arrays at the end of each object group registration
        this.flushRegistrations();
    }

    private addInstance(mesh: THREE.InstancedMesh, matrix: THREE.Matrix4, color: THREE.Color, countProp: 'trunkCount' | 'sphereCount' | 'capsuleCount' | 'helixCount' | 'roseCount' | 'accordionLeafCount', animType: number = 0, animOffset: number = 0) {
        let index = 0;

        switch (countProp) {
            case 'trunkCount': index = this.trunkCount; break;
            case 'sphereCount': index = this.sphereCount; break;
            case 'capsuleCount': index = this.capsuleCount; break;
            case 'helixCount': index = this.helixCount; break;
            case 'roseCount': index = this.roseCount; break;
            case 'accordionLeafCount': index = this.accordionLeafCount; break;
        }

        // Check if we need to grow the buffer
        switch (countProp) {
            case 'trunkCount':
                if (index >= this.trunkCapacity) this.growTrunkBuffer();
                if (index >= this.trunkCapacity) return;
                mesh = this.trunks;
                break;
            case 'sphereCount':
                if (index >= this.sphereCapacity) this.growSphereBuffer();
                if (index >= this.sphereCapacity) return;
                mesh = this.spheres;
                break;
            case 'capsuleCount':
                if (index >= this.capsuleCapacity) this.growCapsuleBuffer();
                if (index >= this.capsuleCapacity) return;
                mesh = this.capsules;
                break;
            case 'helixCount':
                if (index >= this.helixCapacity) this.growHelixBuffer();
                if (index >= this.helixCapacity) return;
                mesh = this.helices;
                break;
            case 'roseCount':
                if (index >= this.roseCapacity) this.growRoseBuffer();
                if (index >= this.roseCapacity) return;
                mesh = this.roses;
                break;
            case 'accordionLeafCount':
                if (index >= this.accordionLeafCapacity) this.growAccordionLeafBuffer();
                if (index >= this.accordionLeafCapacity) return;
                mesh = this.accordionLeaves;
                break;
        }

        // ⚡ OPTIMIZATION: Queue TRS properties into SoA buffers for batch WASM processing
        if (this._pendingInstances.length >= BATCH_QUEUE_LIMIT) {
            this.flushRegistrations();
        }

        matrix.decompose(_scratchPosition, _scratchTreeFinalQuaternion, _scratchScale);
        const qIndex = this._pendingInstances.length;

        _batchPositions[qIndex * 3 + 0] = _scratchPosition.x;
        _batchPositions[qIndex * 3 + 1] = _scratchPosition.y;
        _batchPositions[qIndex * 3 + 2] = _scratchPosition.z;

        _batchQuaternions[qIndex * 4 + 0] = _scratchTreeFinalQuaternion.x;
        _batchQuaternions[qIndex * 4 + 1] = _scratchTreeFinalQuaternion.y;
        _batchQuaternions[qIndex * 4 + 2] = _scratchTreeFinalQuaternion.z;
        _batchQuaternions[qIndex * 4 + 3] = _scratchTreeFinalQuaternion.w;

        _batchScales[qIndex * 3 + 0] = _scratchScale.x;
        _batchScales[qIndex * 3 + 1] = _scratchScale.y;
        _batchScales[qIndex * 3 + 2] = _scratchScale.z;

        this._pendingInstances.push({
            mesh,
            index,
            color,
            animType,
            animOffset
        });

        // Update count
        switch (countProp) {
            case 'trunkCount': this.trunkCount++; mesh.count = this.trunkCount; break;
            case 'sphereCount': this.sphereCount++; mesh.count = this.sphereCount; break;
            case 'capsuleCount': this.capsuleCount++; mesh.count = this.capsuleCount; break;
            case 'helixCount': this.helixCount++; mesh.count = this.helixCount; break;
            case 'roseCount': this.roseCount++; mesh.count = this.roseCount; break;
            case 'accordionLeafCount': this.accordionLeafCount++; mesh.count = this.accordionLeafCount; break;
        }
    }

    /**
     * Executes the WASM fast-path composition of all queued tree parts into their respective Matrix array offsets.
     */
    private flushRegistrations() {
        const queueSize = this._pendingInstances.length;
        if (queueSize === 0) return;

        if (isEmscriptenReady()) {
            batchComposeMatrices_c(
                _batchPositions,
                _batchQuaternions,
                _batchScales,
                _batchOutputMatrices,
                queueSize
            );

            // Re-apply to respective mesh buffers
            for (let i = 0; i < queueSize; i++) {
                const req = this._pendingInstances[i];
                const targetArray = req.mesh.instanceMatrix.array as Float32Array;
                const matrixOffset = req.index * 16;
                const outOffset = i * 16;

                // Copy 16 floats
                for (let j = 0; j < 16; j++) {
                    targetArray[matrixOffset + j] = _batchOutputMatrices[outOffset + j];
                }
            }
        } else {
            // TS Fallback
            for (let i = 0; i < queueSize; i++) {
                const req = this._pendingInstances[i];
                const targetArray = req.mesh.instanceMatrix.array as Float32Array;
                const mIdx = req.index * 16;
                const outOffset = i * 16;

                const qx = _batchQuaternions[i * 4 + 0];
                const qy = _batchQuaternions[i * 4 + 1];
                const qz = _batchQuaternions[i * 4 + 2];
                const qw = _batchQuaternions[i * 4 + 3];

                const sx = _batchScales[i * 3 + 0];
                const sy = _batchScales[i * 3 + 1];
                const sz = _batchScales[i * 3 + 2];

                const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
                const xx = qx * x2, xy = qx * y2, xz = qx * z2;
                const yy = qy * y2, yz = qy * z2, zz = qz * z2;
                const wx = qw * x2, wy = qw * y2, wz = qw * z2;

                targetArray[mIdx + 0] = (1 - (yy + zz)) * sx;
                targetArray[mIdx + 1] = (xy + wz) * sx;
                targetArray[mIdx + 2] = (xz - wy) * sx;
                targetArray[mIdx + 3] = 0;

                targetArray[mIdx + 4] = (xy - wz) * sy;
                targetArray[mIdx + 5] = (1 - (xx + zz)) * sy;
                targetArray[mIdx + 6] = (yz + wx) * sy;
                targetArray[mIdx + 7] = 0;

                targetArray[mIdx + 8] = (xz + wy) * sz;
                targetArray[mIdx + 9] = (yz - wx) * sz;
                targetArray[mIdx + 10] = (1 - (xx + yy)) * sz;
                targetArray[mIdx + 11] = 0;

                targetArray[mIdx + 12] = _batchPositions[i * 3 + 0];
                targetArray[mIdx + 13] = _batchPositions[i * 3 + 1];
                targetArray[mIdx + 14] = _batchPositions[i * 3 + 2];
                targetArray[mIdx + 15] = 1;
            }
        }

        // Write standard attributes efficiently
        const updatedMeshes = new Set<THREE.InstancedMesh>();
        for (let i = 0; i < queueSize; i++) {
            const req = this._pendingInstances[i];
            updatedMeshes.add(req.mesh);

            // Color hot path
            const colorArray = req.mesh.instanceColor!.array as Float32Array;
            const colorOffset = req.index * 3;
            colorArray[colorOffset] = req.color.r;
            colorArray[colorOffset + 1] = req.color.g;
            colorArray[colorOffset + 2] = req.color.b;

            // Animation hot path
            const typeAttr = req.mesh.geometry.attributes.instanceAnimType as THREE.InstancedBufferAttribute;
            const offsetAttr = req.mesh.geometry.attributes.instanceAnimOffset as THREE.InstancedBufferAttribute;
            if (typeAttr?.array) {
                (typeAttr.array as Float32Array)[req.index] = req.animType;
            }
            if (offsetAttr?.array) {
                (offsetAttr.array as Float32Array)[req.index] = req.animOffset;
            }
        }

        // Flag updates
        updatedMeshes.forEach(m => {
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
            if (m.geometry.attributes.instanceAnimType) (m.geometry.attributes.instanceAnimType as THREE.InstancedBufferAttribute).needsUpdate = true;
            if (m.geometry.attributes.instanceAnimOffset) (m.geometry.attributes.instanceAnimOffset as THREE.InstancedBufferAttribute).needsUpdate = true;
        });

        this._pendingInstances.length = 0;
    }

    private registerBubbleWillow(group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorWhite;

                // ⚡ OPTIMIZATION: mesh.matrixWorld is already up to date since we rely on it being added
                // but since the mesh might not have updateWorldMatrix called, we use the pre-calculated approach but simplified
                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'CylinderGeometry') {
                     this.addInstance(this.trunks, _scratchTreeMatrix, col, 'trunkCount', animType, animOffset);
                     if (mesh) if (mesh) mesh.visible = false;
                } else if (mesh.geometry.type === 'CapsuleGeometry') {
                     this.addInstance(this.capsules, _scratchTreeMatrix, col, 'capsuleCount', animType, animOffset);
                     if (mesh) if (mesh) mesh.visible = false;
                }
            }
        }
    }

    private registerBalloonBush(group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorOrange;

                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'SphereGeometry') {
                    this.addInstance(this.spheres, _scratchTreeMatrix, col, 'sphereCount', animType, animOffset);
                    if (mesh) if (mesh) mesh.visible = false;
                }
            }
        }
    }

    private registerHelixPlant(group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorGreen;

                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'TubeGeometry') {
                    this.addInstance(this.helices, _scratchTreeMatrix, col, 'helixCount', animType, animOffset);
                    if (mesh) if (mesh) mesh.visible = false;
                } else if (mesh.geometry.type === 'SphereGeometry') {
                    this.addInstance(this.spheres, _scratchTreeMatrix, col, 'sphereCount', animType, animOffset);
                    if (mesh) if (mesh) mesh.visible = false;
                }
            }
        }
    }

    private registerAccordionPalm(group: THREE.Group, animType: number, animOffset: number) {
        // Group structure: trunkGroup -> pleats + headGroup -> leaves
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if (child.type === 'Group') {
                const trunkGroup = child as THREE.Group;
                for (let j = 0; j < trunkGroup.children.length; j++) {
                    const trunkChild = trunkGroup.children[j];
                    if ((trunkChild as THREE.Mesh).isMesh) {
                        const mesh = trunkChild as THREE.Mesh;
                        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                        const col = mat.color || _defaultColorOrange;
                        _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);
                        this.addInstance(this.trunks, _scratchTreeMatrix, col, 'trunkCount', animType, animOffset);
                    } else if (trunkChild.type === 'Group') {
                        const headGroup = trunkChild as THREE.Group;
                        for (let k = 0; k < headGroup.children.length; k++) {
                            const leafChild = headGroup.children[k];
                            if ((leafChild as THREE.Mesh).isMesh) {
                                const mesh = leafChild as THREE.Mesh;
                                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                                const col = mat.color || _defaultColorGreen;
                                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, headGroup.matrix);
                                _scratchTreeMatrix.multiply(mesh.matrix);
                                this.addInstance(this.accordionLeaves, _scratchTreeMatrix, col, 'accordionLeafCount', animType, animOffset);
                            }
                        }
                    }
                }
            }
        }
    }

    private growAccordionLeafBuffer() {
        this.flushRegistrations();
        if (this.accordionLeafCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.accordionLeaves;
        this.accordionLeafCapacity = Math.min(this.accordionLeafCapacity * 2, MAX_INSTANCES);

        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.accordionLeafCapacity);

        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.accordionLeafCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16);

        if ((oldMesh as any).instanceColor) {
            const oldColorArray = (oldMesh as any).instanceColor.array as Float32Array;
            const newColorArray = new Float32Array(this.accordionLeafCapacity * 3);
            newColorArray.set(oldColorArray);
            (newMesh as any).instanceColor = new THREE.InstancedBufferAttribute(newColorArray, 3);
            newMesh.geometry.setAttribute('instanceColor', (newMesh as any).instanceColor);
        }

        if (oldMesh.geometry.attributes.instanceAnimType) {
            const oldAnimTypeArray = oldMesh.geometry.attributes.instanceAnimType.array as Float32Array;
            const newAnimTypeArray = new Float32Array(this.accordionLeafCapacity);
            newAnimTypeArray.set(oldAnimTypeArray);
            newMesh.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(newAnimTypeArray, 1));
        }

        if (oldMesh.geometry.attributes.instanceAnimOffset) {
            const oldAnimOffsetArray = oldMesh.geometry.attributes.instanceAnimOffset.array as Float32Array;
            const newAnimOffsetArray = new Float32Array(this.accordionLeafCapacity);
            newAnimOffsetArray.set(oldAnimOffsetArray);
            newMesh.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(newAnimOffsetArray, 1));
        }

        // Add LOD attributes
        initInstanceLodAttribute(newMesh, this.accordionLeafCapacity);
        copyInstanceLodOnGrow(oldMesh, newMesh, this.accordionLeafCapacity);

        newMesh.castShadow = true;
        newMesh.receiveShadow = true;

        foliageGroup.remove(oldMesh);
        oldMesh.dispose();
        foliageGroup.add(newMesh);

        this.accordionLeaves = newMesh;
        refreshFoliageLodMesh(newMesh);
        console.log(`[TreeBatcher] Grew accordion leaf buffer to ${this.accordionLeafCapacity}`);
    }

    private registerFloweringTree(group: THREE.Group, animType: number, animOffset: number) {
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorWhite;

                _scratchTreeMatrix.multiplyMatrices(group.matrixWorld, mesh.matrix);

                if (mesh.geometry.type === 'CylinderGeometry') {
                    this.addInstance(this.trunks, _scratchTreeMatrix, col, 'trunkCount', animType, animOffset);
                } else if (mesh.geometry.type === 'SphereGeometry') {
                    this.addInstance(this.spheres, _scratchTreeMatrix, col, 'sphereCount', animType, animOffset);
                } else if (mesh.geometry.type === 'TorusKnotGeometry') {
                    this.addInstance(this.roses, _scratchTreeMatrix, col, 'roseCount', animType, animOffset);
                }
                if (mesh) if (mesh) mesh.visible = false;
            }
        }
    }

    getStats() {
        return {
            trunks: { count: this.trunkCount, capacity: this.trunkCapacity },
            spheres: { count: this.sphereCount, capacity: this.sphereCapacity },
            capsules: { count: this.capsuleCount, capacity: this.capsuleCapacity },
            helices: { count: this.helixCount, capacity: this.helixCapacity },
            roses: { count: this.roseCount, capacity: this.roseCapacity }
        };
    }
}

export const treeBatcher = TreeBatcher.getInstance();
