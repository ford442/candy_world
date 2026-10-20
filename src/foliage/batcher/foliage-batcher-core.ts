// src/foliage/batcher/foliage-batcher-core.ts
// OPTIMIZATION: WASM batch processing for foliage animations
// Migrated 10 additional animation types from JS to WASM (Phase 1)

import * as THREE from 'three';
import {
    submitFoliageGpuScalarBatch,
    takeFoliageGpuScalarResult,
    shouldUseFoliageGpuBatch,
} from '../../compute/foliage-gpu-batch.ts';
import type { FoliageGpuBatchMode } from '../../compute/foliage-gpu-batch.ts';
import { FoliageEcsBridge, type SimpleAnimType } from '../../systems/ecs/foliage-ecs-bridge.ts';
import { asFree, asMalloc } from '../../utils/native-memory.ts';
import { getWasmInstance } from '../../utils/wasm-loader.ts';
import {
    getVibratoAmount,
    getTremoloAmount,
    getHighFreqAmount,
    getAverageVolume,
    getPanActivity,
} from './foliage-batcher-audio.ts';
import {
    applySnareSnap,
    applyAccordion,
    applyFiberWhip,
    applySpiralWave,
    applyVibratoShake,
    applyTremoloPulse,
    applyCymbalShake,
    applyPanningBob,
    applySpiritFade,
} from './foliage-batcher-effects.ts';
import {
    BATCH_SIZE,
    BATCH_ARRAY_SIZE,
    ENTRY_STRIDE,
    ENTRY_SIZE,
    RESULT_STRIDE,
    BatchState,
    ExtendedBatchState,
    FoliageObject,
} from './foliage-batcher-types.ts';

export class FoliageBatcher {
    private static instance: FoliageBatcher;
    private initialized = false;
    private extendedInitialized = false;

    // Batches for each supported type
    private batches: {
        sway: BatchState;
        bounce: BatchState;
        hop: BatchState;
        gentleSway: BatchState;
        wobble: BatchState;
    };

    // Extended batches for migrated animation types (Phase 1)
    private extendedBatches: {
        snareSnap: ExtendedBatchState;
        accordion: ExtendedBatchState;
        fiberWhip: ExtendedBatchState;
        spiralWave: ExtendedBatchState;
        vibratoShake: ExtendedBatchState;
        tremoloPulse: ExtendedBatchState;
        cymbalShake: ExtendedBatchState;
        panningBob: ExtendedBatchState;
        spiritFade: ExtendedBatchState;
    };

    // Simple animation batches (Agent 1 migration)
    private simpleBatches: {
        shiver: ExtendedBatchState;
        spring: ExtendedBatchState;
        float: ExtendedBatchState;
        cloudBob: ExtendedBatchState;
    };

    private simpleBatchesInitialized = false;
    // Set when malloc failed, so the queue falls back to JS without retrying every call.
    private extendedUnavailable = false;
    private simpleBatchesUnavailable = false;

    // OPTIMIZATION: Cached Float32Array view to prevent GC spikes in hot loops
    private cachedMemoryView: Float32Array | null = null;

    private getMemoryView(instance: any): Float32Array {
        const memory = instance.exports.memory;
        const buffer = memory.buffer || memory;
        if (!this.cachedMemoryView || this.cachedMemoryView.buffer !== buffer) {
            this.cachedMemoryView = new Float32Array(buffer);
        }
        return this.cachedMemoryView;
    }

    private constructor() {
        this.batches = {
            sway: this.createBatch(),
            bounce: this.createBatch(true), // needs originalY
            hop: this.createBatch(true),
            gentleSway: this.createBatch(),
            wobble: this.createBatch(false, true, true), // needs wobbleBoosts, 2 outputs
        };

        // Create extended batches for new animation types
        this.extendedBatches = {
            snareSnap: this.createExtendedBatch(),
            accordion: this.createExtendedBatch(),
            fiberWhip: this.createExtendedBatch(),
            spiralWave: this.createExtendedBatch(),
            vibratoShake: this.createExtendedBatch(),
            tremoloPulse: this.createExtendedBatch(),
            cymbalShake: this.createExtendedBatch(),
            panningBob: this.createExtendedBatch(),
            spiritFade: this.createExtendedBatch(),
        };

        this.simpleBatches = {
            shiver: this.createExtendedBatch(),
            spring: this.createExtendedBatch(),
            float: this.createExtendedBatch(),
            cloudBob: this.createExtendedBatch(),
        };
    }

    static getInstance(): FoliageBatcher {
        if (!FoliageBatcher.instance) {
            FoliageBatcher.instance = new FoliageBatcher();
        }
        return FoliageBatcher.instance;
    }

    private createBatch(
        needsOriginalY = false,
        needsWobble = false,
        twoOutputs = false
    ): BatchState {
        // WASM memory is malloc'd lazily in initBatchMemory
        return {
            count: 0,
            offsets: new Float32Array(BATCH_SIZE),
            intensities: new Float32Array(BATCH_SIZE),
            originalYs: needsOriginalY ? new Float32Array(BATCH_SIZE) : undefined,
            wobbleBoosts: needsWobble ? new Float32Array(BATCH_SIZE) : undefined,
            outScalars: new Float32Array(BATCH_SIZE),
            outScalars2: twoOutputs ? new Float32Array(BATCH_SIZE) : undefined,
            objects: new Array(BATCH_SIZE),
            ptrOffsets: 0,
            ptrIntensities: 0,
            ptrOriginalYs: 0,
            ptrWobbleBoosts: 0,
            ptrOutScalars: 0,
            ptrOutScalars2: 0,
        };
    }

    private createExtendedBatch(): ExtendedBatchState {
        return {
            count: 0,
            input: new Float32Array(BATCH_SIZE * ENTRY_STRIDE),
            output: new Float32Array(BATCH_SIZE * RESULT_STRIDE),
            objects: new Array(BATCH_SIZE),
            ptrInput: 0,
            ptrOutput: 0,
        };
    }

    /**
     * Give a batch its own block in AS memory (assembly/allocator.ts malloc).
     * Returns false, leaving every pointer 0, when the allocator is unavailable.
     */
    private initBatchMemory(batch: BatchState): boolean {
        if (batch.ptrOffsets !== 0) return true; // Already initialized

        const arrays =
            3 +
            (batch.originalYs ? 1 : 0) +
            (batch.wobbleBoosts ? 1 : 0) +
            (batch.outScalars2 ? 1 : 0);
        let currentOffset = asMalloc(arrays * BATCH_ARRAY_SIZE);
        if (!currentOffset) return false;

        batch.ptrOffsets = currentOffset;
        currentOffset += BATCH_ARRAY_SIZE;

        batch.ptrIntensities = currentOffset;
        currentOffset += BATCH_ARRAY_SIZE;

        batch.ptrOutScalars = currentOffset;
        currentOffset += BATCH_ARRAY_SIZE;

        if (batch.originalYs) {
            batch.ptrOriginalYs = currentOffset;
            currentOffset += BATCH_ARRAY_SIZE;
        }

        if (batch.wobbleBoosts) {
            batch.ptrWobbleBoosts = currentOffset;
            currentOffset += BATCH_ARRAY_SIZE;
        }

        if (batch.outScalars2) {
            batch.ptrOutScalars2 = currentOffset;
            currentOffset += BATCH_ARRAY_SIZE;
        }
        return true;
    }

    private releaseBatchMemory(batch: BatchState) {
        asFree(batch.ptrOffsets);
        batch.ptrOffsets = 0;
        batch.ptrIntensities = 0;
        batch.ptrOutScalars = 0;
        batch.ptrOriginalYs = 0;
        batch.ptrWobbleBoosts = 0;
        batch.ptrOutScalars2 = 0;
    }

    private initExtendedBatchMemory(batch: ExtendedBatchState): boolean {
        if (batch.ptrInput !== 0) return true;

        const ptr = asMalloc(BATCH_SIZE * ENTRY_SIZE + BATCH_SIZE * RESULT_STRIDE * 4);
        if (!ptr) return false;

        batch.ptrInput = ptr;
        batch.ptrOutput = ptr + BATCH_SIZE * ENTRY_SIZE;
        return true;
    }

    private releaseExtendedBatchMemory(batch: ExtendedBatchState) {
        asFree(batch.ptrInput);
        batch.ptrInput = 0;
        batch.ptrOutput = 0;
    }

    /** Allocate every batch in the group, or none of them. */
    private initExtendedGroup(batches: ExtendedBatchState[]): boolean {
        if (batches.every((b) => this.initExtendedBatchMemory(b))) return true;
        batches.forEach((b) => this.releaseExtendedBatchMemory(b));
        return false;
    }

    init() {
        const instance = getWasmInstance();
        if (this.initialized || !instance) return;

        const batches = [
            this.batches.sway,
            this.batches.bounce,
            this.batches.hop,
            this.batches.gentleSway,
            this.batches.wobble,
        ];
        if (!batches.every((b) => this.initBatchMemory(b))) {
            batches.forEach((b) => this.releaseBatchMemory(b));
            console.warn('[FoliageBatcher] WASM malloc unavailable; using JS animation fallback');
            return;
        }

        this.initialized = true;
        const bytes = batches.reduce(
            (sum, b) =>
                sum +
                BATCH_ARRAY_SIZE *
                    (3 +
                        (b.originalYs ? 1 : 0) +
                        (b.wobbleBoosts ? 1 : 0) +
                        (b.outScalars2 ? 1 : 0)),
            0
        );
        console.log(`[FoliageBatcher] WASM batch memory allocated: ${bytes} bytes`);
    }

    private initExtended() {
        const instance = getWasmInstance();
        if (this.extendedInitialized || this.extendedUnavailable || !instance) return;

        if (!this.initExtendedGroup(Object.values(this.extendedBatches))) {
            this.extendedUnavailable = true;
            console.warn('[FoliageBatcher] Extended WASM malloc failed; using JS fallback');
            return;
        }

        this.extendedInitialized = true;
        console.log('[FoliageBatcher] Extended WASM memory allocated for new animation types');
    }

    private initSimpleBatches() {
        const instance = getWasmInstance();
        if (this.simpleBatchesInitialized || this.simpleBatchesUnavailable || !instance) return;

        if (!this.initExtendedGroup(Object.values(this.simpleBatches))) {
            this.simpleBatchesUnavailable = true;
            console.warn('[FoliageBatcher] Simple-batch WASM malloc failed; using JS fallback');
            return;
        }

        this.simpleBatchesInitialized = true;
    }

    queue(
        obj: FoliageObject,
        type: string,
        intensity: number,
        time: number,
        kick: number = 0
    ): boolean {
        // Return true if handled, false if caller should use fallback
        if (!this.initialized) this.init();
        if (!this.initialized) return false;

        let batch: BatchState | undefined;

        if (type === 'sway') batch = this.batches.sway;
        else if (type === 'bounce') batch = this.batches.bounce;
        else if (type === 'hop') batch = this.batches.hop;
        else if (type === 'gentleSway') batch = this.batches.gentleSway;
        else if (type === 'wobble') batch = this.batches.wobble;

        if (batch) {
            if (batch.count >= BATCH_SIZE) return false;

            const i = batch.count;
            batch.objects[i] = obj;
            batch.offsets[i] = obj.userData.animationOffset || 0;
            batch.intensities[i] = intensity;

            if (batch.originalYs) {
                // Init originalY if missing
                if (obj.userData.originalY === undefined) obj.userData.originalY = obj.position.y;
                batch.originalYs[i] = obj.userData.originalY;
            }

            if (batch.wobbleBoosts) {
                batch.wobbleBoosts[i] = obj.userData.wobbleCurrent || 0;
            }

            batch.count++;
            return true;
        }

        // Try simple animation batch types (Agent 1 migration)
        if (type === 'shiver') {
            return this.queueSimpleBatch(obj, 'shiver', intensity, time);
        }
        if (type === 'spring') {
            return this.queueSimpleBatch(obj, 'spring', intensity, time);
        }
        if (type === 'float') {
            return this.queueSimpleBatch(obj, 'float', intensity, time);
        }
        if (type === 'cloudBob') {
            return this.queueSimpleBatch(obj, 'cloudBob', intensity, time);
        }

        // Try extended batches for new animation types
        return this.queueExtended(obj, type, intensity, time, kick);
    }

    private queueSimpleBatch(
        obj: FoliageObject,
        type: 'shiver' | 'spring' | 'float' | 'cloudBob',
        intensity: number,
        time: number
    ): boolean {
        // If the ECS bridge is active it owns the entity; skip legacy queue path.
        const bridge = FoliageEcsBridge.getInstance();
        if (bridge.isReady()) {
            // Register each object once (no-op for subsequent frames — bridge tracks entities).
            if (obj.userData._ecsBridgeId === undefined) {
                obj.userData._ecsBridgeId = bridge.registerEntity(obj, type);
            }
            return true;
        }

        this.initSimpleBatches();
        if (!this.simpleBatchesInitialized) return false;

        const batch = this.simpleBatches[type];
        if (batch.count >= BATCH_SIZE) return false;

        const i = batch.count;
        const entryOffset = i * ENTRY_STRIDE;

        batch.objects[i] = obj;
        batch.input[entryOffset] = obj.userData.animationOffset || 0; // offset
        batch.input[entryOffset + 1] = intensity;

        if (type === 'float' || type === 'cloudBob') {
            if (obj.userData.originalY === undefined) obj.userData.originalY = obj.position.y;
            batch.input[entryOffset + 2] = obj.userData.originalY;
        }

        batch.count++;
        return true;
    }

    private queueExtended(
        obj: FoliageObject,
        type: string,
        intensity: number,
        time: number,
        kick: number
    ): boolean {
        if (!this.extendedInitialized) this.initExtended();
        if (!this.extendedInitialized) return false;

        let batch: ExtendedBatchState | undefined;
        let animTypeCode = 0;

        switch (type) {
            case 'snareSnap':
                batch = this.extendedBatches.snareSnap;
                animTypeCode = 13;
                break;
            case 'accordion':
            case 'accordionStretch':
                batch = this.extendedBatches.accordion;
                animTypeCode = 14;
                break;
            case 'fiberWhip':
                batch = this.extendedBatches.fiberWhip;
                animTypeCode = 15;
                break;
            case 'spiralWave':
                batch = this.extendedBatches.spiralWave;
                animTypeCode = 16;
                break;
            case 'vibratoShake':
                batch = this.extendedBatches.vibratoShake;
                animTypeCode = 17;
                break;
            case 'tremoloPulse':
                batch = this.extendedBatches.tremoloPulse;
                animTypeCode = 18;
                break;
            case 'cymbalShake':
                batch = this.extendedBatches.cymbalShake;
                animTypeCode = 19;
                break;
            case 'panningBob':
                batch = this.extendedBatches.panningBob;
                animTypeCode = 20;
                break;
            case 'spiritFade':
                batch = this.extendedBatches.spiritFade;
                animTypeCode = 21;
                break;
        }

        if (!batch || batch.count >= BATCH_SIZE) return false;

        const i = batch.count;
        const entryOffset = i * ENTRY_STRIDE;

        batch.objects[i] = obj;

        // Fill entry data based on animation type
        batch.input[entryOffset] = obj.userData.animationOffset || 0; // offset
        batch.input[entryOffset + 1] = intensity; // intensity

        // Type-specific parameter setup
        switch (animTypeCode) {
            case 13: // snareSnap
                if (obj.userData.originalY === undefined) obj.userData.originalY = obj.position.y;
                batch.input[entryOffset + 2] = obj.userData.originalY;
                batch.input[entryOffset + 4] = obj.userData.snapState || 0; // persist state
                break;
            case 14: // accordion
                batch.input[entryOffset + 2] = 0; // originalY unused
                break;
            case 15: // fiberWhip
                batch.input[entryOffset + 4] = obj.userData.branchIndex || 0;
                break;
            case 19: // cymbalShake
                batch.input[entryOffset + 4] = obj.userData.rotZ || 0; // persist rotZ
                batch.input[entryOffset + 5] = obj.userData.rotX || 0; // persist rotX
                break;
            case 20: // panningBob
                if (obj.userData.originalY === undefined) obj.userData.originalY = obj.position.y;
                batch.input[entryOffset + 2] = obj.userData.originalY;
                batch.input[entryOffset + 4] = obj.userData.panBias || 0;
                batch.input[entryOffset + 5] = obj.userData.currentBob || 0;
                break;
            case 21: // spiritFade
                if (obj.userData.originalY === undefined) obj.userData.originalY = obj.position.y;
                batch.input[entryOffset + 2] = obj.userData.originalY;
                batch.input[entryOffset + 4] = obj.userData.currentOpacity || 0;
                batch.input[entryOffset + 5] = obj.userData.fleeSpeed || 0;
                break;
            default:
                if (obj.userData.originalY === undefined) obj.userData.originalY = obj.position.y;
                batch.input[entryOffset + 2] = obj.userData.originalY;
        }

        batch.count++;
        return true;
    }

    flush(time: number, kick: number, audioData: any = null) {
        if (!this.initialized) return;

        // Process Sway
        this.processSimpleBatch(this.batches.sway, 'computeSway', time, (obj, val) => {
            obj.rotation.z = val;
        });

        // Process Gentle Sway
        this.processSimpleBatch(this.batches.gentleSway, 'computeGentleSway', time, (obj, val) => {
            obj.rotation.z = val;
        });

        // Process Bounce
        this.processPhysicsBatch(this.batches.bounce, 'computeBounce', time, kick, (obj, val) => {
            obj.position.y = val;
        });

        // Process Hop
        this.processPhysicsBatch(this.batches.hop, 'computeHop', time, kick, (obj, val) => {
            obj.position.y = val;
        });

        // Process Wobble
        this.processWobbleBatch(this.batches.wobble, time);

        // Process extended batches
        this.flushExtended(time, kick, audioData);

        // Process simple animation batches (Agent 1 migration)
        // Use audio intensity from audioData if available
        const audioIntensity = audioData?.intensity || kick || 0.5;
        this.flushSimpleBatches(time, audioIntensity);
    }

    private processSimpleBatch(
        batch: BatchState,
        funcName: string,
        time: number,
        apply: (o: FoliageObject, v: number) => void
    ) {
        if (batch.count === 0) return;

        const count = batch.count;
        const gpuMode = this.funcNameToGpuMode(funcName);
        const batchKey = `foliage-${funcName}`;

        if (gpuMode && shouldUseFoliageGpuBatch(count)) {
            const gpuScalars = takeFoliageGpuScalarResult(batchKey);
            if (gpuScalars && gpuScalars.length >= count) {
                for (let i = 0; i < count; i++) {
                    apply(batch.objects[i], gpuScalars[i]);
                    batch.objects[i] = undefined as any;
                }
                submitFoliageGpuScalarBatch(
                    batchKey,
                    gpuMode,
                    count,
                    time,
                    0,
                    batch.offsets.subarray(0, count),
                    batch.intensities.subarray(0, count),
                    batch.originalYs?.subarray(0, count) ?? batch.offsets.subarray(0, count)
                );
                batch.count = 0;
                return;
            }
        }

        const instance = getWasmInstance();
        if (!instance) return;

        // OPTIMIZATION: Cached Float32Array view to prevent GC spikes in hot loops
        const F32 = this.getMemoryView(instance);

        const offPtr = batch.ptrOffsets >>> 2;
        const intPtr = batch.ptrIntensities >>> 2;

        let validCount = batch.count;
        if (offPtr + validCount > F32.length) validCount = Math.max(0, F32.length - offPtr);
        if (intPtr + validCount > F32.length) validCount = Math.max(0, F32.length - intPtr);
        if (validCount > 0) {
            F32.set(batch.offsets.subarray(0, validCount), offPtr);
            F32.set(batch.intensities.subarray(0, validCount), intPtr);
        }

        const func = (instance.exports as any)[funcName];
        if (func) {
            func(batch.count, time, batch.ptrOffsets, batch.ptrIntensities, batch.ptrOutScalars);

            const outPtr = batch.ptrOutScalars >>> 2;
            const res = this.getMemoryView(instance).subarray(outPtr, outPtr + batch.count);

            for (let i = 0; i < batch.count; i++) {
                apply(batch.objects[i], res[i]);
                batch.objects[i] = undefined as any;
            }
        }

        if (gpuMode && shouldUseFoliageGpuBatch(count)) {
            submitFoliageGpuScalarBatch(
                batchKey,
                gpuMode,
                count,
                time,
                0,
                batch.offsets.subarray(0, count),
                batch.intensities.subarray(0, count),
                batch.originalYs?.subarray(0, count) ?? batch.offsets.subarray(0, count)
            );
        }

        batch.count = 0;
    }

    private funcNameToGpuMode(funcName: string): FoliageGpuBatchMode | null {
        switch (funcName) {
            case 'computeSway':
                return 'sway';
            case 'computeGentleSway':
                return 'gentleSway';
            case 'computeBounce':
                return 'bounce';
            case 'computeHop':
                return 'hop';
            default:
                return null;
        }
    }

    private processPhysicsBatch(
        batch: BatchState,
        funcName: string,
        time: number,
        kick: number,
        apply: (o: FoliageObject, v: number) => void
    ) {
        if (batch.count === 0) return;

        const count = batch.count;
        const gpuMode = this.funcNameToGpuMode(funcName);
        const batchKey = `foliage-${funcName}`;

        if (gpuMode && shouldUseFoliageGpuBatch(count) && batch.originalYs) {
            const gpuScalars = takeFoliageGpuScalarResult(batchKey);
            if (gpuScalars && gpuScalars.length >= count) {
                for (let i = 0; i < count; i++) {
                    apply(batch.objects[i], gpuScalars[i]);
                    batch.objects[i] = undefined as any;
                }
                submitFoliageGpuScalarBatch(
                    batchKey,
                    gpuMode,
                    count,
                    time,
                    kick,
                    batch.offsets.subarray(0, count),
                    batch.intensities.subarray(0, count),
                    batch.originalYs.subarray(0, count)
                );
                batch.count = 0;
                return;
            }
        }

        const instance = getWasmInstance();
        if (!instance) return;

        // OPTIMIZATION: Cached Float32Array view to prevent GC spikes in hot loops
        const F32 = this.getMemoryView(instance);

        const offPtr = batch.ptrOffsets >>> 2;
        const intPtr = batch.ptrIntensities >>> 2;
        const orgPtr = batch.ptrOriginalYs! >>> 2;

        let validCount = batch.count;
        if (offPtr + validCount > F32.length) validCount = Math.max(0, F32.length - offPtr);
        if (intPtr + validCount > F32.length) validCount = Math.max(0, F32.length - intPtr);
        if (validCount > 0) {
            F32.set(batch.offsets.subarray(0, validCount), offPtr);
            F32.set(batch.intensities.subarray(0, validCount), intPtr);
        }
        F32.set(batch.originalYs!.subarray(0, batch.count), orgPtr);

        const func = (instance.exports as any)[funcName];
        if (func) {
            func(
                batch.count,
                time,
                batch.ptrOriginalYs,
                batch.ptrOffsets,
                batch.ptrIntensities,
                kick,
                batch.ptrOutScalars
            );

            const outPtr = batch.ptrOutScalars >>> 2;
            const res = this.getMemoryView(instance).subarray(outPtr, outPtr + batch.count);

            for (let i = 0; i < batch.count; i++) {
                apply(batch.objects[i], res[i]);
                batch.objects[i] = undefined as any;
            }
        }

        if (gpuMode && shouldUseFoliageGpuBatch(count) && batch.originalYs) {
            submitFoliageGpuScalarBatch(
                batchKey,
                gpuMode,
                count,
                time,
                kick,
                batch.offsets.subarray(0, count),
                batch.intensities.subarray(0, count),
                batch.originalYs.subarray(0, count)
            );
        }

        batch.count = 0;
    }

    private processWobbleBatch(batch: BatchState, time: number) {
        if (batch.count === 0) return;

        const instance = getWasmInstance();
        if (!instance) return;

        // OPTIMIZATION: Cached Float32Array view to prevent GC spikes in hot loops
        const F32 = this.getMemoryView(instance);

        const offPtr = batch.ptrOffsets >>> 2;
        const intPtr = batch.ptrIntensities >>> 2;
        const boostPtr = batch.ptrWobbleBoosts! >>> 2;

        let validCount = batch.count;
        if (offPtr + validCount > F32.length) validCount = Math.max(0, F32.length - offPtr);
        if (intPtr + validCount > F32.length) validCount = Math.max(0, F32.length - intPtr);
        if (validCount > 0) {
            F32.set(batch.offsets.subarray(0, validCount), offPtr);
            F32.set(batch.intensities.subarray(0, validCount), intPtr);
        }
        F32.set(batch.wobbleBoosts!.subarray(0, batch.count), boostPtr);

        const func = (instance.exports as any)['computeWobble'];
        if (func) {
            func(
                batch.count,
                time,
                batch.ptrOffsets,
                batch.ptrIntensities,
                batch.ptrWobbleBoosts,
                batch.ptrOutScalars,
                batch.ptrOutScalars2
            );

            const outPtr1 = batch.ptrOutScalars >>> 2;
            const outPtr2 = batch.ptrOutScalars2! >>> 2;
            const out = this.getMemoryView(instance);

            for (let i = 0; i < batch.count; i++) {
                const obj = batch.objects[i];
                obj.rotation.x = out[outPtr1 + i];
                obj.rotation.z = out[outPtr2 + i];
                // Decay wobble state
                if (obj.userData.wobbleCurrent) {
                    obj.userData.wobbleCurrent *= 0.9;
                }
                batch.objects[i] = undefined as any;
            }
        }
        batch.count = 0;
    }

    private processExtendedBatch(
        batch: ExtendedBatchState,
        animType: number,
        time: number,
        kick: number,
        groove: number,
        audioParam: number,
        apply: (obj: FoliageObject, data: Float32Array, offset: number) => void
    ) {
        if (batch.count === 0) return;

        const instance = getWasmInstance();
        if (!instance) return;

        // OPTIMIZATION: Cached Float32Array view to prevent GC spikes in hot loops
        const F32 = this.getMemoryView(instance);

        // Copy input data to WASM memory
        const inPtr = batch.ptrInput >>> 2;
        let countToCopy = batch.count * ENTRY_STRIDE;
        if (inPtr + countToCopy > F32.length) {
            countToCopy = F32.length - inPtr;
        }
        if (countToCopy > 0) {
            F32.set(batch.input.subarray(0, countToCopy), inPtr);
        }

        // Call the universal batch processor (C++ or AssemblyScript)
        const func =
            (instance.exports as any)['processBatchUniversal_c'] ||
            (instance.exports as any)['processBatchUniversal'];

        if (func) {
            func(
                animType,
                batch.ptrInput,
                batch.count,
                time,
                0, // beatPhase
                kick,
                groove,
                audioParam,
                batch.ptrOutput
            );

            // Read results
            const outPtr = batch.ptrOutput >>> 2;
            const results = this.getMemoryView(instance).subarray(
                outPtr,
                outPtr + batch.count * RESULT_STRIDE
            );

            // Apply results to objects
            // OPTIMIZATION: Removed 'results.subarray' allocation in loop
            for (let i = 0; i < batch.count; i++) {
                const obj = batch.objects[i];
                const outOffset = i * RESULT_STRIDE;
                apply(obj, results, outOffset);
                batch.objects[i] = undefined as any;
            }
        }

        batch.count = 0;
    }

    private flushExtended(time: number, kick: number, audioData: any) {
        if (!this.extendedInitialized) return;

        const instance = getWasmInstance();
        if (!instance) return;

        // Extract audio parameters
        const groove = audioData?.grooveAmount || 0;
        const snareTrigger = audioData?.channelData?.[1]?.trigger || 0;
        const leadVol = audioData?.channelData?.[2]?.volume || 0;
        const vibrato = getVibratoAmount(audioData);
        const tremolo = getTremoloAmount(audioData);
        const highFreq = getHighFreqAmount(audioData);
        const volume = getAverageVolume(audioData);

        // Process snare snap
        this.processExtendedBatch(
            this.extendedBatches.snareSnap,
            13,
            time,
            kick,
            groove,
            snareTrigger,
            applySnareSnap
        );

        // Process accordion
        this.processExtendedBatch(
            this.extendedBatches.accordion,
            14,
            time,
            kick,
            groove,
            0,
            applyAccordion
        );

        // Process fiber whip
        this.processExtendedBatch(
            this.extendedBatches.fiberWhip,
            15,
            time,
            kick,
            groove,
            leadVol,
            applyFiberWhip
        );

        // Process spiral wave
        this.processExtendedBatch(
            this.extendedBatches.spiralWave,
            16,
            time,
            kick,
            groove,
            0,
            applySpiralWave
        );

        // Process vibrato shake
        this.processExtendedBatch(
            this.extendedBatches.vibratoShake,
            17,
            time,
            kick,
            groove,
            vibrato,
            applyVibratoShake
        );

        // Process tremolo pulse
        this.processExtendedBatch(
            this.extendedBatches.tremoloPulse,
            18,
            time,
            kick,
            groove,
            tremolo,
            applyTremoloPulse
        );

        // Process cymbal shake
        this.processExtendedBatch(
            this.extendedBatches.cymbalShake,
            19,
            time,
            kick,
            groove,
            highFreq,
            applyCymbalShake
        );

        // Process panning bob
        this.processExtendedBatch(
            this.extendedBatches.panningBob,
            20,
            time,
            kick,
            groove,
            getPanActivity(audioData),
            applyPanningBob
        );

        // Process spirit fade
        this.processExtendedBatch(
            this.extendedBatches.spiritFade,
            21,
            time,
            kick,
            groove,
            volume,
            applySpiritFade
        );
    }

    private flushSimpleBatches(time: number, intensity: number) {
        // Fast path: C++ ECS handles entity query + batch animate in one shot.
        const bridge = FoliageEcsBridge.getInstance();
        if (bridge.isReady()) {
            const types: SimpleAnimType[] = ['shiver', 'spring', 'float', 'cloudBob'];
            for (const t of types) bridge.runBatch(t, time, intensity);
            return;
        }

        if (!this.simpleBatchesInitialized) return;

        const instance = getWasmInstance();
        if (!instance) return;

        const func =
            (instance.exports as any)['processBatchUniversal_c'] ||
            (instance.exports as any)['processBatchUniversal'];
        if (!func) return;

        // Animation type codes for simple batches (22-25)
        const batchConfigs: {
            type: 'shiver' | 'spring' | 'float' | 'cloudBob';
            code: number;
            apply: (obj: FoliageObject, data: Float32Array, offset: number) => void;
        }[] = [
            {
                type: 'shiver',
                code: 22,
                apply: (obj, data, offset) => {
                    obj.rotation.z = data[offset]; // rotZ
                    obj.rotation.x = data[offset + 1]; // rotX
                },
            },
            {
                type: 'spring',
                code: 23,
                apply: (obj, data, offset) => {
                    obj.scale.y = data[offset]; // scaleY
                    obj.scale.x = data[offset + 1]; // scaleX
                    obj.scale.z = data[offset + 2]; // scaleZ
                },
            },
            {
                type: 'float',
                code: 24,
                apply: (obj, data, offset) => {
                    obj.position.y = data[offset]; // posY
                },
            },
            {
                type: 'cloudBob',
                code: 25,
                apply: (obj, data, offset) => {
                    obj.position.y = data[offset]; // posY
                    obj.rotation.y = data[offset + 1]; // rotY
                },
            },
        ];

        // OPTIMIZATION: Cached Float32Array view to prevent GC spikes in hot loops
        const F32 = this.getMemoryView(instance);

        for (const config of batchConfigs) {
            const batch = this.simpleBatches[config.type];
            if (batch.count === 0) continue;

            // Copy input data
            const inPtr = batch.ptrInput >>> 2;
            let countToCopy = batch.count * ENTRY_STRIDE;
            if (inPtr + countToCopy > F32.length) {
                countToCopy = F32.length - inPtr;
            }
            if (countToCopy > 0) {
                F32.set(batch.input.subarray(0, countToCopy), inPtr);
            }

            // Call native function
            const nativeFunc = (instance.exports as any)[
                `batch${config.type.charAt(0).toUpperCase() + config.type.slice(1)}_c`
            ];
            if (nativeFunc) {
                nativeFunc(batch.ptrInput, batch.count, time, intensity, batch.ptrOutput);
            } else {
                // Fallback to universal processor
                func(config.code, batch.ptrInput, batch.count, time, 0, 0, 0, 0, batch.ptrOutput);
            }

            // Read results
            const outPtr = batch.ptrOutput >>> 2;
            const results = this.getMemoryView(instance).subarray(
                outPtr,
                outPtr + batch.count * RESULT_STRIDE
            );

            // Apply to objects
            for (let i = 0; i < batch.count; i++) {
                const obj = batch.objects[i];
                const offset = i * RESULT_STRIDE;
                config.apply(obj, results, offset);
                batch.objects[i] = undefined as any;
            }

            batch.count = 0;
        }
    }
}

export const foliageBatcher = FoliageBatcher.getInstance();
