import * as THREE from 'three';
import { shouldUseFoliageGpuBatch } from '../../compute/foliage-gpu-batch.ts';
import { getCIAdjustedCount } from '../../core/config.ts';
import { registerFoliageBatcherLod } from '../../systems/batcher-lod.ts';
import { writeInstancePose } from '../../utils/wasm-batcher-instance.ts';
import { getGroundAlignedQuaternion } from '../../world/placement-utils.ts';
import { foliageGroup } from '../../world/state.ts';
import { initInstanceLodAttribute } from '../batcher-lod-utils.ts';
import { uChromaticIntensity } from '../chromatic-nodes.ts';
import { spawnImpact } from '../impacts.ts';
import { uTime } from '../index.ts';

import {
    MAX_MUSHROOMS,
    _scratchMatrix,
    _scratchMatrix2,
    _scratchPos,
    _scratchScale,
    _scratchQuat,
    _scratchColor,
    _scratchCapCenter,
    _scratchSpotScale,
    _scratchUp,
    _scratchEye,
    _scratchDummyObj
} from './constants.ts';
import { createMergedGeometry } from './geometry.ts';
import { createMaterials } from './materials.ts';

export class MushroomBatcher {
    private static instance: MushroomBatcher;
    private initialized = false;
    private count = 0;

    // Mesh & Attributes
    public mesh: THREE.InstancedMesh | null = null;
    // OPTIMIZED: Packed into single vec4 to reduce vertex buffers from 11 to 8
    // instanceData: x=packedFlags, y=spawnTime, z=triggerTime, w=velocity
    // packedFlags encoding: noteIndex+1 + hasFace*20 + isGiant*40
    private instanceData: THREE.InstancedBufferAttribute | null = null;

    // Matrix/color batching state (SoA → native or TS writeInstancePose)
    private _matricesDirty: boolean = false;
    private _batchPositions: Float32Array = new Float32Array(0);
    private _batchQuaternions: Float32Array = new Float32Array(0);
    private _batchScales: Float32Array = new Float32Array(0);
    private _batchColors: Float32Array = new Float32Array(0);


    // Mapping: Note Index (0-11) -> Array of Instance Indices
    private noteToInstances: Map<number, number[]> = new Map();

    // Mapping: Logic ID -> Instance Index (for removal)
    private logicIdToInstance: Map<number, number> = new Map();
    // Mapping: Instance Index -> Logic ID
    private instanceToLogicId: number[] = [];

    private constructor() {}

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

    init() {
        if (this.initialized) return;

        // 1. Create Merged Geometry
        const geometry = createMergedGeometry();

        // 2. Attributes - SINGLE packed attribute to stay within WebGPU 8 buffer limit
        this.instanceData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MUSHROOMS * 4), 4);

        // C++ / TS batching SoA buffers (#1358 writeInstancePose)
        this._batchPositions = new Float32Array(MAX_MUSHROOMS * 3);
        this._batchQuaternions = new Float32Array(MAX_MUSHROOMS * 4);
        this._batchScales = new Float32Array(MAX_MUSHROOMS * 3);
        this._batchColors = new Float32Array(MAX_MUSHROOMS * 3);

        geometry.setAttribute('instanceData', this.instanceData);

        // 3. Materials with TSL
        const materials = createMaterials();

        // 4. InstancedMesh
        this.mesh = new THREE.InstancedMesh(geometry, materials, MAX_MUSHROOMS);

        // PALETTE: Initialize instanceColor manually since we use TSL
        const colors = new Float32Array(MAX_MUSHROOMS * 3);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        this.mesh.geometry.setAttribute('instanceColor', this.mesh.instanceColor);
        initInstanceLodAttribute(this.mesh, MAX_MUSHROOMS);

        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.count = 0;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = true;

        // Add to Scene (assuming foliageGroup exists and is in scene)
        if (foliageGroup) {
            foliageGroup.add(this.mesh);
        } else {
            console.warn('[MushroomBatcher] foliageGroup not found, mushrooms might not be visible.');
        }

        this.initialized = true;
        registerFoliageBatcherLod({ id: 'mushroom', getMeshes: () => this.mesh ? [this.mesh] : [] });
        console.log('[MushroomBatcher] Initialized with capacity ' + MAX_MUSHROOMS);
    }

    getLODMeshes(): THREE.InstancedMesh[] {
        return this.mesh ? [this.mesh] : [];
    }

    private flushMatrices() {
        if (!this._matricesDirty || !this.mesh || this.count === 0) return;

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
        this._matricesDirty = false;
    }
    register(dummy: THREE.Object3D, options: any) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_MUSHROOMS) return;

        const i = this.count;
        this.count++;

        // ⚡ OPTIMIZATION: Mark as batched
        dummy.userData.isBatched = true;

        // Track ID for removal
        this.logicIdToInstance.set(dummy.id, i);
        this.instanceToLogicId[i] = dummy.id;

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

        this._matricesDirty = true;
        this.flushMatrices();

        // 2. Set Attributes - Packed into single vec4
        // packedFlags: noteIndex+1 + hasFace*20 + isGiant*40
        const hasFace = options.hasFace ? 1.0 : 0.0;
        const noteIndex = options.noteIndex !== undefined ? options.noteIndex : -1;
        const isGiant = options.size === 'giant' ? 1.0 : 0.0;
        const spawnTime = options.spawnTime || -100.0;
        const packedFlags = (noteIndex + 1) + hasFace * 20 + isGiant * 40;

        // instanceData: x=packedFlags, y=spawnTime, z=triggerTime, w=velocity
        // ⚡ OPTIMIZATION: Bypassed THREE.BufferAttribute.setXYZW overhead by writing directly to typed array
        const instanceDataArray = this.instanceData!.array as Float32Array;
        const i4 = i * 4;
        instanceDataArray[i4] = packedFlags;
        instanceDataArray[i4 + 1] = spawnTime;
        instanceDataArray[i4 + 2] = -100.0;
        instanceDataArray[i4 + 3] = 0;

        // 3. Update Mapping
        if (noteIndex >= 0) {
            if (!this.noteToInstances.has(noteIndex)) {
                this.noteToInstances.set(noteIndex, []);
            }
            this.noteToInstances.get(noteIndex)!.push(i);
        }

        if (!shouldUseFoliageGpuBatch(this.count)) {
            this.mesh!.instanceMatrix.needsUpdate = true;
            if (this.mesh!.instanceColor) this.mesh!.instanceColor.needsUpdate = true;
        }
        this.instanceData!.needsUpdate = true;
    }

    removeInstance(logicObject: THREE.Object3D) {
        if (!this.initialized || !logicObject) return;

        const id = logicObject.id;
        if (!this.logicIdToInstance.has(id)) return;

        const indexToRemove = this.logicIdToInstance.get(id)!;
        const lastIndex = this.count - 1;

        // 1. Remove from Note Mapping
        // Decode noteIndex from packedFlags: noteIndex = (packed % 20) - 1
        const instanceDataArray = this.instanceData!.array as Float32Array;
        const removedPackedFlags = instanceDataArray[indexToRemove * 4];
        const removedNoteIndex = (removedPackedFlags % 20) - 1;
        if (removedNoteIndex >= 0) {
            const list = this.noteToInstances.get(removedNoteIndex);
            if (list) {
                const idx = list.indexOf(indexToRemove);
                if (idx > -1) list.splice(idx, 1);
            }
        }

        // 2. Perform Swap (if not last)
        if (indexToRemove !== lastIndex) {
            const lastId = this.instanceToLogicId[lastIndex];
            // Decode noteIndex from packedFlags
            const lastPackedFlags = instanceDataArray[lastIndex * 4];
            const movedNoteIndex = (lastPackedFlags % 20) - 1;

            // A. Copy Attributes from Last to Removed
            // Matrix & Color (SoA updates)
            for (let k = 0; k < 3; k++) {
                this._batchPositions[indexToRemove * 3 + k] = this._batchPositions[lastIndex * 3 + k];
                this._batchScales[indexToRemove * 3 + k] = this._batchScales[lastIndex * 3 + k];
                this._batchColors[indexToRemove * 3 + k] = this._batchColors[lastIndex * 3 + k];
            }
            for (let k = 0; k < 4; k++) {
                this._batchQuaternions[indexToRemove * 4 + k] = this._batchQuaternions[lastIndex * 4 + k];
            }
            this._matricesDirty = true;
            this.flushMatrices();

            // Single packed attribute
            // ⚡ OPTIMIZATION: Bypassed setXYZW overhead
            const iRem4 = indexToRemove * 4;
            const iLast4 = lastIndex * 4;
            instanceDataArray[iRem4] = instanceDataArray[iLast4];
            instanceDataArray[iRem4 + 1] = instanceDataArray[iLast4 + 1];
            instanceDataArray[iRem4 + 2] = instanceDataArray[iLast4 + 2];
            instanceDataArray[iRem4 + 3] = instanceDataArray[iLast4 + 3];

            // B. Update Note Mapping for the MOVED instance
            if (movedNoteIndex >= 0) {
                const list = this.noteToInstances.get(movedNoteIndex);
                if (list) {
                    const idx = list.indexOf(lastIndex);
                    if (idx > -1) list[idx] = indexToRemove;
                }
            }

            // C. Update ID Maps
            this.logicIdToInstance.set(lastId, indexToRemove);
            this.instanceToLogicId[indexToRemove] = lastId;
        }

        // 3. Cleanup
        this.logicIdToInstance.delete(id);
        this.instanceToLogicId[lastIndex] = -1;
        this.count--;

        // 4. Mark Updates
        this.mesh!.count = this.count;
        if (!shouldUseFoliageGpuBatch(this.count)) {
            this.mesh!.instanceMatrix.needsUpdate = true;
            if (this.mesh!.instanceColor) this.mesh!.instanceColor.needsUpdate = true;
        }
        this.instanceData!.needsUpdate = true;
    }

    handleNote(noteIndex: number, velocity: number) {
        if (!this.initialized) return;

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
                if (this.mesh) {
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
