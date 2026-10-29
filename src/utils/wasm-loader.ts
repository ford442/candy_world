/**
 * @file wasm-loader.ts
 * @brief Barrel file - re-exports from wasm-loader modules
 *
 * This file maintains backward compatibility for code importing from wasm-loader.
 * All implementation has been split into:
 * - wasm-loader-core.ts: Core WASM initialization and state
 * - wasm-animations.ts: Animation functions
 * - wasm-physics.ts: Physics and collision functions
 * - wasm-batch.ts: Batch processing functions
 */

// =============================================================================
// EXPORTS FROM wasm-loader-core.ts
// =============================================================================

export {
    // Initialization
    initWasm,
    isWasmReady,
    isEmscriptenReady,
    getWasmInstance,
    getEmscriptenInstance,

    // Memory accessors
    getWasmMemory,
    getEmscriptenMemory,

    // Internal utilities (exported for advanced use)
    getNativeFunc,

    // State exports
    wasmInstance,
    wasmMemory,
    emscriptenInstance,
    emscriptenMemory,
    positionView,
    animationView,
    outputView,
    playerStateView,

    // Memory layout constants
    POSITION_OFFSET,
    ANIMATION_OFFSET,
    OUTPUT_OFFSET,
    PLAYER_STATE_OFFSET,

    // Animation type constants

    // Cached WASM function references
    wasmGetGroundHeight,
    wasmFreqToHue,
    wasmBatchMushroomSpawnCandidates,
    wasmInitCollisionSystem,
    wasmAddCollisionObject,
    wasmResolveGameCollisions,
    wasmCheckPositionValidity,
    wasmUpdateBoids,
    cppUpdateBoids,

    // Hot-path Foliage Animation exports (Migrated from TS)
    wasmSmoothWobble,
    wasmBatchGrowth,
    wasmBatchBloom,
    wasmBatchScaleAnimation,

    // Hot-path Physics exports (Migrated from TS)
    wasmBatchGroundHeight,
    wasmGetUnifiedGroundHeight,
    wasmBatchUnifiedGroundHeight,
    wasmClearGroundPlatforms,
    wasmAddGroundPlatform,
    wasmInvalidateGroundCache,
    wasmSetGroundCacheTTL,

    // New math functions
    // New batch functions
    // New particle functions

    // C++ Emscripten function references
    cppBatchGroundHeightSimd,
    cppGetUnifiedGroundHeight,
    cppBatchUnifiedGroundHeight,
    cppClearGroundPlatforms,
    cppAddGroundPlatform,
    cppInvalidateGroundCache,
    cppSetGroundCacheTTL,

    // C++ function initialization
    initCppFunctions,

    // Type definitions
    type WasiStubs,
    type WasmImportObject,
    type EmscriptenModule,
    type ExtendedEmscriptenModule,
    type Positionable,
    type Mushroom,
    type Matrix4Like,
    type Vector3Like,
    type Cave,
    type Cloud,
    type Trampoline,
    type PlayerState,
    type WasmExportValue,
    type WasmExports,

    // Re-exports from orchestrator
    isSharedMemoryAvailable,
} from './wasm-loader-core.ts';

// =============================================================================
// EXPORTS FROM wasm-animations.ts
// =============================================================================

export {
    // Animation type definitions
    type ArpeggioResult,

    // Simple animation helpers

    // Advanced animations

    // Musical/audio reactivity
    calcArpeggioStep,

    // Particle effects

    // Color utilities
} from './wasm-animations.ts';

// =============================================================================
// EXPORTS FROM wasm-physics.ts
// =============================================================================

export {
    // Type definitions
    type PlayerStateResult,

    // Collision system
    uploadCollisionObjects,
    resolveGameCollisionsWASM,

    // Physics helpers
    initDynamicFoliageBridge,
    initCollisionSystem,
    addCollisionObject,
    checkPositionValidity,

    // Native C++ physics wrappers
    updatePhysicsCPP,
    initPhysics,

    // Player state
    setPlayerState,
    getPlayerState,

    // Math fallbacks

    // Simple math functions
    getGroundHeight,
    getGroundHeightBatch,
    batchGroundHeight,
    freqToHue,
    // New math functions
} from './wasm-physics.ts';

// =============================================================================
// EXPORTS FROM wasm-batch.ts
// =============================================================================

export {
    // Type definitions
    type SpawnCandidate,
    type DistanceCullResult,

    // Batch upload functions
    uploadMushroomSpecs,

    // Culling
    batchDistanceCull,

    // Spawning
    batchMushroomSpawnCandidates,
    readSpawnCandidates,

    // Materials

    // Batch animation

    // Agent 1: Simple animation batch

    // Agent 2: Mesh deformation

    // Agent 3: LOD batch
    batchUpdateLodFactors_c,

    // Agent 4: Frustum/distance culling

    // Fluid simulation
    fluidInit,
    fluidStep,
    fluidAddDensity,
    fluidAddVelocity,
    getFluidDensityView,
    // New batch functions
    // New particle functions
    // C++ Math batch wrappers
    // C++ Animation batch wrappers (high-level)
} from './wasm-batch.ts';

// Unified ground-height bridge
export {
    syncGroundPlatformsToNative,
    syncGroundCacheTTLToNative,
    invalidateNativeGroundCache,
    queryUnifiedGroundHeight,
    fillUnifiedGroundHeights,
} from './wasm-ground.ts';

// Foliage interaction batches
export {
    batchGeyserLaunch,
    batchPadForces,
    batchVineInteraction,
    geyserLaunchJS,
    padForcesJS,
    vineProximityJS,
    packGeysers,
    packPads,
    packVines,
    GEYSER_STRIDE,
    PAD_STRIDE,
    VINE_STRIDE,
} from './wasm-foliage-interact.ts';

// Music reactivity channel accumulate (arpeggio_grove)
export {
    accumulateArpeggioChannels,
    accumulateArpeggioChannelsTS,
    accumulateArpeggioChannelsNative,
    nightGateFromBias,
    isNativeMusicAccumReady,
    isNativeMusicAccumEnabled,
} from './wasm-music-reactivity.ts';
