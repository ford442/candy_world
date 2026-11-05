import * as THREE from 'three';
import { color, float, vec3, vec4, sin, cos, positionLocal, normalLocal, add } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../core/scheduler/types.ts';
import { uCircadianPoseOffset } from '../systems/biome-uniforms.ts';
import { getActiveWave } from '../systems/music-wave.ts';
import { foliageGroup } from '../world/state.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import {
    CandyPresets,
    uTime,
    applyStandardDeformation,
    createJuicyRimLight,
    $sn,
} from './material-core.ts';

const MAX_GEYSERS = 500;

export class KickDrumGeyserBatcher extends InstancedBatcher<THREE.Object3D> {
    coreMesh!: THREE.InstancedMesh;
    plumeMesh!: THREE.InstancedMesh;

    private _scratchVec3 = new THREE.Vector3();
    private _scratchPos = new THREE.Vector3();

    // Data arrays for animation
    private _offsets: Float32Array;
    private _maxHeights: Float32Array;

    group = new THREE.Group();

    constructor() {
        super('kick-drum-geyser', 'animate', MAX_GEYSERS);
        this._offsets = new Float32Array(MAX_GEYSERS);
        this._maxHeights = new Float32Array(MAX_GEYSERS);
        // Add dummy meshes so register works correctly before mesh is assigned
        // The base class will call createMesh on first add, but we want it up front
        this.mesh = this.createMesh(MAX_GEYSERS);
        this.mesh.count = 0;
    }

    protected createMesh(capacity: number): THREE.InstancedMesh {
        // Base Clay Mesh
        const baseGeo = new THREE.RingGeometry(0.1, 0.4, 8, 1);
        baseGeo.rotateX(-Math.PI / 2);
        const baseMat = CandyPresets.Clay(0x1a0a00, {
            roughness: 0.9,
            emissive: 0xff4500,
            emissiveIntensity: 0.1,
        });
        const baseMesh = new THREE.InstancedMesh(baseGeo, baseMat, capacity);
        baseMesh.count = 0;
        baseMesh.frustumCulled = false;
        foliageGroup.add(baseMesh);

        // Core Gummy Mesh
        const coreGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.1, 8);
        coreGeo.translate(0, -0.05, 0);
        const coreMat = CandyPresets.Gummy(0xff4500, {
            roughness: 0.3,
            emissive: 0xff4500,
            emissiveIntensity: 0.8,
        });
        // 🎨 PALETTE: Add juicy rim light to geyser core
        coreMat.emissiveNode = add(
            $sn(coreMat.emissiveNode ?? color(0x000000)),
            createJuicyRimLight(color(0xff4500), float(1.5), float(3.0), normalLocal)
        );
        registerReactiveMaterial(coreMat);
        this.coreMesh = new THREE.InstancedMesh(coreGeo, coreMat, capacity);
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
            depthWrite: false,
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
        const circadianDroop = vec3(
            0,
            float(-0.5).mul(uCircadianPoseOffset).mul(positionLocal.y),
            0
        );
        plumeMat.positionNode = applyStandardDeformation(plumePos.add(circadianDroop));
        plumeMat.colorNode = vec4(color(0xff4500), float(0.8));

        this.plumeMesh = new THREE.InstancedMesh(plumeGeo, plumeMat, capacity);
        this.plumeMesh.count = 0;
        this.plumeMesh.frustumCulled = false;
        foliageGroup.add(this.plumeMesh);

        return baseMesh;
    }

    public get baseMesh(): THREE.InstancedMesh {
        return this.mesh!;
    }

    protected writeRecord(record: THREE.Object3D, slot: number, array: Float32Array): void {
        record.matrixWorld.compose(record.position, record.quaternion, record.scale);
        if (record.parent) {
            record.matrixWorld.multiplyMatrices(record.parent.matrixWorld, record.matrixWorld);
        }
        const matrixArray = record.matrixWorld.elements;

        for (let j = 0; j < 16; j++) {
            array[slot * 16 + j] = matrixArray[j];
            this.coreMesh.instanceMatrix.array[slot * 16 + j] = matrixArray[j];
            this.plumeMesh.instanceMatrix.array[slot * 16 + j] = matrixArray[j];
        }

        this.coreMesh.instanceMatrix.needsUpdate = true;
        this.plumeMesh.instanceMatrix.needsUpdate = true;
    }

    protected onSwap(fromSlot: number, toSlot: number): void {
        this._offsets[toSlot] = this._offsets[fromSlot];
        this._maxHeights[toSlot] = this._maxHeights[fromSlot];

        // Ensure secondary meshes count is updated
        this.coreMesh.count = this.count - 1; // Since swap happens before count decrement, we will adjust it after in remove
        this.plumeMesh.count = this.count - 1;
    }

    /**
     * Registers a new Geyser instance.
     */
    register(proxy: THREE.Object3D, options: { maxHeight?: number } = {}) {
        const handle = this.add(proxy);
        if (handle === null) return;
        const slot = this.handleToSlot.get(handle)!;

        this._offsets[slot] = Math.random() * 10.0;
        this._maxHeights[slot] = options.maxHeight ?? 5.0;
        proxy.userData.batchHandle = handle;
        proxy.userData.isBatched = true;
        proxy.userData.type = 'kick_drum_geyser';

        // Also keep coreMesh/plumeMesh count in sync since they're updated when add calls markDirty
        // actually markDirty doesn't touch count, but baseMesh count is updated.
        this.coreMesh.count = this.count;
        this.plumeMesh.count = this.count;
    }

    /**
     * Update loop to animate plumes based on kick drum audio
     */

    removeInstance(logicObject: THREE.Object3D): void {
        if (!logicObject) return;
        const handle = logicObject.userData?.batchHandle;
        if (typeof handle !== 'number') {
            return;
        }

        this.remove(handle);
        this.coreMesh.count = this.count;
        this.plumeMesh.count = this.count;
    }

    protected step(ctx: FrameContext): void {
        this.legacyUpdate(ctx.time, ctx.dt, ctx.audio, getActiveWave());
    }

    legacyUpdate(_time: number, _deltaTime: number, audioState: any, activeWave: any) {
        if (this.count === 0) return;

        // Eruption logic is driven by the 'kick' channel (typically uAudioLow in similar batchers or audioState.kick)
        const globalKick = audioState?.channels?.kick?.intensity || 0;

        const baseArray = this.baseMesh.instanceMatrix.array;
        const plumeArray = this.plumeMesh.instanceMatrix.array;

        let plumeDirty = false;

        // ⚡ OPTIMIZATION: Hoisted wave radius + deferred sqrt; skip plume writes when scaleY is unchanged.
        let elapsedSec = 0;
        let speed = 25;
        let waveRadiusSq = 0;
        let ox = 0,
            oy = 0,
            oz = 0;

        if (activeWave) {
            elapsedSec = (performance.now() - activeWave.timestamp) / 1000;
            if (elapsedSec > 0) {
                speed = activeWave.speed || 25;
                const r = elapsedSec * speed;
                waveRadiusSq = r * r;
                if (activeWave.origin) {
                    ox = activeWave.origin.x;
                    oy = activeWave.origin.y;
                    oz = activeWave.origin.z;
                }
            }
        }

        // O(N) zero-allocation hot path
        for (let i = 0; i < this.count; i++) {
            const baseIndex = i * 16;
            let localKick = globalKick;

            if (activeWave) {
                if (elapsedSec <= 0) {
                    localKick = 0;
                } else {
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
            }

            const targetScaleY = localKick * this._maxHeights[i] + 0.1;

            const plumeM00 = plumeArray[baseIndex + 0];
            const plumeM11 = plumeArray[baseIndex + 5];

            // Only write if scale changed significantly
            if (Math.abs(plumeM11 - targetScaleY) > 0.01) {
                plumeArray[baseIndex + 5] = targetScaleY;
                plumeDirty = true;
            }
        }

        if (plumeDirty) {
            this.plumeMesh.instanceMatrix.needsUpdate = true;
        }
    }

    dispose() {
        super.dispose();
        if (this.coreMesh && this.coreMesh.parent) {
            this.coreMesh.parent.remove(this.coreMesh);
            this.coreMesh.geometry?.dispose();
            if (Array.isArray(this.coreMesh.material)) {
                this.coreMesh.material.forEach(m => m.dispose());
            } else {
                this.coreMesh.material?.dispose();
            }
        }
        if (this.plumeMesh && this.plumeMesh.parent) {
            this.plumeMesh.parent.remove(this.plumeMesh);
            this.plumeMesh.geometry?.dispose();
            if (Array.isArray(this.plumeMesh.material)) {
                this.plumeMesh.material.forEach(m => m.dispose());
            } else {
                this.plumeMesh.material?.dispose();
            }
        }
    }
}

export const kickDrumGeyserBatcher = new KickDrumGeyserBatcher();
