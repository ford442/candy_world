import * as THREE from 'three';
import { shouldUseFoliageGpuBatch } from '../../compute/foliage-gpu-batch.ts';
import { getCIAdjustedCount } from '../../core/config.ts';
import { InstancedBatcher } from '../../core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../../core/scheduler/types.ts';
import { registerFoliageBatcherLod } from '../../systems/batcher-lod.ts';
import { writeInstancePose } from '../../utils/wasm-batcher-instance.ts';
import { getGroundAlignedQuaternion } from '../../world/placement-utils.ts';
import { foliageGroup } from '../../world/state.ts';
import { initInstanceLodAttribute } from '../batcher-lod-utils.ts';
import { uChromaticIntensity } from '../chromatic-nodes.ts';
import { spawnImpact } from '../impacts.ts';
import { uTime } from '../material-core.ts';
import {
    MAX_MUSHROOMS,
    _scratchPos,
    _scratchQuat,
    _scratchColor,
} from './constants.ts';
import { createMergedGeometry } from './geometry.ts';
import { createMaterials } from './materials.ts';

export class MushroomBatcher extends InstancedBatcher<{ proxy: THREE.Object3D, options: any }> {
    private static instance: MushroomBatcher;

    // OPTIMIZED: Packed into single vec4 to reduce vertex buffers from 11 to 8
    // instanceData: x=packedFlags, y=spawnTime, z=triggerTime, w=velocity
    // packedFlags encoding: noteIndex+1 + hasFace*20 + isGiant*40
    private instanceData: THREE.InstancedBufferAttribute | null = null;

    // Matrix/color batching state (SoA → native or TS writeInstancePose)
    private _batchPositions: Float32Array;
    private _batchQuaternions: Float32Array;
    private _batchScales: Float32Array;
    private _batchColors: Float32Array;

    // Mapping: Note Index (0-11) -> Array of Instance Indices (slots)
    private noteToInstances: Map<number, number[]> = new Map();

    private constructor() {
        super('mushroom', 'animate', MAX_MUSHROOMS);
        this._batchPositions = new Float32Array(MAX_MUSHROOMS * 3);
        this._batchQuaternions = new Float32Array(MAX_MUSHROOMS * 4);
        this._batchScales = new Float32Array(MAX_MUSHROOMS * 3);
        this._batchColors = new Float32Array(MAX_MUSHROOMS * 3);
    }

    protected createMesh(capacity: number): THREE.InstancedMesh {
        // 1. Create Merged Geometry
        const geometry = createMergedGeometry();

        // 2. Attributes - SINGLE packed attribute to stay within WebGPU 8 buffer limit
        this.instanceData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);

        geometry.setAttribute('instanceData', this.instanceData);

        // 3. Materials with TSL
        const materials = createMaterials();

        // 4. InstancedMesh
        const mesh = new THREE.InstancedMesh(geometry, materials, capacity);
        mesh.userData.seasonRole = 'cap';

        // PALETTE: Initialize instanceColor manually since we use TSL
        const colors = new Float32Array(capacity * 3);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        mesh.geometry.setAttribute('instanceColor', mesh.instanceColor);
        initInstanceLodAttribute(mesh, capacity);

        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;

        // Add to Scene (assuming foliageGroup exists and is in scene)
        if (foliageGroup) {
            foliageGroup.add(mesh);
        } else {
            console.warn('[MushroomBatcher] foliageGroup not found, mushrooms might not be visible.');
        }

        registerFoliageBatcherLod({ id: 'mushroom', getMeshes: () => [mesh] });
        console.log('[MushroomBatcher] Initialized with capacity ' + capacity);
        return mesh;
    }

    getRandomPosition(out: THREE.Vector3): boolean {
        if (!this.mesh || this.count === 0) return false;
        const idx = Math.floor(Math.random() * this.count);

        // ⚡ OPTIMIZATION: Bypassed THREE.InstancedMesh.getMatrixAt() overhead by reading directly from typed array
        const array = this.mesh.instanceMatrix.array as Float32Array;
        const offset = idx * 16;
        out.set(array[offset + 12], array[offset + 13], array[offset + 14]);

        return true;
    }

    static getInstance(): MushroomBatcher {
        if (!MushroomBatcher.instance) {
            MushroomBatcher.instance = new MushroomBatcher();
        }
        return MushroomBatcher.instance;
    }

    getLODMeshes(): THREE.InstancedMesh[] {
        return this.mesh ? [this.mesh] : [];
    }

    protected writeRecord(record: { proxy: THREE.Object3D, options: any }, slot: number, array: Float32Array): void {
        const dummy = record.proxy;
        const options = record.options;
        const i = slot;

        // 1. Set Matrix
        getGroundAlignedQuaternion(dummy, _scratchQuat);
        this._batchPositions[i * 3 + 0] = dummy.position.x;
        this._batchPositions[i * 3 + 1] = dummy.position.y;
        this._batchPositions[i * 3 + 2] = dummy.position.z;

        this._batchQuaternions[i * 4 + 0] = _scratchQuat.x;
        this._batchQuaternions[i * 4 + 1] = _scratchQuat.y;
        this._batchQuaternions[i * 4 + 2] = _scratchQuat.z;
        this._batchQuaternions[i * 4 + 3] = _scratchQuat.w;

        this._batchScales[i * 3 + 0] = dummy.scale.x;
        this._batchScales[i * 3 + 1] = dummy.scale.y;
        this._batchScales[i * 3 + 2] = dummy.scale.z;

        // PALETTE: Set Color
        // Default to Red (0xFF6B6B) if no note color provided
        const colorHex = options.noteColor !== undefined ? options.noteColor : 0xFF6B6B;
        _scratchColor.setHex(colorHex);
        this._batchColors[i * 3 + 0] = _scratchColor.r;
        this._batchColors[i * 3 + 1] = _scratchColor.g;
        this._batchColors[i * 3 + 2] = _scratchColor.b;

        // Note: The base class expects us to write to `array`, but because we use writeInstancePose for SoA->AoS,
        // we'll flag matricesDirty and defer the actual matrix array population to flushMatrices() inside update().
        // BUT we need it immediately if not using WASM or we can just call writeInstancePose here for this one slot.
        // Actually writeInstancePose writes a range, so it's easier to just flag it.
        // The base class will set this.mesh.instanceMatrix.needsUpdate if we called this.markDirty().
    }

    protected step(ctx: FrameContext): void {
        if (this.matricesDirty) {
            this.flushMatrices();
        }
    }

    private flushMatrices() {
        if (!this.mesh || this.count === 0) return;

        const matrixArray = this.mesh.instanceMatrix.array as Float32Array;
        const colorArray = this.mesh.instanceColor
            ? (this.mesh.instanceColor.array as Float32Array)
            : null;

        writeInstancePose(
            this._batchPositions,
            this._batchQuaternions,
            this._batchScales,
            this._batchColors,
            matrixArray,
            colorArray,
            1.0,
            this.count
        );

        if (!shouldUseFoliageGpuBatch(this.count)) {
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }
        this.matricesDirty = false;
    }

    register(dummy: THREE.Object3D, options: any) {
        // Prepare the new record attributes so they're ready when writeRecord is called
        const handle = this.add({ proxy: dummy, options });
        if (handle === null) return;
        const slot = this.handleToSlot.get(handle)!;

        // ⚡ OPTIMIZATION: Mark as batched
        dummy.userData.isBatched = true;
        dummy.userData.batchHandle = handle;

        const hasFace = options.hasFace ? 1.0 : 0.0;
        const noteIndex = options.noteIndex !== undefined ? options.noteIndex : -1;
        const isGiant = options.size === 'giant' ? 1.0 : 0.0;
        const spawnTime = options.spawnTime || -100.0;
        const packedFlags = (noteIndex + 1) + hasFace * 20 + isGiant * 40;

        const instanceDataArray = this.instanceData!.array as Float32Array;
        const i4 = slot * 4;
        instanceDataArray[i4] = packedFlags;
        instanceDataArray[i4 + 1] = spawnTime;
        instanceDataArray[i4 + 2] = -100.0;
        instanceDataArray[i4 + 3] = 0;

        if (noteIndex >= 0) {
            if (!this.noteToInstances.has(noteIndex)) {
                this.noteToInstances.set(noteIndex, []);
            }
            this.noteToInstances.get(noteIndex)!.push(slot);
        }

        if (!shouldUseFoliageGpuBatch(this.count)) {
            this.mesh!.instanceMatrix.needsUpdate = true;
            if (this.mesh!.instanceColor) this.mesh!.instanceColor.needsUpdate = true;
        }
        this.instanceData!.needsUpdate = true;
    }

    protected onSwap(fromSlot: number, toSlot: number): void {
        const instanceDataArray = this.instanceData!.array as Float32Array;

        // Fix up noteToInstances for the swapped slot
        const lastPackedFlags = instanceDataArray[fromSlot * 4];
        const movedNoteIndex = (lastPackedFlags % 20) - 1;
        if (movedNoteIndex >= 0) {
            const list = this.noteToInstances.get(movedNoteIndex);
            if (list) {
                const idx = list.indexOf(fromSlot);
                if (idx > -1) list[idx] = toSlot;
            }
        }

        // Copy custom attributes
        for (let k = 0; k < 3; k++) {
            this._batchPositions[toSlot * 3 + k] = this._batchPositions[fromSlot * 3 + k];
            this._batchScales[toSlot * 3 + k] = this._batchScales[fromSlot * 3 + k];
            this._batchColors[toSlot * 3 + k] = this._batchColors[fromSlot * 3 + k];
        }
        for (let k = 0; k < 4; k++) {
            this._batchQuaternions[toSlot * 4 + k] = this._batchQuaternions[fromSlot * 4 + k];
        }

        const iRem4 = toSlot * 4;
        const iLast4 = fromSlot * 4;
        instanceDataArray[iRem4] = instanceDataArray[iLast4];
        instanceDataArray[iRem4 + 1] = instanceDataArray[iLast4 + 1];
        instanceDataArray[iRem4 + 2] = instanceDataArray[iLast4 + 2];
        instanceDataArray[iRem4 + 3] = instanceDataArray[iLast4 + 3];
    }

    removeInstance(logicObject: THREE.Object3D) {
        if (!logicObject) return;
        const handle = logicObject.userData.batchHandle;
        if (typeof handle !== 'number') return;
        const slotToRemove = this.handleToSlot.get(handle);
        if (slotToRemove === undefined) return;

        // Clean up our specific state before swap-remove
        const instanceDataArray = this.instanceData!.array as Float32Array;
        const removedPackedFlags = instanceDataArray[slotToRemove * 4];
        const removedNoteIndex = (removedPackedFlags % 20) - 1;
        if (removedNoteIndex >= 0) {
            const list = this.noteToInstances.get(removedNoteIndex);
            if (list) {
                const idx = list.indexOf(slotToRemove);
                if (idx > -1) list.splice(idx, 1);
            }
        }

        this.remove(handle);

        if (this.mesh && !shouldUseFoliageGpuBatch(this.count)) {
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }
        if (this.instanceData) this.instanceData.needsUpdate = true;
    }

    handleNote(noteIndex: number, velocity: number) {
        if (!this.mesh) return;

        const indices = this.noteToInstances.get(noteIndex);
        if (indices) {
            // PALETTE FIX: Use uTime.value for sync with TSL shader
            // Cast to any to access .value on UniformNode
            const now = ((uTime as any).value !== undefined) ? (uTime as any).value : performance.now() / 1000.0;
            const normalizedVelocity = velocity / 127.0;

            const instanceDataArray = this.instanceData!.array as Float32Array;

            for (const i of indices) {
                // Update triggerTime (z) and velocity (w) in packed attribute
                // ⚡ OPTIMIZATION: Bypassed BufferAttribute setters
                instanceDataArray[i * 4 + 2] = now;
                instanceDataArray[i * 4 + 3] = normalizedVelocity; // Normalize velocity

                // PALETTE: Spawn Spores!
                // ⚡ OPTIMIZATION: Bypassed .getMatrixAt(), .decompose() and .getColorAt() for fast spawn extraction
                const matrixArray = this.mesh.instanceMatrix.array as Float32Array;
                const matOffset = i * 16;

                // Extract position
                _scratchPos.set(matrixArray[matOffset + 12], matrixArray[matOffset + 13], matrixArray[matOffset + 14]);

                // Extract scale Y (magnitude of the second column)
                const m10 = matrixArray[matOffset + 4], m11 = matrixArray[matOffset + 5], m12 = matrixArray[matOffset + 6];
                const scaleYSq = m10 * m10 + m11 * m11 + m12 * m12;
                const scaleY = scaleYSq > 0.0001 ? Math.sqrt(scaleYSq) : 0;

                if (this.mesh.instanceColor) {
                    const colorArray = this.mesh.instanceColor.array as Float32Array;
                    const colOffset = i * 3;
                    _scratchColor.setRGB(colorArray[colOffset], colorArray[colOffset + 1], colorArray[colOffset + 2]);
                } else {
                    _scratchColor.setHex(0xFFFFFF);
                }

                // Offset slightly up (cap height approx 1.0 * scale.y)
                _scratchPos.y += 0.8 * scaleY;

                // Spawn impact
                spawnImpact(_scratchPos, 'spore', _scratchColor);
            }
            this.instanceData!.needsUpdate = true;
            // Optim: Use addUpdateRange if indices are contiguous?
            // Likely not contiguous. Partial update might be slower than full upload if fragmented.
            // Just flag needsUpdate.

            // 🎨 Palette: "Juice" Factor - Add screen bump on high velocity
            if (typeof uChromaticIntensity !== 'undefined' && normalizedVelocity > 0.5) {
                uChromaticIntensity.value = Math.max(uChromaticIntensity.value, normalizedVelocity * 0.3);
            }
        }
    }
}

export const mushroomBatcher = MushroomBatcher.getInstance();
