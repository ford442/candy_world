// src/foliage/batcher/foliage-batcher-types.ts
// Type definitions and constants for foliage batch processing

import type { FoliageObject } from '../types.ts';
export type { FoliageObject };

// Batch configuration
export const BATCH_SIZE = 4000; // Max objects per type per batch

// Memory layout for batch processing (in bytes)
// We allocate memory starting at 16KB boundary (after the WASM's standard memory regions)
// Standard WASM regions: POSITION_OFFSET (0), ANIMATION_OFFSET (4096), OUTPUT_OFFSET (8192), MATERIAL_DATA_OFFSET (12288)
// Starting at 16KB (16384) provides safe separation from these regions
// Each batch needs space for: offsets, intensities, originalYs, wobbleBoosts, outScalars, outScalars2
// Each array is BATCH_SIZE * 4 bytes = 16000 bytes
export const BATCH_MEMORY_START = 16384; // Start at 16KB boundary for alignment
export const BATCH_ARRAY_SIZE = BATCH_SIZE * 4; // Size in bytes per array (16000 bytes)

// Extended memory for additional batch types (Phase 1 Migration)
// Located after existing batch memory (ends at ~96KB, so we start at 128KB for safety)
export const EXTENDED_BATCH_START = 131072; // 128KB
export const ENTRY_STRIDE = 6; // offset, intensity, originalY/param0, wobbleBoost/param1, param2, param3
export const ENTRY_SIZE = ENTRY_STRIDE * 4; // 24 bytes per entry
export const RESULT_STRIDE = 4; // 4 floats per result
export const RESULT_SIZE = RESULT_STRIDE * 4; // 16 bytes per result

export interface BatchState {
    count: number;
    offsets: Float32Array;
    intensities: Float32Array;
    originalYs?: Float32Array;
    wobbleBoosts?: Float32Array;
    // Extended params for complex animations
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

// Extended batch state with entry-based memory layout
export interface ExtendedBatchState {
    count: number;
    // Input: 6 floats per object (ENTRY_STRIDE)
    input: Float32Array;
    // Output: 4 floats per object (RESULT_STRIDE)
    output: Float32Array;
    objects: FoliageObject[];
    ptrInput: number;
    ptrOutput: number;
}
