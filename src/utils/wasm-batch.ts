/**
 * @file wasm-batch.ts
 * @brief Barrel file - re-exports all WASM batch processing functions
 * 
 * This module re-exports batch processing functions from split modules:
 * - wasm-batch-types: Type definitions
 * - wasm-batch-core: Core batch operations (uploads, culling, spawning, materials)
 * - wasm-batch-animation: Animation wrappers (high-level and SIMD)
 */

// Re-export types
export type {
    SpawnCandidate,
    DistanceCullResult,
} from './wasm-batch-types.ts';

// Re-export core batch operations
export {
    uploadPositionsFlat,
    uploadMushroomSpecs,
    batchDistanceCull,
    batchMushroomSpawnCandidates,
    readSpawnCandidates,
    WASM_POSITION_OBJECT_CAPACITY,
} from './wasm-batch-core.ts';

// Re-export animation wrappers
export {
    batchUpdateLodFactors_c,
    batchDistanceCull_c,
    fluidInit,
    fluidStep,
    fluidAddDensity,
    fluidAddVelocity,
    getFluidDensityView,
} from './wasm-batch-animation.ts';
