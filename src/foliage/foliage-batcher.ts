// src/foliage/foliage-batcher.ts
import { getWasmInstance } from '../utils/wasm-loader.js';
import * as THREE from 'three';
import { FoliageObject } from './types.js';

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

interface BatchState {
    count: number;
    offsets: Float32Array;
    intensities: Float32Array;
    originalYs?: Float32Array;
    wobbleBoosts?: Float32Array;
    outScalars?: Float32Array; // For rotZ, etc.
    outScalars2?: Float32Array; // For rotX in wobble
    objects: FoliageObject[];
    ptrOffsets: number;
    ptrIntensities: number;
    ptrOriginalYs?: number;
    ptrWobbleBoosts?: number;
    ptrOutScalars: number;
    ptrOutScalars2?: number;
}

export class FoliageBatcher {
    private static instance: FoliageBatcher;
    private initialized = false;

    // Batches for each supported type
    private batches: {
        sway: BatchState;
        bounce: BatchState;
        hop: BatchState;
        gentleSway: BatchState;
        wobble: BatchState;
    };

    private constructor() {
        this.batches = {
            sway: this.createBatch(),
            bounce: this.createBatch(true), // needs originalY
            hop: this.createBatch(true),
            gentleSway: this.createBatch(),
            wobble: this.createBatch(false, true, true) // needs wobbleBoosts, 2 outputs
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

    queue(obj: FoliageObject, type: string, intensity: number, time: number): boolean {
        // Return true if handled, false if caller should use fallback
        if (!this.initialized) this.init();
        if (!this.initialized) return false;

        let batch: BatchState | undefined;

        if (type === 'sway') batch = this.batches.sway;
        else if (type === 'bounce') batch = this.batches.bounce;
        else if (type === 'hop') batch = this.batches.hop;
        else if (type === 'gentleSway') batch = this.batches.gentleSway;
        else if (type === 'wobble') batch = this.batches.wobble;

        if (!batch) return false;
        if (batch.count >= BATCH_SIZE) return false; // Batch full, fallback

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

    flush(time: number, kick: number) {
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
                // Decay wobble state (logic from JS fallback)
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
