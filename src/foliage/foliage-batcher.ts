// src/foliage/foliage-batcher.ts
import { getWasmInstance } from '../utils/wasm-loader.js';
import * as THREE from 'three';
import { FoliageObject } from './types.js';

// Batch configuration
const BATCH_SIZE = 4000; // Max objects per type per batch

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
        // We will allocate WASM memory lazily in init() because wasmLoader might not be ready in constructor
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

    private initBatchMemory(batch: BatchState) {
        if (batch.ptrOffsets !== 0) return; // Already alloc

        const instance = getWasmInstance();
        if (!instance) return;

        const { __new, __pin } = instance.exports as any;

        const alloc = (size: number) => {
            const ptr = __new(size * 4, 0); // 0 = classId (generic)
            __pin(ptr); // Pin so GC doesn't reclaim it
            return ptr;
        };

        batch.ptrOffsets = alloc(BATCH_SIZE);
        batch.ptrIntensities = alloc(BATCH_SIZE);
        batch.ptrOutScalars = alloc(BATCH_SIZE);

        if (batch.originalYs) batch.ptrOriginalYs = alloc(BATCH_SIZE);
        if (batch.wobbleBoosts) batch.ptrWobbleBoosts = alloc(BATCH_SIZE);
        if (batch.outScalars2) batch.ptrOutScalars2 = alloc(BATCH_SIZE);
    }

    init() {
        const instance = getWasmInstance();
        if (this.initialized || !instance) return;

        Object.values(this.batches).forEach(b => this.initBatchMemory(b));
        this.initialized = true;
        console.log('[FoliageBatcher] WASM memory allocated and pinned for batching');
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
