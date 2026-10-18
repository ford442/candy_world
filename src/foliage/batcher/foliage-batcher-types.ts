// src/foliage/batcher/foliage-batcher-types.ts
// Type definitions and constants for foliage batch processing

import type { FoliageObject } from '../types.ts';
export type { FoliageObject };

// Batch configuration
export const BATCH_SIZE = 4000; // Max objects per type per batch

// Memory layout for batch processing (in bytes). Each batch gets its own block
// from the AS allocator (assembly/allocator.ts); there are no fixed offsets.
// Each array is BATCH_SIZE * 4 bytes = 16000 bytes.
export const BATCH_ARRAY_SIZE = BATCH_SIZE * 4; // Size in bytes per array (16000 bytes)
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
