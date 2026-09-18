import * as THREE from 'three';
import {
    color, float, vec3, vec4, sin, cos, positionLocal, normalLocal, add
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uCircadianPoseOffset } from '../systems/biome-uniforms.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { foliageGroup } from '../world/state.ts';
import {
    CandyPresets,
    uTime,
    registerReactiveMaterial,
    applyStandardDeformation,
    createJuicyRimLight
} from './index.ts';

const MAX_GEYSERS = 500;

export class KickDrumGeyserBatcher {
    baseMesh!: THREE.InstancedMesh;
    coreMesh!: THREE.InstancedMesh;
    plumeMesh!: THREE.InstancedMesh;

    private _count = 0;
    private _scratchMatrix = new THREE.Matrix4();
    private _scratchVec3 = new THREE.Vector3();
    private _scratchPos = new THREE.Vector3();

    private _instanceMap = new Map<number, number>();

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
        // 🎨 PALETTE: Add juicy rim light to geyser core
        coreMat.emissiveNode = add(coreMat.emissiveNode ?? color(0x000000), createJuicyRimLight(color(0xFF4500), float(1.5), float(3.0), normalLocal));
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

        const plumePos = vec3(
            positionLocal.x.add(jitterX),
            positionLocal.y,
            positionLocal.z.add(jitterZ)
        );

        // 🎨 PALETTE: Add wind sway and player interaction to the geyser plumes
        const circadianDroop = vec3(0, float(-0.5).mul(uCircadianPoseOffset).mul(positionLocal.y), 0);
        plumeMat.positionNode = applyStandardDeformation(plumePos.add(circadianDroop));
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
        // ⚡ OPTIMIZATION: Bypassed THREE.Object3D proxy and setMatrixAt() overhead by writing directly to instanceMatrix
        proxy.matrixWorld.compose(proxy.position, proxy.quaternion, proxy.scale);
        if (proxy.parent) {
            proxy.matrixWorld.multiplyMatrices(proxy.parent.matrixWorld, proxy.matrixWorld);
        }
        const matrixArray = proxy.matrixWorld.elements;

        for (let j = 0; j < 16; j++) {
            this.baseMesh.instanceMatrix.array[i * 16 + j] = matrixArray[j];
            this.coreMesh.instanceMatrix.array[i * 16 + j] = matrixArray[j];
            this.plumeMesh.instanceMatrix.array[i * 16 + j] = matrixArray[j]; // Plume will be scaled dynamically later
        }

        this.baseMesh.instanceMatrix.needsUpdate = true;
        this.coreMesh.instanceMatrix.needsUpdate = true;
        this.plumeMesh.instanceMatrix.needsUpdate = true;

        this._offsets[i] = Math.random() * 10.0;
        this._maxHeights[i] = options.maxHeight ?? 5.0;
        this._instanceMap.set(proxy.id, i);
        proxy.userData.isBatched = true;
        proxy.userData.type = 'kick_drum_geyser';
    }

    /**
     * Update loop to animate plumes based on kick drum audio
     */

    removeInstance(logicObject: THREE.Object3D) {
        if (this._count === 0 || !logicObject) return;

        const id = logicObject.id;
        const i = this._instanceMap.get(id);
        if (i === undefined) return;

        this._count--;
        const lastIndex = this._count;

        // If it's not the last element, swap with last
        if (i !== lastIndex) {
            this._offsets[i] = this._offsets[lastIndex];
            this._maxHeights[i] = this._maxHeights[lastIndex];

            // Swap matrices
            for (let j = 0; j < 16; j++) {
                this.baseMesh.instanceMatrix.array[i * 16 + j] = this.baseMesh.instanceMatrix.array[lastIndex * 16 + j];
                this.coreMesh.instanceMatrix.array[i * 16 + j] = this.coreMesh.instanceMatrix.array[lastIndex * 16 + j];
                this.plumeMesh.instanceMatrix.array[i * 16 + j] = this.plumeMesh.instanceMatrix.array[lastIndex * 16 + j];
            }

            // Update map for the swapped object.
            // We need to find the logic object ID that was at lastIndex.
            // We can iterate the map, or we can maintain a reverse map.
            // Since Map iteration is somewhat slow, let's just do it directly.
            for (const [key, val] of this._instanceMap.entries()) {
                if (val === lastIndex) {
                    this._instanceMap.set(key, i);
                    break;
                }
            }
        }

        this._instanceMap.delete(id);

        this.baseMesh.count = this._count;
        this.coreMesh.count = this._count;
        this.plumeMesh.count = this._count;

        this.baseMesh.instanceMatrix.needsUpdate = true;
        this.coreMesh.instanceMatrix.needsUpdate = true;
        this.plumeMesh.instanceMatrix.needsUpdate = true;
    }

    update(_time: number, _deltaTime: number, audioState: any, activeWave: any) {
        if (this._count === 0) return;

        // Eruption logic is driven by the 'kick' channel (typically uAudioLow in similar batchers or audioState.kick)
        const globalKick = audioState?.channels?.kick?.intensity || 0;

        const baseArray = this.baseMesh.instanceMatrix.array;
        const plumeArray = this.plumeMesh.instanceMatrix.array;

        // ⚡ OPTIMIZATION: Hoisted wave radius + deferred sqrt; skip plume writes when scaleY is unchanged.
        let hasWave = false;
        let elapsedSec = 0;
        let speed = 25;
        let waveRadiusSq = 0;
        let ox = 0, oy = 0, oz = 0;

        if (activeWave) {
            hasWave = true;
            speed = activeWave.speed || 25;
            elapsedSec = (performance.now() - activeWave.timestamp) / 1000;
            const r = elapsedSec * speed;
            waveRadiusSq = r * r;
            const origin = activeWave.origin || new THREE.Vector3();
            ox = origin.x; oy = origin.y; oz = origin.z;
        }

        // O(N) zero-allocation hot path
        for (let i = 0; i < this._count; i++) {
            const baseIndex = i * 16;
            let localKick = globalKick;

            if (hasWave) {
                const dx = baseArray[baseIndex + 12] - ox;
                const dy = baseArray[baseIndex + 13] - oy;
                const dz = baseArray[baseIndex + 14] - oz;
                const distSq = dx * dx + dy * dy + dz * dz;

                if (waveRadiusSq <= 0 || distSq > waveRadiusSq) {
                    localKick = 0;
                } else {
                    const waveTime = elapsedSec - Math.sqrt(distSq) / speed;
                    if (waveTime < 0) {
                        localKick = 0;
                    } else if (waveTime < 0.2) {
                        localKick = 1.0;
                    } else {
                        localKick = Math.max(0, Math.exp(-10.0 * (waveTime - 0.2)));
                    }
                }
            }

            // Plume vertical scaling
            const targetHeight = this._maxHeights[i] * localKick;

            // Manual matrix composition for plume
            // Keep base transform, but scale Y axis
            // ⚡ OPTIMIZATION: Bypassed Matrix4 composition overhead by directly modifying the Y-axis basis vector in the Float32Array
            const scaleY = targetHeight + 0.01; // 0.01 to prevent singular matrix warning

            // dirty check
            if (Math.abs(plumeArray[baseIndex + 5] - (baseArray[baseIndex + 5] * scaleY)) < 1e-6) continue;

            plumeArray[baseIndex + 0] = baseArray[baseIndex + 0];
            plumeArray[baseIndex + 1] = baseArray[baseIndex + 1];
            plumeArray[baseIndex + 2] = baseArray[baseIndex + 2];
            plumeArray[baseIndex + 3] = baseArray[baseIndex + 3];

            // Scale Y-axis basis vector
            plumeArray[baseIndex + 4] = baseArray[baseIndex + 4] * scaleY;
            plumeArray[baseIndex + 5] = baseArray[baseIndex + 5] * scaleY;
            plumeArray[baseIndex + 6] = baseArray[baseIndex + 6] * scaleY;
            plumeArray[baseIndex + 7] = baseArray[baseIndex + 7] * scaleY;

            plumeArray[baseIndex + 8] = baseArray[baseIndex + 8];
            plumeArray[baseIndex + 9] = baseArray[baseIndex + 9];
            plumeArray[baseIndex + 10] = baseArray[baseIndex + 10];
            plumeArray[baseIndex + 11] = baseArray[baseIndex + 11];

            plumeArray[baseIndex + 12] = baseArray[baseIndex + 12];
            plumeArray[baseIndex + 13] = baseArray[baseIndex + 13];
            plumeArray[baseIndex + 14] = baseArray[baseIndex + 14];
            plumeArray[baseIndex + 15] = baseArray[baseIndex + 15];
        }

        this.plumeMesh.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        if (this.baseMesh && this.baseMesh.parent) {
            safeRemoveAndDispose(this.baseMesh.parent, this.baseMesh);
        }
        if (this.coreMesh && this.coreMesh.parent) {
            safeRemoveAndDispose(this.coreMesh.parent, this.coreMesh);
        }
        if (this.plumeMesh && this.plumeMesh.parent) {
            safeRemoveAndDispose(this.plumeMesh.parent, this.plumeMesh);
        }
    }
}

export const kickDrumGeyserBatcher = new KickDrumGeyserBatcher();
