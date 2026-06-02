import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    CandyPresets,
    uTime,
    registerReactiveMaterial
} from './index.ts';
import {
    color, float, vec3, vec4, sin, cos, positionLocal, time, uniform
} from 'three/tsl';
import { BiomeId } from '../systems/biome-uniforms.ts';
import { computeWaveTimeSinceArrival } from '../systems/music-reactivity.ts';
import { foliageGroup } from '../world/state.ts';

const MAX_GEYSERS = 500;

export class KickDrumGeyserBatcher {
    baseMesh!: THREE.InstancedMesh;
    coreMesh!: THREE.InstancedMesh;
    plumeMesh!: THREE.InstancedMesh;

    private _count = 0;
    private _scratchMatrix = new THREE.Matrix4();
    private _scratchVec3 = new THREE.Vector3();
    private _scratchPos = new THREE.Vector3();

    // Data arrays for animation
    private _offsets: Float32Array;
    private _maxHeights: Float32Array;

    group = new THREE.Group();

    constructor() {
        this._offsets = new Float32Array(MAX_GEYSERS);
        this._maxHeights = new Float32Array(MAX_GEYSERS);
        this.init();
    }

    private init() {
        // Base Clay Mesh
        const baseGeo = new THREE.RingGeometry(0.1, 0.4, 8, 1);
        baseGeo.rotateX(-Math.PI / 2);
        const baseMat = CandyPresets.Clay(0x1A0A00, {
            roughness: 0.9,
            emissive: 0xFF4500,
            emissiveIntensity: 0.1
        });
        this.baseMesh = new THREE.InstancedMesh(baseGeo, baseMat, MAX_GEYSERS);
        this.baseMesh.count = 0;
        this.baseMesh.frustumCulled = false;
        foliageGroup.add(this.baseMesh);

        // Core Gummy Mesh
        const coreGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.1, 8);
        coreGeo.translate(0, -0.05, 0);
        const coreMat = CandyPresets.Gummy(0xFF4500, {
            roughness: 0.3,
            emissive: 0xFF4500,
            emissiveIntensity: 0.8
        });
        registerReactiveMaterial(coreMat);
        this.coreMesh = new THREE.InstancedMesh(coreGeo, coreMat, MAX_GEYSERS);
        this.coreMesh.count = 0;
        this.coreMesh.frustumCulled = false;
        foliageGroup.add(this.coreMesh);

        // Plume Mesh (Semi-transparent animated column)
        const plumeGeo = new THREE.CylinderGeometry(0.15, 0.15, 1, 8, 4);
        plumeGeo.translate(0, 0.5, 0); // Origin at bottom

        const plumeMat = new MeshStandardNodeMaterial({
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // ⚡ OPTIMIZATION: TSL Node for Plume Animation (Wave-based scale handled in CPU update logic, but we can add jitter here)
        const jitterX = sin(uTime.mul(10.0).add(positionLocal.y.mul(10.0))).mul(0.1);
        const jitterZ = cos(uTime.mul(12.0).add(positionLocal.y.mul(10.0))).mul(0.1);

        plumeMat.positionNode = vec3(
            positionLocal.x.add(jitterX),
            positionLocal.y,
            positionLocal.z.add(jitterZ)
        );
        plumeMat.colorNode = vec4(color(0xFF4500), float(0.8));

        this.plumeMesh = new THREE.InstancedMesh(plumeGeo, plumeMat, MAX_GEYSERS);
        this.plumeMesh.count = 0;
        this.plumeMesh.frustumCulled = false;
        foliageGroup.add(this.plumeMesh);
    }

    /**
     * Registers a new Geyser instance.
     */
    register(proxy: THREE.Object3D, options: { maxHeight?: number } = {}) {
        if (this._count >= MAX_GEYSERS) return;

        const i = this._count;
        this._count++;

        this.baseMesh.count = this._count;
        this.coreMesh.count = this._count;
        this.plumeMesh.count = this._count;

        // Apply Transform
        proxy.updateMatrixWorld(true);
        this.baseMesh.setMatrixAt(i, proxy.matrixWorld);
        this.coreMesh.setMatrixAt(i, proxy.matrixWorld);

        // Plume will be scaled dynamically
        this.plumeMesh.setMatrixAt(i, proxy.matrixWorld);

        this.baseMesh.instanceMatrix.needsUpdate = true;
        this.coreMesh.instanceMatrix.needsUpdate = true;
        this.plumeMesh.instanceMatrix.needsUpdate = true;

        this._offsets[i] = Math.random() * 10.0;
        this._maxHeights[i] = options.maxHeight ?? 5.0;
    }

    /**
     * Update loop to animate plumes based on kick drum audio
     */
    update(time: number, deltaTime: number, audioState: any, activeWave: any) {
        if (this._count === 0) return;

        // Eruption logic is driven by the 'kick' channel (typically uAudioLow in similar batchers or audioState.kick)
        const globalKick = audioState?.channels?.kick?.intensity || 0;

        const baseArray = this.baseMesh.instanceMatrix.array;
        const plumeArray = this.plumeMesh.instanceMatrix.array;

        // O(N) zero-allocation hot path
        for (let i = 0; i < this._count; i++) {
            // Get position directly from array for wave calculation
            const x = baseArray[i * 16 + 12];
            const y = baseArray[i * 16 + 13];
            const z = baseArray[i * 16 + 14];

            // ⚡ OPTIMIZATION: Zero-allocation position object for wave computation
            this._scratchPos.set(x, y, z);

            // Calculate distance-based wave timing
            const waveTime = computeWaveTimeSinceArrival(activeWave, this._scratchPos);

            // Simulate local kick intensity. If wave hasn't reached, it's 0.
            // If it reached recently, apply a sharp spike that decays.
            let localKick = globalKick;
            if (activeWave) {
                if (waveTime < 0) {
                    localKick = 0;
                } else if (waveTime < 0.2) {
                    // Sharp spike when wave hits
                    localKick = 1.0;
                } else {
                    // Exponential decay
                    localKick = Math.max(0, Math.exp(-10.0 * (waveTime - 0.2)));
                }
            }

            // Plume vertical scaling
            const targetHeight = this._maxHeights[i] * localKick;

            // Manual matrix composition for plume
            // Keep base transform, but scale Y axis
            this._scratchMatrix.fromArray(baseArray, i * 16);

            // Scale the y axis by targetHeight
            this._scratchVec3.set(1, targetHeight + 0.01, 1); // 0.01 to prevent singular matrix warning
            this._scratchMatrix.scale(this._scratchVec3);

            this._scratchMatrix.toArray(plumeArray, i * 16);
        }

        this.plumeMesh.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        if (this.baseMesh) {
            this.baseMesh.geometry.dispose();
            if (Array.isArray(this.baseMesh.material)) {
                this.baseMesh.material.forEach(m => m.dispose());
            } else {
                this.baseMesh.material.dispose();
            }
        }

        if (this.coreMesh) {
            this.coreMesh.geometry.dispose();
            if (Array.isArray(this.coreMesh.material)) {
                this.coreMesh.material.forEach(m => m.dispose());
            } else {
                this.coreMesh.material.dispose();
            }
        }

        if (this.plumeMesh) {
            this.plumeMesh.geometry.dispose();
            if (Array.isArray(this.plumeMesh.material)) {
                this.plumeMesh.material.forEach(m => m.dispose());
            } else {
                this.plumeMesh.material.dispose();
            }
        }
    }
}

export const kickDrumGeyserBatcher = new KickDrumGeyserBatcher();
