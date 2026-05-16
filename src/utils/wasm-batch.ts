/**
 * @file wasm-batch.ts
 * @brief Barrel file - re-exports all WASM batch processing functions
 * 
 * This module re-exports batch processing functions from split modules:
 * - wasm-batch-types: Type definitions
 * - wasm-batch-core: Core batch operations (uploads, culling, spawning, materials)
 * - wasm-batch-math: Math utilities and noise functions
 * - wasm-batch-animation: Animation wrappers (high-level and SIMD)
 * - wasm-batch-particles: Particle operations
 */

// Re-export types
export type {
    SpawnCandidate,
    MaterialAnalysisResult,
    DistanceCullResult,
    MaterialInfo
} from './wasm-batch-types.ts';

// Re-export core batch operations
export {
    uploadPositions,
    uploadMushroomSpecs,
    copySharedPositions,
    uploadAnimationData,
    batchDistanceCull,
    batchMushroomSpawnCandidates,
    readSpawnCandidates,
    analyzeMaterials,
    getUniqueShaderCount
} from './wasm-batch-core.ts';

// Re-export math/utility functions
export {
    batchHslToRgb,
    batchSphereCull,
    batchLerp,
    batchValueNoiseSimd4,
    batchFbmSimd4,
    batchGroundHeightSimd,
    batchValueNoiseOmp,
    batchFbmOmp,
    batchDistSq3DOmp,
    fastSin,
    fastCos,
    fastPow2
} from './wasm-batch-math.ts';

// Re-export animation wrappers
export {
    batchShiverHighLevel,
    batchSpringHighLevel,
    batchFloatHighLevel,
    batchCloudBobHighLevel,
    batchVineSwayHighLevel,
    batchGeyserEruptHighLevel,
    batchRetriggerHighLevel
} from './wasm-batch-animation.ts';

// Re-export particle operations
export {
    updateParticles,
    spawnBurst,
    getHeightmapBatch
} from './wasm-batch-particles.ts';
