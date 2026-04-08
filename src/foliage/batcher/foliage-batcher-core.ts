// src/foliage/batcher/foliage-batcher-core.ts
// OPTIMIZATION: WASM batch processing for foliage animations
// Migrated 10 additional animation types from JS to WASM (Phase 1)

import { getWasmInstance } from '../../utils/wasm-loader.js';
import * as THREE from 'three';
import {
    BATCH_SIZE,
    BATCH_MEMORY_START,
    BATCH_ARRAY_SIZE,
    EXTENDED_BATCH_START,
    ENTRY_STRIDE,
    ENTRY_SIZE,
    RESULT_STRIDE,
    BatchState,
    ExtendedBatchState,
    FoliageObject
} from './foliage-batcher-types.ts';
import {
    getVibratoAmount,
    getTremoloAmount,
    getHighFreqAmount,
    getAverageVolume,
    getPanActivity
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
    applySpiritFade
} from './foliage-batcher-effects.ts';

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
            wobble: this.createBatch(false, true, true) // needs wobbleBoosts, 2 outputs
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
            spiritFade: this.createExtendedBatch()
        };

        this.simpleBatches = {
            shiver: this.createExtendedBatch(),
            spring: this.createExtendedBatch(),
            float: this.createExtendedBatch(),
            cloudBob: this.createExtendedBatch()
        };
    }

    static getInstance(): FoliageBatcher {
        if (!FoliageBatcher.instance) {
            FoliageBatcher.instance = new FoliageBatcher();
        }
        return FoliageBatcher.instance;
    }

    private createBatch(needsOriginalY = false, needsWobble = false, twoOutputs = false): BatchState {
        // Memory will be allocated from fixed offsets in WASM linear memory
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
            ptrOutScalars2: 0
        };
    }

    private createExtendedBatch(): ExtendedBatchState {
        return {
            count: 0,
            input: new Float32Array(BATCH_SIZE * ENTRY_STRIDE),
            output: new Float32Array(BATCH_SIZE * RESULT_STRIDE),
            objects: new Array(BATCH_SIZE),
            ptrInput: 0,
            ptrOutput: 0
        };
    }

    private initBatchMemory(batch: BatchState, memoryOffset: number) {
        if (batch.ptrOffsets !== 0) return; // Already initialized

        const instance = getWasmInstance();
        if (!instance) return;

        // Use fixed memory offsets instead of dynamic allocation
        // This avoids the need for __new and __pin which aren't exported
        let currentOffset = memoryOffset;

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
    }

    private initExtendedBatchMemory(batch: ExtendedBatchState, memoryOffset: number) {
        if (batch.ptrInput !== 0) return;

        const instance = getWasmInstance();
        if (!instance) return;

        batch.ptrInput = memoryOffset;
        batch.ptrOutput = memoryOffset + (BATCH_SIZE * ENTRY_SIZE);
    }

    init() {
        const instance = getWasmInstance();
        if (this.initialized || !instance) return;

        // Allocate memory for each batch type at fixed offsets
        // Calculate offsets for each batch (5 arrays max per batch)
        let currentOffset = BATCH_MEMORY_START;

        // Sway batch (3 arrays: offsets, intensities, outScalars)
        this.initBatchMemory(this.batches.sway, currentOffset);
        currentOffset += BATCH_ARRAY_SIZE * 3;

        // Bounce batch (4 arrays: offsets, intensities, originalYs, outScalars)
        this.initBatchMemory(this.batches.bounce, currentOffset);
        currentOffset += BATCH_ARRAY_SIZE * 4;

        // Hop batch (4 arrays: offsets, intensities, originalYs, outScalars)
        this.initBatchMemory(this.batches.hop, currentOffset);
        currentOffset += BATCH_ARRAY_SIZE * 4;

        // GentleSway batch (3 arrays: offsets, intensities, outScalars)
        this.initBatchMemory(this.batches.gentleSway, currentOffset);
        currentOffset += BATCH_ARRAY_SIZE * 3;

        // Wobble batch (5 arrays: offsets, intensities, wobbleBoosts, outScalars, outScalars2)
        this.initBatchMemory(this.batches.wobble, currentOffset);
        currentOffset += BATCH_ARRAY_SIZE * 5;

        this.initialized = true;
        console.log('[FoliageBatcher] WASM memory allocated using fixed offsets for batching');
        console.log(`[FoliageBatcher] Total memory used: ${currentOffset - BATCH_MEMORY_START} bytes`);
    }

    private initExtended() {
        const instance = getWasmInstance();
        if (this.extendedInitialized || !instance) return;

        let currentOffset = EXTENDED_BATCH_START;
        const batchSize = (BATCH_SIZE * ENTRY_SIZE) + (BATCH_SIZE * RESULT_STRIDE * 4);

        // Initialize each extended batch
        this.initExtendedBatchMemory(this.extendedBatches.snareSnap, currentOffset);
        currentOffset += batchSize;

        this.initExtendedBatchMemory(this.extendedBatches.accordion, currentOffset);
        currentOffset += batchSize;

        this.initExtendedBatchMemory(this.extendedBatches.fiberWhip, currentOffset);
        currentOffset += batchSize;

        this.initExtendedBatchMemory(this.extendedBatches.spiralWave, currentOffset);
        currentOffset += batchSize;

        this.initExtendedBatchMemory(this.extendedBatches.vibratoShake, currentOffset);
        currentOffset += batchSize;

        this.initExtendedBatchMemory(this.extendedBatches.tremoloPulse, currentOffset);
        currentOffset += batchSize;

        this.initExtendedBatchMemory(this.extendedBatches.cymbalShake, currentOffset);
        currentOffset += batchSize;

        this.initExtendedBatchMemory(this.extendedBatches.panningBob, currentOffset);
        currentOffset += batchSize;

        this.initExtendedBatchMemory(this.extendedBatches.spiritFade, currentOffset);
        currentOffset += batchSize;

        this.extendedInitialized = true;
        console.log('[FoliageBatcher] Extended WASM memory allocated for new animation types');
        console.log(`[FoliageBatcher] Extended memory used: ${currentOffset - EXTENDED_BATCH_START} bytes`);
    }

    private initSimpleBatches() {
        const instance = getWasmInstance();
        if (this.simpleBatchesInitialized || !instance) return;

        let currentOffset = EXTENDED_BATCH_START + (BATCH_SIZE * (ENTRY_SIZE + RESULT_STRIDE * 4) * 9); // After existing batches
        const batchSize = (BATCH_SIZE * ENTRY_SIZE) + (BATCH_SIZE * RESULT_STRIDE * 4);

        this.initExtendedBatchMemory(this.simpleBatches.shiver, currentOffset);
        currentOffset += batchSize;
        this.initExtendedBatchMemory(this.simpleBatches.spring, currentOffset);
        currentOffset += batchSize;
        this.initExtendedBatchMemory(this.simpleBatches.float, currentOffset);
        currentOffset += batchSize;
        this.initExtendedBatchMemory(this.simpleBatches.cloudBob, currentOffset);

        this.simpleBatchesInitialized = true;
    }

    queue(obj: FoliageObject, type: string, intensity: number, time: number, kick: number = 0): boolean {
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

    private queueSimpleBatch(obj: FoliageObject, type: 'shiver' | 'spring' | 'float' | 'cloudBob', intensity: number, time: number): boolean {
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

    private queueExtended(obj: FoliageObject, type: string, intensity: number, time: number, kick: number): boolean {
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

    private processSimpleBatch(batch: BatchState, funcName: string, time: number, apply: (o: FoliageObject, v: number) => void) {
        if (batch.count === 0) return;

        const instance = getWasmInstance();
        if (!instance) return;

        // OPTIMIZATION: Cached Float32Array view to prevent GC spikes in hot loops
        const F32 = this.getMemoryView(instance);

        const offPtr = batch.ptrOffsets >>> 2;
        const intPtr = batch.ptrIntensities >>> 2;

        F32.set(batch.offsets.subarray(0, batch.count), offPtr);
        F32.set(batch.intensities.subarray(0, batch.count), intPtr);

        const func = (instance.exports as any)[funcName];
        if (func) {
            func(batch.count, time, batch.ptrOffsets, batch.ptrIntensities, batch.ptrOutScalars);

            const outPtr = batch.ptrOutScalars >>> 2;
            const res = F32.subarray(outPtr, outPtr + batch.count);

            for (let i = 0; i < batch.count; i++) {
                apply(batch.objects[i], res[i]);
                batch.objects[i] = undefined as any;
            }
        }
        batch.count = 0;
    }

    private processPhysicsBatch(batch: BatchState, funcName: string, time: number, kick: number, apply: (o: FoliageObject, v: number) => void) {
        if (batch.count === 0) return;

        const instance = getWasmInstance();
        if (!instance) return;

        // OPTIMIZATION: Cached Float32Array view to prevent GC spikes in hot loops
        const F32 = this.getMemoryView(instance);

        const offPtr = batch.ptrOffsets >>> 2;
        const intPtr = batch.ptrIntensities >>> 2;
        const orgPtr = (batch.ptrOriginalYs!) >>> 2;

        F32.set(batch.offsets.subarray(0, batch.count), offPtr);
        F32.set(batch.intensities.subarray(0, batch.count), intPtr);
        F32.set(batch.originalYs!.subarray(0, batch.count), orgPtr);

        const func = (instance.exports as any)[funcName];
        if (func) {
            func(batch.count, time, batch.ptrOriginalYs, batch.ptrOffsets, batch.ptrIntensities, kick, batch.ptrOutScalars);

            const outPtr = batch.ptrOutScalars >>> 2;
            const res = F32.subarray(outPtr, outPtr + batch.count);

            for (let i = 0; i < batch.count; i++) {
                apply(batch.objects[i], res[i]);
                batch.objects[i] = undefined as any;
            }
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
        const boostPtr = (batch.ptrWobbleBoosts!) >>> 2;

        F32.set(batch.offsets.subarray(0, batch.count), offPtr);
        F32.set(batch.intensities.subarray(0, batch.count), intPtr);
        F32.set(batch.wobbleBoosts!.subarray(0, batch.count), boostPtr);

        const func = (instance.exports as any)['computeWobble'];
        if (func) {
            func(batch.count, time, batch.ptrOffsets, batch.ptrIntensities, batch.ptrWobbleBoosts, batch.ptrOutScalars, batch.ptrOutScalars2);

            const outPtr1 = batch.ptrOutScalars >>> 2;
            const outPtr2 = (batch.ptrOutScalars2!) >>> 2;

            for (let i = 0; i < batch.count; i++) {
                const obj = batch.objects[i];
                obj.rotation.x = F32[outPtr1 + i];
                obj.rotation.z = F32[outPtr2 + i];
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
        F32.set(batch.input.subarray(0, batch.count * ENTRY_STRIDE), inPtr);

        // Call the universal batch processor (C++ or AssemblyScript)
        const func = (instance.exports as any)['processBatchUniversal_c'] || 
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
            const results = F32.subarray(outPtr, outPtr + batch.count * RESULT_STRIDE);

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
            13, time, kick, groove, snareTrigger,
            applySnareSnap
        );

        // Process accordion
        this.processExtendedBatch(
            this.extendedBatches.accordion,
            14, time, kick, groove, 0,
            applyAccordion
        );

        // Process fiber whip
        this.processExtendedBatch(
            this.extendedBatches.fiberWhip,
            15, time, kick, groove, leadVol,
            applyFiberWhip
        );

        // Process spiral wave
        this.processExtendedBatch(
            this.extendedBatches.spiralWave,
            16, time, kick, groove, 0,
            applySpiralWave
        );

        // Process vibrato shake
        this.processExtendedBatch(
            this.extendedBatches.vibratoShake,
            17, time, kick, groove, vibrato,
            applyVibratoShake
        );

        // Process tremolo pulse
        this.processExtendedBatch(
            this.extendedBatches.tremoloPulse,
            18, time, kick, groove, tremolo,
            applyTremoloPulse
        );

        // Process cymbal shake
        this.processExtendedBatch(
            this.extendedBatches.cymbalShake,
            19, time, kick, groove, highFreq,
            applyCymbalShake
        );

        // Process panning bob
        this.processExtendedBatch(
            this.extendedBatches.panningBob,
            20, time, kick, groove, getPanActivity(audioData),
            applyPanningBob
        );

        // Process spirit fade
        this.processExtendedBatch(
            this.extendedBatches.spiritFade,
            21, time, kick, groove, volume,
            applySpiritFade
        );
    }

    private flushSimpleBatches(time: number, intensity: number) {
        if (!this.simpleBatchesInitialized) return;

        const instance = getWasmInstance();
        if (!instance) return;

        const func = (instance.exports as any)['processBatchUniversal_c'] || 
                     (instance.exports as any)['processBatchUniversal'];
        if (!func) return;

        // Animation type codes for simple batches (22-25)
        const batchConfigs: { type: 'shiver' | 'spring' | 'float' | 'cloudBob', code: number, apply: (obj: FoliageObject, data: Float32Array, offset: number) => void }[] = [
            {
                type: 'shiver',
                code: 22,
                apply: (obj, data, offset) => {
                    obj.rotation.z = data[offset];      // rotZ
                    obj.rotation.x = data[offset + 1];  // rotX
                }
            },
            {
                type: 'spring',
                code: 23,
                apply: (obj, data, offset) => {
                    obj.scale.y = data[offset];      // scaleY
                    obj.scale.x = data[offset + 1];  // scaleX
                    obj.scale.z = data[offset + 2];  // scaleZ
                }
            },
            {
                type: 'float',
                code: 24,
                apply: (obj, data, offset) => {
                    obj.position.y = data[offset];  // posY
                }
            },
            {
                type: 'cloudBob',
                code: 25,
                apply: (obj, data, offset) => {
                    obj.position.y = data[offset];   // posY
                    obj.rotation.y = data[offset + 1]; // rotY
                }
            }
        ];

        // OPTIMIZATION: Cached Float32Array view to prevent GC spikes in hot loops
        const F32 = this.getMemoryView(instance);

        for (const config of batchConfigs) {
            const batch = this.simpleBatches[config.type];
            if (batch.count === 0) continue;

            // Copy input data
            const inPtr = batch.ptrInput >>> 2;
            F32.set(batch.input.subarray(0, batch.count * ENTRY_STRIDE), inPtr);

            // Call native function
            const nativeFunc = (instance.exports as any)[`batch${config.type.charAt(0).toUpperCase() + config.type.slice(1)}_c`];
            if (nativeFunc) {
                nativeFunc(batch.ptrInput, batch.count, time, intensity, batch.ptrOutput);
            } else {
                // Fallback to universal processor
                func(config.code, batch.ptrInput, batch.count, time, 0, 0, 0, 0, batch.ptrOutput);
            }

            // Read results
            const outPtr = batch.ptrOutput >>> 2;
            const results = F32.subarray(outPtr, outPtr + batch.count * RESULT_STRIDE);

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
