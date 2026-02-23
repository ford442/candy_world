// src/foliage/tree-batcher.ts

import * as THREE from 'three';
import { foliageGroup } from '../world/state.ts';
import {
    createStandardNodeMaterial,
    sharedGeometries,
    applyPlayerInteraction,
    calculateWindSway,
    createJuicyRimLight,
    uTime,
    uAudioHigh,
    uGlitchIntensity
} from './common.ts';
import {
    color, float, vec3, positionLocal, mix, attribute, uv, sin, cos, positionWorld, smoothstep
} from 'three/tsl';
import { applyGlitch } from './glitch.ts';

const MAX_INSTANCES = 3000; // Trunks
const MAX_SPHERES = MAX_INSTANCES * 15; // Blooms/Leaves
const MAX_CAPSULES = MAX_INSTANCES * 10; // Branches
const MAX_ROSES = MAX_INSTANCES * 5; // Roses

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
        const trunkGeo = sharedGeometries.unitCylinder;
        const trunkMat = createStandardNodeMaterial({ roughness: 0.9, metalness: 0.0 });
        const instanceColor = attribute('instanceColor', 'vec3');
        trunkMat.colorNode = mix(instanceColor.mul(0.6), instanceColor, positionLocal.y);
        const trunkPos = applyPlayerInteraction(positionLocal);
        const trunkFinal = trunkPos.add(calculateWindSway(trunkPos));
        trunkMat.positionNode = applyGlitch(uv(), trunkFinal, uGlitchIntensity).position;

        this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_INSTANCES);
        this.trunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3);
        this.trunks.castShadow = true;
        this.trunks.receiveShadow = true;
        this.trunks.count = 0;
        foliageGroup.add(this.trunks);

        // --- 2. Sphere Batch ---
        const sphereGeo = sharedGeometries.unitSphere;
        const sphereMat = createStandardNodeMaterial({ roughness: 0.8, metalness: 0.0 });
        const sphereColor = attribute('instanceColor', 'vec3');
        sphereMat.colorNode = sphereColor;
        const audioBoost = uAudioHigh.mul(0.5);
        sphereMat.emissiveNode = createJuicyRimLight(sphereColor, float(1.0), float(3.0), null).add(sphereColor.mul(audioBoost));
        const spherePos = applyPlayerInteraction(positionLocal);
        const sphereFinal = spherePos.add(calculateWindSway(spherePos));
        sphereMat.positionNode = applyGlitch(uv(), sphereFinal, uGlitchIntensity).position;

        this.spheres = new THREE.InstancedMesh(sphereGeo, sphereMat, MAX_SPHERES);
        this.spheres.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPHERES * 3), 3);
        this.spheres.castShadow = true;
        this.spheres.receiveShadow = true;
        this.spheres.count = 0;
        foliageGroup.add(this.spheres);

        // --- 3. Capsule Batch ---
        const capsuleGeo = sharedGeometries.capsule;
        const capsuleMat = createStandardNodeMaterial({ roughness: 0.8 });
        const capsuleColor = attribute('instanceColor', 'vec3');
        capsuleMat.colorNode = capsuleColor;
        capsuleMat.emissiveNode = createJuicyRimLight(capsuleColor, float(1.0), float(3.0), null);
        const capsulePos = applyPlayerInteraction(positionLocal);
        const capsuleFinal = capsulePos.add(calculateWindSway(capsulePos));
        capsuleMat.positionNode = applyGlitch(uv(), capsuleFinal, uGlitchIntensity).position;

        this.capsules = new THREE.InstancedMesh(capsuleGeo, capsuleMat, MAX_CAPSULES);
        this.capsules.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CAPSULES * 3), 3);
        this.capsules.castShadow = true;
        this.capsules.receiveShadow = true;
        this.capsules.count = 0;
        foliageGroup.add(this.capsules);

        // --- 4. Helix Batch ---
        const helixGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 20).translate(0, 0.5, 0);
        const helixMat = createStandardNodeMaterial({ roughness: 0.6 });
        const helixColor = attribute('instanceColor', 'vec3');
        helixMat.colorNode = helixColor;
        const t = positionLocal.y;
        const angle = t.mul(float(Math.PI * 4.0));
        const radius = t.mul(0.2);
        const spiralPos = vec3(cos(angle).mul(radius), positionLocal.y, sin(angle).mul(radius));
        const helixFinal = applyPlayerInteraction(spiralPos).add(calculateWindSway(spiralPos));
        helixMat.positionNode = applyGlitch(uv(), helixFinal, uGlitchIntensity).position;
        helixMat.emissiveNode = mix(vec3(0.0), vec3(1.0, 1.0, 0.8), smoothstep(0.9, 1.0, t));

        this.helices = new THREE.InstancedMesh(helixGeo, helixMat, MAX_INSTANCES);
        this.helices.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3);
        this.helices.castShadow = true;
        this.helices.receiveShadow = true;
        this.helices.count = 0;
        foliageGroup.add(this.helices);

        // --- 5. Rose Batch (TorusKnot) ---
        const roseGeo = new THREE.TorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3);
        const roseMat = createStandardNodeMaterial({ roughness: 0.7 });
        const roseColor = attribute('instanceColor', 'vec3');
        roseMat.colorNode = roseColor;
        const rosePos = applyPlayerInteraction(positionLocal);
        roseMat.positionNode = applyGlitch(uv(), rosePos.add(calculateWindSway(rosePos)), uGlitchIntensity).position;

        this.roses = new THREE.InstancedMesh(roseGeo, roseMat, MAX_ROSES);
        this.roses.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ROSES * 3), 3);
        this.roses.castShadow = true;
        this.roses.receiveShadow = true;
        this.roses.count = 0;
        foliageGroup.add(this.roses);

        this.initialized = true;
        console.log('[TreeBatcher] Initialized tree batching system');
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
        let max = 0;

        switch (countProp) {
            case 'trunkCount': index = this.trunkCount; max = MAX_INSTANCES; break;
            case 'sphereCount': index = this.sphereCount; max = MAX_SPHERES; break;
            case 'capsuleCount': index = this.capsuleCount; max = MAX_CAPSULES; break;
            case 'helixCount': index = this.helixCount; max = MAX_INSTANCES; break;
            case 'roseCount': index = this.roseCount; max = MAX_ROSES; break;
        }

        if (index >= max) return;

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
                const col = mat.color || new THREE.Color(0xFFFFFF);

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
                const col = mat.color || new THREE.Color(0xFF4500);

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
                const col = mat.color || new THREE.Color(0x00FA9A);

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
                const col = mat.color || new THREE.Color(0xFFFFFF);

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
}

export const treeBatcher = TreeBatcher.getInstance();
