// src/foliage/foliage-batcher.ts
// OPTIMIZATION: WASM batch processing for foliage animations
// Migrated 10 additional animation types from JS to WASM (Phase 1)

import { getWasmInstance } from '../utils/wasm-loader.js';
import * as THREE from 'three';
import { FoliageObject } from './types.ts';

// Batch configuration
const BATCH_SIZE = 4000; // Max objects per type per batch

// Memory layout for batch processing (in bytes)
// We allocate memory starting at 16KB boundary (after the WASM's standard memory regions)
// Standard WASM regions: POSITION_OFFSET (0), ANIMATION_OFFSET (4096), OUTPUT_OFFSET (8192), MATERIAL_DATA_OFFSET (12288)
// Starting at 16KB (16384) provides safe separation from these regions
// Each batch needs space for: offsets, intensities, originalYs, wobbleBoosts, outScalars, outScalars2
// Each array is BATCH_SIZE * 4 bytes = 16000 bytes
const BATCH_MEMORY_START = 16384; // Start at 16KB boundary for alignment
const BATCH_ARRAY_SIZE = BATCH_SIZE * 4; // Size in bytes per array (16000 bytes)

// NEW: Extended memory for additional batch types (Phase 1 Migration)
// Located after existing batch memory (ends at ~96KB, so we start at 128KB for safety)
const EXTENDED_BATCH_START = 131072; // 128KB
const ENTRY_STRIDE = 6; // offset, intensity, originalY/param0, wobbleBoost/param1, param2, param3
const ENTRY_SIZE = ENTRY_STRIDE * 4; // 24 bytes per entry
const RESULT_STRIDE = 4; // 4 floats per result
const RESULT_SIZE = RESULT_STRIDE * 4; // 16 bytes per result

interface BatchState {
    count: number;
    offsets: Float32Array;
    intensities: Float32Array;
    originalYs?: Float32Array;
    wobbleBoosts?: Float32Array;
    // NEW: Extended params for complex animations
    param1?: Float32Array; // Type-specific parameter (branch index, snap state, etc)
    param2?: Float32Array; // Type-specific parameter
    outScalars?: Float32Array; // For rotZ, etc.
    outScalars2?: Float32Array; // For rotX in wobble
    outScalars3?: Float32Array; // For additional outputs
    outScalars4?: Float32Array; // For additional outputs
    objects: FoliageObject[];
    ptrOffsets: number;
    ptrIntensities: number;
    ptrOriginalYs?: number;
    ptrWobbleBoosts?: number;
    ptrParam1?: number;
    ptrParam2?: number;
    ptrOutScalars: number;
    ptrOutScalars2?: number;
    ptrOutScalars3?: number;
    ptrOutScalars4?: number;
}

// NEW: Extended batch state with entry-based memory layout
interface ExtendedBatchState {
    count: number;
    // Input: 6 floats per object (ENTRY_STRIDE)
    input: Float32Array;
    // Output: 4 floats per object (RESULT_STRIDE)
    output: Float32Array;
    objects: FoliageObject[];
    ptrInput: number;
    ptrOutput: number;
}

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

    // NEW: Extended batches for migrated animation types (Phase 1)
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

    private constructor() {
        this.batches = {
            sway: this.createBatch(),
            bounce: this.createBatch(true), // needs originalY
            hop: this.createBatch(true),
            gentleSway: this.createBatch(),
            wobble: this.createBatch(false, true, true) // needs wobbleBoosts, 2 outputs
        };

        // NEW: Create extended batches for new animation types
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

    // NEW: Create extended batch with entry-based layout
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

    // NEW: Initialize extended batch memory
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

    // NEW: Initialize extended batches
    private initExtended() {
        const instance = getWasmInstance();
        if (this.extendedInitialized || !instance) return;

        let currentOffset = EXTENDED_BATCH_START;
        const batchSize = (BATCH_SIZE * ENTRY_SIZE) + (BATCH_SIZE * RESULT_SIZE);

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

        // NEW: Try extended batches for new animation types
        return this.queueExtended(obj, type, intensity, time, kick);
    }

    // NEW: Queue for extended animation types
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

        // NEW: Process extended batches
        this.flushExtended(time, kick, audioData);
    }

    // NEW: Flush extended batches
    private flushExtended(time: number, kick: number, audioData: any) {
        if (!this.extendedInitialized) return;

        const instance = getWasmInstance();
        if (!instance) return;

        // Extract audio parameters
        const groove = audioData?.grooveAmount || 0;
        const snareTrigger = audioData?.channelData?.[1]?.trigger || 0;
        const leadVol = audioData?.channelData?.[2]?.volume || 0;
        const vibrato = this.getVibratoAmount(audioData);
        const tremolo = this.getTremoloAmount(audioData);
        const highFreq = this.getHighFreqAmount(audioData);
        const volume = this.getAverageVolume(audioData);

        // Process snare snap
        this.processExtendedBatch(
            this.extendedBatches.snareSnap, 
            13, time, kick, groove, snareTrigger,
            (obj, out) => {
                obj.userData.snapState = out[1]; // Persist state
                // Apply to jaw rotations via userData for the animation system to read
                obj.userData.wasmSnapState = out[1];
            }
        );

        // Process accordion
        this.processExtendedBatch(
            this.extendedBatches.accordion,
            14, time, kick, groove, 0,
            (obj, out) => {
                const trunkGroup = obj.userData.trunk;
                if (trunkGroup) {
                    trunkGroup.scale.y = out[0]; // stretchY
                    trunkGroup.scale.x = out[1]; // widthXZ
                    trunkGroup.scale.z = out[1];
                }
            }
        );

        // Process fiber whip
        this.processExtendedBatch(
            this.extendedBatches.fiberWhip,
            15, time, kick, groove, leadVol,
            (obj, out) => {
                obj.rotation.y = out[0]; // baseRotY
                obj.userData.branchRotZ = out[1]; // branchRotZ (applied per-branch in JS)
            }
        );

        // Process spiral wave
        this.processExtendedBatch(
            this.extendedBatches.spiralWave,
            16, time, kick, groove, 0,
            (obj, out) => {
                obj.userData.spiralRotY = out[0];
                obj.userData.spiralYOffset = out[1];
                obj.userData.spiralScale = out[2];
            }
        );

        // Process vibrato shake
        this.processExtendedBatch(
            this.extendedBatches.vibratoShake,
            17, time, kick, groove, vibrato,
            (obj, out) => {
                const headGroup = obj.userData.headGroup;
                if (headGroup) {
                    obj.userData.vibratoRotX = out[0];
                    obj.userData.vibratoRotY = out[1];
                    obj.userData.vibratoSpeed = out[2];
                }
            }
        );

        // Process tremolo pulse
        this.processExtendedBatch(
            this.extendedBatches.tremoloPulse,
            18, time, kick, groove, tremolo,
            (obj, out) => {
                const headGroup = obj.userData.headGroup;
                if (headGroup) {
                    const scale = out[0];
                    headGroup.scale.set(scale, scale, scale);
                }
                obj.userData.tremoloOpacity = out[1];
                obj.userData.tremoloEmission = out[2];
            }
        );

        // Process cymbal shake
        this.processExtendedBatch(
            this.extendedBatches.cymbalShake,
            19, time, kick, groove, highFreq,
            (obj, out) => {
                obj.userData.rotZ = out[0];
                obj.userData.rotX = out[1];
                const head = obj.children[1];
                if (head) {
                    head.rotation.z = out[0];
                    head.rotation.x = out[1];
                    const scale = out[2];
                    head.scale.set(scale, scale, scale);
                }
            }
        );

        // Process panning bob
        this.processExtendedBatch(
            this.extendedBatches.panningBob,
            20, time, kick, groove, this.getPanActivity(audioData),
            (obj, out) => {
                obj.position.y = (obj.userData.originalY || 0) + out[0];
                obj.rotation.z = out[1];
                obj.userData.currentBob = out[0];
                obj.userData.glowIntensity = out[2];
            }
        );

        // Process spirit fade
        this.processExtendedBatch(
            this.extendedBatches.spiritFade,
            21, time, kick, groove, volume,
            (obj, out) => {
                obj.userData.currentOpacity = out[0];
                obj.userData.fleeSpeed = out[2];
                if (obj.userData.spiritMaterial) {
                    obj.userData.spiritMaterial.opacity = out[0];
                    obj.userData.spiritMaterial.visible = out[0] > 0.01;
                }
                if (out[0] > 0.01) {
                    obj.position.y = out[1];
                }
            }
        );
    }

    // NEW: Process a single extended batch
    private processExtendedBatch(
        batch: ExtendedBatchState,
        animType: number,
        time: number,
        kick: number,
        groove: number,
        audioParam: number,
        apply: (obj: FoliageObject, output: Float32Array) => void
    ) {
        if (batch.count === 0) return;

        const instance = getWasmInstance();
        if (!instance) return;

        const F32 = new Float32Array((instance.exports.memory as any).buffer);

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
            for (let i = 0; i < batch.count; i++) {
                const obj = batch.objects[i];
                const outOffset = i * RESULT_STRIDE;
                apply(obj, results.subarray(outOffset, outOffset + RESULT_STRIDE));
                batch.objects[i] = undefined as any;
            }
        }

        batch.count = 0;
    }

    // NEW: Audio analysis helpers
    private getVibratoAmount(audioData: any): number {
        if (!audioData?.channelData) return 0;
        let amount = 0;
        for (const ch of audioData.channelData) {
            if (ch.activeEffect === 1) {
                amount = Math.max(amount, ch.effectValue || 0);
            }
        }
        return amount;
    }

    private getTremoloAmount(audioData: any): number {
        if (!audioData?.channelData) return 0;
        let amount = 0;
        for (const ch of audioData.channelData) {
            if (ch.activeEffect === 3) {
                amount = Math.max(amount, ch.effectValue || 0);
            }
        }
        // Also add beat-based pulse
        amount = Math.max(amount, Math.sin((audioData.beatPhase || 0) * Math.PI * 2) * 0.3);
        return amount;
    }

    private getHighFreqAmount(audioData: any): number {
        if (!audioData?.channelData) return 0;
        const ch3 = audioData.channelData[3]?.volume || 0;
        const ch4 = audioData.channelData[4]?.volume || 0;
        return Math.max(ch3, ch4);
    }

    private getAverageVolume(audioData: any): number {
        if (!audioData?.channelData) return 1.0;
        let sum = 0;
        for (const ch of audioData.channelData) {
            sum += ch.volume || 0;
        }
        return sum / 4.0;
    }

    private getPanActivity(audioData: any): number {
        if (!audioData?.channelData) return 0;
        let activity = 0;
        for (const ch of audioData.channelData) {
            const vol = ch.volume || 0;
            const pan = ch.pan || 0;
            activity += vol * Math.abs(pan);
        }
        return activity;
    }

    private processSimpleBatch(batch: BatchState, funcName: string, time: number, apply: (o: FoliageObject, v: number) => void) {
        if (batch.count === 0) return;

        const instance = getWasmInstance();
        if (!instance) return;

        const F32 = new Float32Array((instance.exports.memory as any).buffer);

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

        const F32 = new Float32Array((instance.exports.memory as any).buffer);

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

        const F32 = new Float32Array((instance.exports.memory as any).buffer);

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
}

export const foliageBatcher = FoliageBatcher.getInstance();
