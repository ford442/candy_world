/**
 * @file wasm-batch-types.ts
 * @brief Type definitions for WASM batch operations
 * 
 * Exports all type definitions used by the batch processing system
 */

/**
 * Spawn candidate result
 */
export interface SpawnCandidate {
    x: number;
    y: number;
    z: number;
    colorIndex: number;
}

/**
 * Distance cull result
 */
export interface DistanceCullResult {
    visibleCount: number;
    flags: Float32Array | null;
}

