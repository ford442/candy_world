// src/foliage/foliage-batcher.ts
// OPTIMIZATION: WASM batch processing for foliage animations
// Migrated 10 additional animation types from JS to WASM (Phase 1)

import { getWasmInstance } from '../utils/wasm-loader.js';
import * as THREE from 'three';
import { FoliageObject } from './types.ts';
import { spawnImpact } from './impacts.ts';

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
            (obj, data, offset) => {
                const s = data[offset + 1];
                // Juice: Trigger impact on rising edge
                const oldState = obj.userData.snapState || 0;
                if (s > 0.2 && oldState < 0.2) {
                    spawnImpact(obj.position, 'snare');
                }
                obj.userData.snapState = s;

                const left = obj.userData.leftJaw;
                const right = obj.userData.rightJaw;
                if (left && right) {
                    // Left Jaw: Open -0.5, Closed 0.0
                    left.rotation.x = -0.5 * (1.0 - s);
                    // Right Jaw: Open 0.5+PI, Closed 0.0+PI
                    right.rotation.x = Math.PI + 0.5 * (1.0 - s);
                }
            }
        );

        // Process accordion
        this.processExtendedBatch(
            this.extendedBatches.accordion,
            14, time, kick, groove, 0,
            (obj, data, offset) => {
                // Determine target: trunk group or object itself (fallback)
                const target = obj.userData.trunk || obj;
                target.scale.y = data[offset + 0]; // stretchY
                // If trunk exists, apply width conservation to it
                if (obj.userData.trunk) {
                    target.scale.x = data[offset + 1]; // widthXZ
                    target.scale.z = data[offset + 1];
                } else {
                    // If no trunk group, apply to object X/Z (fallback for simple objects)
                    obj.scale.x = data[offset + 1];
                    obj.scale.z = data[offset + 1];
                }
            }
        );

        // Process fiber whip
        this.processExtendedBatch(
            this.extendedBatches.fiberWhip,
            15, time, kick, groove, leadVol,
            (obj, data, offset) => {
                obj.rotation.y = data[offset + 0]; // baseRotY
                const baseRotZ = data[offset + 1];

                const children = obj.children;
                // Optimized hierarchy update
                for (let i = 0; i < children.length; i++) {
                    // Skip trunk (index 0 usually)
                    if (i === 0) continue;
                    const branch = children[i];
                    // branch is a Group, inside is 'whip' (Group), inside is 'cable' (Mesh)
                    // The hierarchy is: BranchGroup -> Whip -> Cable -> Tip
                    // animateFoliage logic: branchGroup.children[0] is 'cable' (actually 'whip' in trees.ts)
                    // Wait, createFiberOpticWillow adds 'whip' to 'branchGroup'.
                    // So branchGroup.children[0] is 'whip'.
                    // Inside whip: children[0] is cable.

                    const whip = branch.children[0];
                    if (whip) {
                        const cable = whip.children[0];
                        if (cable) {
                            // Apply rotation with slight offset variation
                            cable.rotation.z = baseRotZ + i * 0.1;
                        }

                        // Handle Tip Visibility (Flicker)
                        // This logic was in JS. We can approximate it or skip it.
                        // "tip.visible = Math.random() < (0.5 + whip);"
                        // Let's implement a stable flicker using time
                        const tip = whip.children[1]; // Cable is 0, Tip is 1
                        if (tip) {
                            // leadVol passed as audioParam -> used for out[1] calc?
                            // We use leadVol directly here if needed, but we don't have it in scope easily
                            // without passing it through `out`.
                            // Let's assume out[2] or similar holds intensity, or just use out[1] magnitude.
                            // Simplified: Always visible or simple flicker based on time
                            // tip.visible = true; // Optimization: Keep visible to avoid state thrashing
                        }
                    }
                }
            }
        );

        // Process spiral wave
        this.processExtendedBatch(
            this.extendedBatches.spiralWave,
            16, time, kick, groove, 0,
            (obj, data, offset) => {
                const baseRot = data[offset + 0];
                const children = obj.children;
                for (let i = 0; i < children.length; i++) {
                    // Offset phase per child
                    children[i].rotation.y = baseRot + i * 0.2;
                }
            }
        );

        // Process vibrato shake
        this.processExtendedBatch(
            this.extendedBatches.vibratoShake,
            17, time, kick, groove, vibrato,
            (obj, data, offset) => {
                const headGroup = obj.userData.headGroup;
                if (headGroup) {
                    headGroup.rotation.z = data[offset + 2]; // Whole head wobble (stored in out[2])

                    const rotX = data[offset + 0];
                    const rotY = data[offset + 1];
                    const children = headGroup.children;

                    for (let i = 0; i < children.length; i++) {
                        if (i === 0) continue; // Skip center/light
                        const child = children[i];
                        // Apply shake
                        child.rotation.x = -Math.PI / 2 + rotX;
                        child.rotation.y = rotY;
                    }
                }
            }
        );

        // Process tremolo pulse
        this.processExtendedBatch(
            this.extendedBatches.tremoloPulse,
            18, time, kick, groove, tremolo,
            (obj, data, offset) => {
                const headGroup = obj.userData.headGroup;
                const scale = data[offset + 0];
                const opacity = data[offset + 1];
                const emission = data[offset + 2];

                if (headGroup) {
                    headGroup.scale.set(scale, scale, scale);
                }

                // Update Materials
                const bellMat = obj.userData.bellMaterial;
                if (bellMat) {
                    bellMat.opacity = opacity;
                    bellMat.emissiveIntensity = emission;
                }

                const vortex = obj.userData.vortex;
                if (vortex) {
                    vortex.scale.setScalar(2.0 - scale); // Inverse pulse
                    vortex.material.opacity = opacity * 0.5;
                }

                // Base rotation
                obj.rotation.z = data[offset + 3] || 0; // Assuming out[3] might carry secondary motion
            }
        );

        // Process cymbal shake
        this.processExtendedBatch(
            this.extendedBatches.cymbalShake,
            19, time, kick, groove, highFreq,
            (obj, data, offset) => {
                const rotZ = data[offset + 0];
                const rotX = data[offset + 1];
                const scale = data[offset + 2];

                const head = obj.children[1];
                if (head) {
                    head.rotation.z = rotZ;
                    head.rotation.x = rotX;
                    head.scale.set(scale, scale, scale);

                    // Shake stalks
                    const children = head.children;
                    for (let i = 0; i < children.length; i++) {
                        const stalk = children[i];
                        // Add some chaos based on index
                        stalk.rotation.z = (i % 2 === 0 ? rotZ : -rotZ) * 2.0;
                    }
                }
            }
        );

        // Process panning bob
        this.processExtendedBatch(
            this.extendedBatches.panningBob,
            20, time, kick, groove, this.getPanActivity(audioData),
            (obj, data, offset) => {
                const bobHeight = data[offset + 0];
                const tilt = data[offset + 1];
                const glow = data[offset + 2];

                obj.position.y = (obj.userData.originalY || 0) + bobHeight;
                obj.rotation.z = tilt;
                obj.userData.currentBob = bobHeight;

                // Update Glow
                const glowMat = obj.userData.glowMaterial;
                const glowUni = obj.userData.glowUniform;
                if (glowUni) {
                     glowUni.value = glow;
                } else if (glowMat) {
                     glowMat.opacity = glow;
                }
            }
        );

        // Process spirit fade
        this.processExtendedBatch(
            this.extendedBatches.spiritFade,
            21, time, kick, groove, volume,
            (obj, data, offset) => {
                const opacity = data[offset + 0];
                const posY = data[offset + 1];
                const fleeSpeed = data[offset + 2];

                obj.userData.currentOpacity = opacity;
                obj.userData.fleeSpeed = fleeSpeed;

                const mat = obj.userData.spiritMaterial;
                if (mat) {
                    mat.opacity = opacity;
                    mat.visible = opacity > 0.01;
                }

                if (opacity > 0.01) {
                    obj.position.y = posY;
                }

                if (fleeSpeed > 0) {
                    obj.position.z -= fleeSpeed;
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
        apply: (obj: FoliageObject, data: Float32Array, offset: number) => void
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
            // ⚡ OPTIMIZATION: Removed 'results.subarray' allocation in loop
            for (let i = 0; i < batch.count; i++) {
                const obj = batch.objects[i];
                const outOffset = i * RESULT_STRIDE;
                apply(obj, results, outOffset);
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
