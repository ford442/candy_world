// src/foliage/tree-batcher.ts
// Lazy dynamic buffer growth: Starts with INITIAL_INSTANCES=100, doubles capacity as needed.
// Reduces startup allocation from 93,000 to ~500 instances for typical maps.

import * as THREE from 'three';
import { foliageGroup } from '../world/state.ts';
import {
    CandyPresets,
    createStandardNodeMaterial,
    sharedGeometries,
    applyPlayerInteraction,
    calculateWindSway,
    createJuicyRimLight,
    uTime,
    uAudioHigh,
    uAudioLow,
    uWindSpeed,
    uGlitchIntensity
} from './common.ts';
import {
    color, float, vec3, positionLocal, mix, attribute, uv, sin, cos, positionWorld, smoothstep,
    mx_noise_float, normalWorld
} from 'three/tsl';
import { applyGlitch } from './glitch.ts';
import { getCylinderGeometry, getTorusKnotGeometry } from '../utils/geometry-dedup.ts';
import { createSugarSparkle } from './common.ts';

const _defaultColorWhite = new THREE.Color(0xFFFFFF);
const _defaultColorOrange = new THREE.Color(0xFF4500);
const _defaultColorGreen = new THREE.Color(0x00FA9A);

// Initial capacity - grows dynamically as needed (doubles each time)
const INITIAL_INSTANCES = 100;

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
        const instanceColor = attribute('instanceColor', 'vec3');
        const trunkColor = mix(instanceColor.mul(0.6), instanceColor, positionLocal.y);

        // Combined Deformation: Interaction + Wind
        const trunkDeform = applyPlayerInteraction(positionLocal).add(calculateWindSway(positionLocal));

        // Create Material using CandyPresets.Clay for nice bump/rim
        const trunkMat = CandyPresets.Clay(0x8B4513, {
            colorNode: trunkColor,
            roughness: 0.8,
            bumpStrength: 0.2, // Bark texture
            rimStrength: 0.3,  // Subtle separation
            deformationNode: trunkDeform,
            triplanar: true    // Avoid UV seams on cylinder
        });

        this.trunks = new THREE.InstancedMesh(sharedGeometries.unitCylinder, trunkMat, this.trunkCapacity);
        this.trunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.trunkCapacity * 3), 3);
        this.trunks.castShadow = true;
        this.trunks.receiveShadow = true;
        this.trunks.count = 0;
        foliageGroup.add(this.trunks);

        // --- 2. Sphere Batch (Leaves/Blooms) ---
        // PALETTE: "Flutter" + "Squash" Juice
        const sphereColor = attribute('instanceColor', 'vec3');

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

        // Base deform (Interaction + Wind)
        const sphereBaseDeform = applyPlayerInteraction(positionLocal).add(calculateWindSway(positionLocal));
        // Add Flutter
        const sphereFluttered = sphereBaseDeform.add(flutterOffset);
        // Apply Squash (Multiplicative scale)
        const sphereFinalDeform = sphereFluttered.mul(squashScale);

        // Base Emissive logic based on High Freq Audio
        const sphereEmissive = sphereColor.mul(uAudioHigh.mul(1.5).add(0.2));

        // Add Sugar Sparkle! (Palette Polish)
        // Scale 15.0 for fine grain, Density 0.3 for sparse twinkle, Intensity 2.0
        const sugarSparkle = createSugarSparkle(normalWorld, float(15.0), float(0.3), float(2.0));

        // Material: Gummy for slight translucency/juice
        const sphereMat = CandyPresets.Gummy(0x228B22, {
            colorNode: sphereColor,
            roughness: 0.4,
            transmission: 0.3, // Semi-opaque
            thickness: 1.0,
            deformationNode: sphereFinalDeform,
            rimStrength: 0.6, // Strong rim for pop
            audioReactStrength: 0.5 // Inner glow pulse
        });

        // 🎨 PALETTE: Make tree leaves pop with sparkly glow and base audio emissive
        sphereMat.emissiveNode = sphereEmissive.add(sugarSparkle);

        this.spheres = new THREE.InstancedMesh(sharedGeometries.unitSphere, sphereMat, this.sphereCapacity);
        this.spheres.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.sphereCapacity * 3), 3);
        this.spheres.castShadow = true;
        this.spheres.receiveShadow = true;
        this.spheres.count = 0;
        foliageGroup.add(this.spheres);

        // --- 3. Capsule Batch (Branches) ---
        const capsuleColor = attribute('instanceColor', 'vec3');
        const capsuleDeform = applyPlayerInteraction(positionLocal).add(calculateWindSway(positionLocal));

        const capsuleMat = CandyPresets.Clay(0x8B4513, {
            colorNode: capsuleColor,
            roughness: 0.7,
            deformationNode: capsuleDeform,
            rimStrength: 0.4
        });

        this.capsules = new THREE.InstancedMesh(sharedGeometries.capsule, capsuleMat, this.capsuleCapacity);
        this.capsules.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capsuleCapacity * 3), 3);
        this.capsules.castShadow = true;
        this.capsules.receiveShadow = true;
        this.capsules.count = 0;
        foliageGroup.add(this.capsules);

        // --- 4. Helix Batch (Vines/Strange Plants) ---
        // PALETTE: Neon Pulse
        const helixColor = attribute('instanceColor', 'vec3');

        // Spiral Math for Geometry (applied in vertex shader)
        const t = positionLocal.y; // 0 to 1
        const angle = t.mul(float(Math.PI * 6.0)); // More twists
        const radius = t.mul(0.3).add(sin(uTime.mul(2.0).add(t.mul(10.0))).mul(0.05)); // Breathing radius

        const spiralPos = vec3(cos(angle).mul(radius), t, sin(angle).mul(radius));
        const helixDeform = applyPlayerInteraction(spiralPos).add(calculateWindSway(spiralPos));

        // Emissive Pulse (Scrolling light)
        const pulseSpeed = float(2.0);
        const pulsePhase = t.mul(10.0).sub(uTime.mul(pulseSpeed));
        const pulse = sin(pulsePhase).mul(0.5).add(0.5); // 0..1
        const audioBoost = uAudioHigh.mul(1.5);

        const helixMat = CandyPresets.Gummy(0x00FA9A, {
            colorNode: helixColor,
            roughness: 0.2,
            deformationNode: helixDeform,
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
        this.helices.castShadow = true;
        this.helices.receiveShadow = true;
        this.helices.count = 0;
        foliageGroup.add(this.helices);

        // --- 5. Rose Batch (TorusKnot) ---
        // PALETTE: Velvet/Sugar Look
        const roseColor = attribute('instanceColor', 'vec3');
        const roseDeform = applyPlayerInteraction(positionLocal).add(calculateWindSway(positionLocal));

        // Use Sugar preset for crystalline/sparkly look
        const roseMat = CandyPresets.Sugar(0xFF69B4, {
            colorNode: roseColor,
            roughness: 0.4,
            deformationNode: roseDeform,
            sheen: 1.0,
            audioReactStrength: 0.8 // Strong glow response
        });

        // ⚡ OPTIMIZATION: Use shared geometry via registry (deduplicated)
        const roseGeo = getTorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3);
        this.roses = new THREE.InstancedMesh(roseGeo, roseMat, this.roseCapacity);
        this.roses.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.roseCapacity * 3), 3);
        this.roses.castShadow = true;
        this.roses.receiveShadow = true;
        this.roses.count = 0;
        foliageGroup.add(this.roses);

        this.initialized = true;
        console.log('[TreeBatcher] Initialized tree batching system with Juicy Materials');
    }

    // --- Dynamic Buffer Growth ---

    private growTrunkBuffer() {
        const oldMesh = this.trunks;
        this.trunkCapacity *= 2;
        
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
        }
        
        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        // Replace in scene
        foliageGroup.remove(oldMesh);
        foliageGroup.add(newMesh);
        oldMesh.dispose();
        
        this.trunks = newMesh;
        console.log(`[TreeBatcher] Grew trunk buffer to ${this.trunkCapacity}`);
    }

    private growSphereBuffer() {
        const oldMesh = this.spheres;
        this.sphereCapacity *= 2;
        
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
        }
        
        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        foliageGroup.remove(oldMesh);
        foliageGroup.add(newMesh);
        oldMesh.dispose();
        
        this.spheres = newMesh;
        console.log(`[TreeBatcher] Grew sphere buffer to ${this.sphereCapacity}`);
    }

    private growCapsuleBuffer() {
        const oldMesh = this.capsules;
        this.capsuleCapacity *= 2;
        
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
        }
        
        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        foliageGroup.remove(oldMesh);
        foliageGroup.add(newMesh);
        oldMesh.dispose();
        
        this.capsules = newMesh;
        console.log(`[TreeBatcher] Grew capsule buffer to ${this.capsuleCapacity}`);
    }

    private growHelixBuffer() {
        const oldMesh = this.helices;
        this.helixCapacity *= 2;
        
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
        }
        
        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        foliageGroup.remove(oldMesh);
        foliageGroup.add(newMesh);
        oldMesh.dispose();
        
        this.helices = newMesh;
        console.log(`[TreeBatcher] Grew helix buffer to ${this.helixCapacity}`);
    }

    private growRoseBuffer() {
        const oldMesh = this.roses;
        this.roseCapacity *= 2;
        
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
        }
        
        newMesh.castShadow = oldMesh.castShadow;
        newMesh.receiveShadow = oldMesh.receiveShadow;
        newMesh.count = oldMesh.count;
        
        foliageGroup.remove(oldMesh);
        foliageGroup.add(newMesh);
        oldMesh.dispose();
        
        this.roses = newMesh;
        console.log(`[TreeBatcher] Grew rose buffer to ${this.roseCapacity}`);
    }

    register(group: THREE.Group, type: string) {
        if (!this.initialized) this.init();
        group.updateMatrixWorld(true);

        if (type === 'bubbleWillow' || type === 'willow') {
            this.registerBubbleWillow(group);
        } else if (type === 'balloonBush' || type === 'shrub') {
            this.registerBalloonBush(group);
        } else if (type === 'helixPlant' || type === 'helix') {
            this.registerHelixPlant(group);
        } else if (type === 'tree' || type === 'floweringTree' || type === 'prismRoseBush') {
            this.registerFloweringTree(group);
        }
    }

    private addInstance(mesh: THREE.InstancedMesh, matrix: THREE.Matrix4, color: THREE.Color, countProp: 'trunkCount' | 'sphereCount' | 'capsuleCount' | 'helixCount' | 'roseCount') {
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
                mesh = this.trunks;
                break;
            case 'sphereCount':
                if (index >= this.sphereCapacity) this.growSphereBuffer();
                mesh = this.spheres;
                break;
            case 'capsuleCount':
                if (index >= this.capsuleCapacity) this.growCapsuleBuffer();
                mesh = this.capsules;
                break;
            case 'helixCount':
                if (index >= this.helixCapacity) this.growHelixBuffer();
                mesh = this.helices;
                break;
            case 'roseCount':
                if (index >= this.roseCapacity) this.growRoseBuffer();
                mesh = this.roses;
                break;
        }

        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, color);

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

    private registerBubbleWillow(group: THREE.Group) {
        group.traverse(child => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorWhite;

                if (mesh.geometry.type === 'CylinderGeometry') {
                     this.addInstance(this.trunks, mesh.matrixWorld, col, 'trunkCount');
                     mesh.visible = false;
                } else if (mesh.geometry.type === 'CapsuleGeometry') {
                     this.addInstance(this.capsules, mesh.matrixWorld, col, 'capsuleCount');
                     mesh.visible = false;
                }
            }
        });
    }

    private registerBalloonBush(group: THREE.Group) {
        group.traverse(child => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorOrange;

                if (mesh.geometry.type === 'SphereGeometry') {
                    this.addInstance(this.spheres, mesh.matrixWorld, col, 'sphereCount');
                    mesh.visible = false;
                }
            }
        });
    }

    private registerHelixPlant(group: THREE.Group) {
        group.traverse(child => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorGreen;

                if (mesh.geometry.type === 'TubeGeometry') {
                    this.addInstance(this.helices, mesh.matrixWorld, col, 'helixCount');
                    mesh.visible = false;
                } else if (mesh.geometry.type === 'SphereGeometry') {
                    this.addInstance(this.spheres, mesh.matrixWorld, col, 'sphereCount');
                    mesh.visible = false;
                }
            }
        });
    }

    private registerFloweringTree(group: THREE.Group) {
        group.traverse(child => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
                // ⚡ OPTIMIZATION: Use shared color constant to prevent GC spikes in traverse
                const col = mat.color || _defaultColorWhite;

                if (mesh.geometry.type === 'CylinderGeometry') {
                    this.addInstance(this.trunks, mesh.matrixWorld, col, 'trunkCount');
                } else if (mesh.geometry.type === 'SphereGeometry') {
                    this.addInstance(this.spheres, mesh.matrixWorld, col, 'sphereCount');
                } else if (mesh.geometry.type === 'TorusKnotGeometry') {
                    this.addInstance(this.roses, mesh.matrixWorld, col, 'roseCount');
                }
                mesh.visible = false;
            }
        });
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
