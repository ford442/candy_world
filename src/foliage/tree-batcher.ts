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
    applyPlayerInteraction
} from './index.ts';
import {
    color, float, vec3, positionLocal, mix, attribute, uv, sin, cos, positionWorld, smoothstep,
    mx_noise_float, normalWorld, varyingProperty, instanceIndex as tslInstanceIndex
} from 'three/tsl';
import { applyGlitch } from './glitch.ts';
import { getCylinderGeometry, getTorusKnotGeometry } from '../utils/geometry-dedup.ts';
import { createSugarSparkle } from './index.ts';
import { uTwilight } from './sky.ts';
import { BiomeUniforms } from '../systems/biome-uniforms.ts';
import { CONFIG } from '../core/config.ts';
import { applyInstanceAnimation, ANIMATION_TYPES } from './animation-nodes.ts';
import {
    foliageDeformationOffset,
    scaleEmissiveByLod,
    lodHeroOnlyMultiplier,
    lodHeroGate,
    lodMidOnlyGate
} from './lod-nodes.ts';
import { initInstanceLodAttribute, copyInstanceLodOnGrow } from './batcher-lod-utils.ts';
import { registerFoliageBatcherLod, refreshFoliageLodMesh } from '../systems/batcher-lod.ts';
import { getCIAdjustedCount } from '../core/config.ts';

const _scratchTreeMatrix = new THREE.Matrix4();
const _scratchTreeOriginalQuaternion = new THREE.Quaternion();
const _scratchTreeFinalQuaternion = new THREE.Quaternion();

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
        const trunkColor = mix(instanceColor.mul(0.6), instanceColor, positionLocal.y);

        // Combined Deformation: Interaction + Wind
        const animOffsetTrunk = applyInstanceAnimation();
        const baseTrunkPos = positionLocal.add(animOffsetTrunk);
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
        const sphereColor = varyingProperty('vec3', 'vInstanceColor');

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
        const baseSpherePos = positionLocal.add(animOffsetSphere);
        const sphereBaseDeform = foliageDeformationOffset(baseSpherePos);
        const flutterWeight = lodHeroGate().add(lodMidOnlyGate().mul(0.25));
        const sphereFluttered = sphereBaseDeform.add(flutterOffset.mul(flutterWeight));
        const squashScaleLod = lodHeroOnlyMultiplier(squashScale);
        const sphereFinalDeform = sphereFluttered.mul(squashScaleLod);

        // Base Emissive logic based on High Freq Audio
        const sphereEmissive = sphereColor.mul(uAudioHigh.mul(1.5).add(0.2));

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
        const capsuleColor = varyingProperty('vec3', 'vInstanceColor');
        const animOffsetCapsule = applyInstanceAnimation();
        const baseCapsulePos = positionLocal.add(animOffsetCapsule);
        const capsuleDeform = foliageDeformationOffset(baseCapsulePos);

        const capsuleMat = CandyPresets.Clay(0x8B4513, {
            colorNode: capsuleColor,
            roughness: 0.7,
            deformationNode: capsuleDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction
            rimStrength: 0.4
        });

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
        const helixColor = varyingProperty('vec3', 'vInstanceColor');

        // Spiral Math for Geometry (applied in vertex shader)
        const t = positionLocal.y; // 0 to 1
        const angle = t.mul(float(Math.PI * 6.0)); // More twists
        const radius = t.mul(0.3).add(sin(uTime.mul(2.0).add(t.mul(10.0))).mul(0.05)); // Breathing radius

        const spiralPos = vec3(cos(angle).mul(radius), t, sin(angle).mul(radius));
        const animOffsetHelix = applyInstanceAnimation();
        const baseHelixPos = spiralPos.add(animOffsetHelix);
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
        const roseColor = varyingProperty('vec3', 'vInstanceColor');
        const animOffsetRose = applyInstanceAnimation();
        const baseRosePos = positionLocal.add(animOffsetRose);
        const roseDeform = foliageDeformationOffset(baseRosePos);

        // Use Sugar preset for crystalline/sparkly look
        const roseMat = CandyPresets.Sugar(0xFF69B4, {
            colorNode: roseColor,
            roughness: 0.4,
            deformationNode: roseDeform, // 🏗️ ARCHITECT: Removed double-application of player interaction
            sheen: 1.0,
            audioReactStrength: 0.8 // Strong glow response
        });

        // ⚡ OPTIMIZATION: Use shared geometry via registry (deduplicated)
        const roseGeo = getTorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3);
        this.roses = new THREE.InstancedMesh(roseGeo, roseMat, this.roseCapacity);
        this.roses.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.roseCapacity * 3), 3);
        this.roses.geometry.setAttribute('instanceColor', this.roses.instanceColor);
        this.roses.geometry.setAttribute('instanceAnimType', new THREE.InstancedBufferAttribute(new Float32Array(this.roseCapacity), 1));
        this.roses.geometry.setAttribute('instanceAnimOffset', new THREE.InstancedBufferAttribute(new Float32Array(this.roseCapacity), 1));
        initInstanceLodAttribute(this.roses, this.roseCapacity);
        this.roses.castShadow = true;
        this.roses.receiveShadow = true;
        this.roses.count = 0;
        foliageGroup.add(this.roses);

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
        if (this.trunkCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.trunks;
        this.trunkCapacity = Math.min(this.trunkCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.trunkCapacity);
        
        // Copy existing matrix data
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.trunkCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 4);
        
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
        if (this.sphereCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.spheres;
        this.sphereCapacity = Math.min(this.sphereCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.sphereCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.sphereCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 4);
        
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
        if (this.capsuleCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.capsules;
        this.capsuleCapacity = Math.min(this.capsuleCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.capsuleCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.capsuleCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 4);
        
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
        if (this.helixCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.helices;
        this.helixCapacity = Math.min(this.helixCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.helixCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.helixCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 4);
        
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
        if (this.roseCapacity >= MAX_INSTANCES) return; // Cap at max
        const oldMesh = this.roses;
        this.roseCapacity = Math.min(this.roseCapacity * 2, MAX_INSTANCES);
        
        const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, this.roseCapacity);
        
        const oldMatrixArray = oldMesh.instanceMatrix.array as Float32Array;
        const newMatrixArray = new Float32Array(this.roseCapacity * 16);
        newMatrixArray.set(oldMatrixArray);
        newMesh.instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 4);
        
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
        } else if (type === 'tree' || type === 'floweringTree' || type === 'prismRoseBush') {
            this.registerFloweringTree(group, group.userData._animTypeEnum, group.userData._animOffset);
        }
    }

    private addInstance(mesh: THREE.InstancedMesh, matrix: THREE.Matrix4, color: THREE.Color, countProp: 'trunkCount' | 'sphereCount' | 'capsuleCount' | 'helixCount' | 'roseCount', animType: number = 0, animOffset: number = 0) {
        let index = 0;

        switch (countProp) {
            case 'trunkCount': index = this.trunkCount; break;
            case 'sphereCount': index = this.sphereCount; break;
            case 'capsuleCount': index = this.capsuleCount; break;
            case 'helixCount': index = this.helixCount; break;
            case 'roseCount': index = this.roseCount; break;
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
        }

        // ⚡ OPTIMIZATION: Write directly to instanceMatrix array to bypass .setMatrixAt overhead.
        matrix.toArray(mesh.instanceMatrix.array, index * 16);
        // ⚡ OPTIMIZATION: Write directly to instanceColor array to bypass .setColorAt overhead.
        const colorArray = mesh.instanceColor.array as Float32Array;
        const colorOffset = index * 3;
        colorArray[colorOffset] = color.r;
        colorArray[colorOffset + 1] = color.g;
        colorArray[colorOffset + 2] = color.b;

        const typeAttr = mesh.geometry.attributes.instanceAnimType as THREE.InstancedBufferAttribute;
        const offsetAttr = mesh.geometry.attributes.instanceAnimOffset as THREE.InstancedBufferAttribute;

        // ⚡ OPTIMIZATION: Direct array write bypasses setX() overhead
        if (typeAttr?.array) {
            (typeAttr.array as Float32Array)[index] = animType;
            typeAttr.needsUpdate = true;
        }
        if (offsetAttr?.array) {
            (offsetAttr.array as Float32Array)[index] = animOffset;
            offsetAttr.needsUpdate = true;
        }

        // Update count
        switch (countProp) {
            case 'trunkCount': this.trunkCount++; mesh.count = this.trunkCount; break;
            case 'sphereCount': this.sphereCount++; mesh.count = this.sphereCount; break;
            case 'capsuleCount': this.capsuleCount++; mesh.count = this.capsuleCount; break;
            case 'helixCount': this.helixCount++; mesh.count = this.helixCount; break;
            case 'roseCount': this.roseCount++; mesh.count = this.roseCount; break;
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
