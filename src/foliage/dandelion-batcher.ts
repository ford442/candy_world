import * as THREE from 'three';
// @ts-ignore
import { foliageGroup } from '../world/state.ts';
import {
    createClayMaterial,
    createCandyMaterial,
    registerReactiveMaterial,
    uAudioHigh,
    uTime
} from './common.js';
// @ts-ignore
import {
    float, vec3, positionLocal, sin, cos, mix, instanceIndex, normalLocal, timerLocal
} from 'three/tsl';

const MAX_DANDELIONS = 500;
const SEEDS_PER_HEAD = 24;

export class CymbalDandelionBatcher {
    initialized: boolean;
    count: number;
    logicObjects: THREE.Object3D[];

    // Meshes
    stemMesh: THREE.InstancedMesh | null;
    stalkMesh: THREE.InstancedMesh | null;
    tipMesh: THREE.InstancedMesh | null;

    // Scratch
    dummy: THREE.Object3D;
    _position: THREE.Vector3;
    _quaternion: THREE.Quaternion;
    _scale: THREE.Vector3;

    constructor() {
        this.initialized = false;
        this.count = 0;
        this.logicObjects = [];
        this.stemMesh = null;
        this.stalkMesh = null;
        this.tipMesh = null;

        this.dummy = new THREE.Object3D();
        this._position = new THREE.Vector3();
        this._quaternion = new THREE.Quaternion();
        this._scale = new THREE.Vector3();
    }

    init() {
        if (this.initialized) return;

        // 1. Stem (Clay Green)
        const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6);
        stemGeo.translate(0, 0.75, 0); // Pivot at bottom
        const stemMat = createClayMaterial(0x556B2F);

        this.stemMesh = new THREE.InstancedMesh(stemGeo, stemMat, MAX_DANDELIONS);
        this.stemMesh.castShadow = true;
        this.stemMesh.receiveShadow = true;
        this.stemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.stemMesh.count = 0;

        // 2. Stalk (Clay White)
        // Base scale is 1.0, geometry matches original
        const stalkGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4);
        stalkGeo.translate(0, 0.2, 0); // Pivot at bottom
        const stalkMat = createClayMaterial(0xFFFFFF);

        // TSL Animation for Stalks (Shake)
        // Shake based on AudioHigh
        const shakeIntensity = uAudioHigh.mul(0.5);
        // Unique phase per instance
        const phase = float(instanceIndex).mul(13.0);
        const fastTime = uTime.mul(30.0); // Fast vibration

        const shakeX = sin(fastTime.add(phase)).mul(shakeIntensity).mul(0.2); // Radian amount
        const shakeZ = cos(fastTime.add(phase.mul(0.7))).mul(shakeIntensity).mul(0.2);

        // Apply rotation to position
        // Since geometry pivots at bottom (y=0), displacement scales with y.
        const yNorm = positionLocal.y.div(0.4); // 0 to 1
        const dispX = yNorm.mul(shakeX);
        const dispZ = yNorm.mul(shakeZ);

        stalkMat.positionNode = positionLocal.add(vec3(dispX, float(0.0), dispZ));

        this.stalkMesh = new THREE.InstancedMesh(stalkGeo, stalkMat, MAX_DANDELIONS * SEEDS_PER_HEAD);
        this.stalkMesh.castShadow = true;
        this.stalkMesh.receiveShadow = true;
        this.stalkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.stalkMesh.count = 0;

        // 3. Tip (Candy Gold)
        const tipGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const tipMat = createCandyMaterial(0xFFD700, 1.0);
        registerReactiveMaterial(tipMat);

        // Tip Shake Logic (Same phase/freq)
        // Tip is a sphere, so we just translate it.
        const tipShakeX = shakeX; // Full shake amount
        const tipShakeZ = shakeZ;
        tipMat.positionNode = positionLocal.add(vec3(tipShakeX, float(0.0), tipShakeZ));

        this.tipMesh = new THREE.InstancedMesh(tipGeo, tipMat, MAX_DANDELIONS * SEEDS_PER_HEAD);
        this.tipMesh.castShadow = true;
        this.tipMesh.receiveShadow = true;
        this.tipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.tipMesh.count = 0;

        // Add to scene
        if (foliageGroup) {
            foliageGroup.add(this.stemMesh);
            foliageGroup.add(this.stalkMesh);
            foliageGroup.add(this.tipMesh);
        } else {
            console.warn('[DandelionBatcher] foliageGroup missing!');
        }

        this.initialized = true;
        console.log('[DandelionBatcher] Initialized');
    }

    register(dummy: THREE.Object3D, options: any = {}) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_DANDELIONS) return;

        const i = this.count;
        this.count++;

        // Update counts to show new instance
        this.stemMesh!.count = this.count;
        this.stalkMesh!.count = this.count * SEEDS_PER_HEAD;
        this.tipMesh!.count = this.count * SEEDS_PER_HEAD;

        this.logicObjects.push(dummy);
        dummy.userData.batchIndex = i;

        const scale = options.scale || 1.0;

        // 1. Setup Stem
        this.dummy.position.copy(dummy.position);
        this.dummy.rotation.copy(dummy.rotation);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        this.stemMesh!.setMatrixAt(i, this.dummy.matrix);

        // 2. Setup Seeds (Stalk + Tip)
        const seedStartIdx = i * SEEDS_PER_HEAD;

        // Head center position (relative to dummy)
        const headOffset = new THREE.Vector3(0, 1.5 * scale, 0);
        headOffset.applyEuler(dummy.rotation);
        const headCenter = dummy.position.clone().add(headOffset);

        // Replicate spherical distribution
        for (let s = 0; s < SEEDS_PER_HEAD; s++) {
            const idx = seedStartIdx + s;

            // Calc rotation
            const phi = Math.acos(-1 + (2 * s) / SEEDS_PER_HEAD);
            const theta = Math.sqrt(SEEDS_PER_HEAD * Math.PI) * phi;

            // Direction vector
            const dir = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            ).normalize();

            // Align stalk
            this._quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

            // Also apply the Dandelion's main rotation
            const worldQuat = dummy.quaternion.clone().multiply(this._quaternion);

            // Position: Head Center
            this._position.copy(headCenter);

            this._scale.setScalar(scale);

            // Matrix for Stalk
            this.dummy.position.copy(this._position);
            this.dummy.quaternion.copy(worldQuat);
            this.dummy.scale.copy(this._scale);
            this.dummy.updateMatrix();
            this.stalkMesh!.setMatrixAt(idx, this.dummy.matrix);

            // Matrix for Tip
            const tipOffset = new THREE.Vector3(0, 0.4 * scale, 0);
            tipOffset.applyQuaternion(worldQuat);
            const tipPos = headCenter.clone().add(tipOffset);

            this.dummy.position.copy(tipPos);
            this.dummy.quaternion.copy(worldQuat);
            this.dummy.scale.copy(this._scale);
            this.dummy.updateMatrix();
            this.tipMesh!.setMatrixAt(idx, this.dummy.matrix);
        }

        this.stemMesh!.instanceMatrix.needsUpdate = true;
        this.stalkMesh!.instanceMatrix.needsUpdate = true;
        this.tipMesh!.instanceMatrix.needsUpdate = true;
    }
}

export const dandelionBatcher = new CymbalDandelionBatcher();
