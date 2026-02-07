import * as THREE from 'three';
import { foliageGroup } from '../world/state.ts';
import {
    createClayMaterial,
    createCandyMaterial,
    registerReactiveMaterial,
    uAudioHigh,
    uTime
} from './common.ts';
import {
    float, vec3, positionLocal, sin, cos, mix, instanceIndex, normalLocal, timerLocal
} from 'three/tsl';

const MAX_DANDELIONS = 500;
const SEEDS_PER_HEAD = 24;
// InstancedMesh Uniform Buffer Limit (64KB).
// Each matrix is 64 bytes. 65536 / 64 = 1024.
// We use 1000 to be safe and clean.
const CHUNK_SIZE = 1000;

export class CymbalDandelionBatcher {
    initialized: boolean;
    count: number;
    logicObjects: THREE.Object3D[];

    // Meshes
    stemMesh: THREE.InstancedMesh | null;
    // Stalks and Tips are chunked to avoid Uniform Buffer overflow
    stalkMeshes: THREE.InstancedMesh[];
    tipMeshes: THREE.InstancedMesh[];

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
        this.stalkMeshes = [];
        this.tipMeshes = [];

        this.dummy = new THREE.Object3D();
        this._position = new THREE.Vector3();
        this._quaternion = new THREE.Quaternion();
        this._scale = new THREE.Vector3();
    }

    init() {
        if (this.initialized) return;

        // 1. Stem (Clay Green) - 500 instances fits in one batch (32KB)
        const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6);
        stemGeo.translate(0, 0.75, 0); // Pivot at bottom
        const stemMat = createClayMaterial(0x556B2F);

        this.stemMesh = new THREE.InstancedMesh(stemGeo, stemMat, MAX_DANDELIONS);
        this.stemMesh.castShadow = true;
        this.stemMesh.receiveShadow = true;
        this.stemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.stemMesh.count = 0;

        if (foliageGroup) {
            foliageGroup.add(this.stemMesh);
        }

        // 2. Stalk (Clay White) & 3. Tip (Candy Gold)
        // These need chunking (12,000 instances total)
        const totalStalks = MAX_DANDELIONS * SEEDS_PER_HEAD;
        const numChunks = Math.ceil(totalStalks / CHUNK_SIZE);

        const stalkGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4);
        stalkGeo.translate(0, 0.2, 0); // Pivot at bottom
        const stalkMat = createClayMaterial(0xFFFFFF);

        // TSL Animation for Stalks (Shake)
        const shakeIntensity = uAudioHigh.mul(0.5);
        const phase = float(instanceIndex).mul(13.0);
        const fastTime = uTime.mul(30.0);
        const shakeX = sin(fastTime.add(phase)).mul(shakeIntensity).mul(0.2);
        const shakeZ = cos(fastTime.add(phase.mul(0.7))).mul(shakeIntensity).mul(0.2);
        const yNorm = positionLocal.y.div(0.4);
        const dispX = yNorm.mul(shakeX);
        const dispZ = yNorm.mul(shakeZ);
        stalkMat.positionNode = positionLocal.add(vec3(dispX, float(0.0), dispZ));

        const tipGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const tipMat = createCandyMaterial(0xFFD700, 1.0);
        registerReactiveMaterial(tipMat);
        const tipShakeX = shakeX;
        const tipShakeZ = shakeZ;
        tipMat.positionNode = positionLocal.add(vec3(tipShakeX, float(0.0), tipShakeZ));

        for (let i = 0; i < numChunks; i++) {
            // Calculate size for this chunk (last one might be smaller)
            const remaining = totalStalks - (i * CHUNK_SIZE);
            const limit = Math.min(CHUNK_SIZE, remaining);

            // Stalk Chunk
            const sMesh = new THREE.InstancedMesh(stalkGeo, stalkMat, limit);
            sMesh.castShadow = true;
            sMesh.receiveShadow = true;
            sMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            sMesh.count = 0;
            this.stalkMeshes.push(sMesh);
            if (foliageGroup) foliageGroup.add(sMesh);

            // Tip Chunk
            const tMesh = new THREE.InstancedMesh(tipGeo, tipMat, limit);
            tMesh.castShadow = true;
            tMesh.receiveShadow = true;
            tMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            tMesh.count = 0;
            this.tipMeshes.push(tMesh);
            if (foliageGroup) foliageGroup.add(tMesh);
        }

        if (!foliageGroup) {
            console.warn('[DandelionBatcher] foliageGroup missing!');
        }

        this.initialized = true;
        console.log(`[DandelionBatcher] Initialized with ${numChunks} chunks for 12,000 seeds`);
    }

    register(dummy: THREE.Object3D, options: any = {}) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_DANDELIONS) return;

        const i = this.count;
        this.count++;

        // Update stem count
        this.stemMesh!.count = this.count;

        // Update counts for chunks
        const currentTotalSeeds = this.count * SEEDS_PER_HEAD;

        // Update mesh counts based on total populated seeds
        // We iterate all chunks to set their .count property correctly
        for(let c=0; c < this.stalkMeshes.length; c++) {
            const chunkStart = c * CHUNK_SIZE;
            const chunkEnd = chunkStart + CHUNK_SIZE;

            // How many seeds in this chunk are active?
            if (currentTotalSeeds > chunkEnd) {
                // Full chunk
                this.stalkMeshes[c].count = CHUNK_SIZE;
                this.tipMeshes[c].count = CHUNK_SIZE;
            } else if (currentTotalSeeds > chunkStart) {
                // Partial chunk
                const partial = currentTotalSeeds - chunkStart;
                this.stalkMeshes[c].count = partial;
                this.tipMeshes[c].count = partial;
            } else {
                // Empty chunk
                this.stalkMeshes[c].count = 0;
                this.tipMeshes[c].count = 0;
            }
        }

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
            const globalIdx = seedStartIdx + s;

            // Determine Chunk
            const chunkIdx = Math.floor(globalIdx / CHUNK_SIZE);
            const localIdx = globalIdx % CHUNK_SIZE;

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

            this.stalkMeshes[chunkIdx].setMatrixAt(localIdx, this.dummy.matrix);

            // Matrix for Tip
            const tipOffset = new THREE.Vector3(0, 0.4 * scale, 0);
            tipOffset.applyQuaternion(worldQuat);
            const tipPos = headCenter.clone().add(tipOffset);

            this.dummy.position.copy(tipPos);
            this.dummy.quaternion.copy(worldQuat);
            this.dummy.scale.copy(this._scale);
            this.dummy.updateMatrix();

            this.tipMeshes[chunkIdx].setMatrixAt(localIdx, this.dummy.matrix);
        }

        this.stemMesh!.instanceMatrix.needsUpdate = true;
        // Mark chunks as needing update
        // Optimization: Only update the chunks that were touched?
        // With 12000 total, updating all 12 matrices (12k elements) is fine.
        this.stalkMeshes.forEach(m => m.instanceMatrix.needsUpdate = true);
        this.tipMeshes.forEach(m => m.instanceMatrix.needsUpdate = true);
    }
}

export const dandelionBatcher = new CymbalDandelionBatcher();
