/**
 * @file wasm-loader.js
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
    initWasmParallel,
    isWasmReady,
    isEmscriptenReady,
    getWasmInstance,
    getEmscriptenInstance,
    
    // Memory accessors
    getWasmMemory,
    getEmscriptenMemory,
    
    // Internal utilities (exported for advanced use)
    getNativeFunc,
    updateProgress,
    
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
    AnimationType,
    
    // Cached WASM function references
    wasmGetGroundHeight,
    wasmFreqToHue,
    wasmLerp,
    wasmBatchMushroomSpawnCandidates,
    wasmUpdateFoliageBatch,
    wasmInitCollisionSystem,
    wasmAddCollisionObject,
    wasmResolveGameCollisions,
    wasmCheckPositionValidity,
    
    // Type definitions
    type AnimationTypeValue,
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
    type MaterialInfo,
    type AnimationData,
    type PositionData,
    type PlayerState,
    type WasmExportValue,
    type WasmExports,
    type InitWasmParallelOptions,
    
    // Re-exports from orchestrator
    LOADING_PHASES,
    isSharedMemoryAvailable,
    initSharedBuffer,
    getSharedBuffer,
    createPlaceholderScene,
    removePlaceholderScene
} from './wasm-loader-core.ts';

// =============================================================================
// EXPORTS FROM wasm-animations.ts
// =============================================================================

export {
    // Animation type definitions
    type WobbleResult,
    type AccordionResult,
    type FiberResult,
    type ShiverResult,
    type SpiralResult,
    type PrismResult,
    type ArpeggioResult,
    type ParticleResult,
    
    // Simple animation helpers
    calcBounceY,
    calcSwayRotZ,
    calcWobble,
    calcHopY,
    calcShiver,
    
    // Advanced animations
    calcAccordionStretch,
    calcFiberWhip,
    calcSpiralWave,
    calcPrismRose,
    
    // Musical/audio reactivity
    calcArpeggioStep,
    calcSpeakerPulse,
    
    // Particle effects
    calcFloatingParticle,
    calcRainDropY,
    
    // Color utilities
    lerpColor
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
    checkCollision,
    
    // Physics helpers
    initCollisionSystem,
    addCollisionObject,
    checkPositionValidity,
    
    // Native C++ physics wrappers
    updatePhysicsCPP,
    initPhysics,
    addObstacle,
    uploadObstaclesBatch,
    
    // Player state
    setPlayerState,
    getPlayerState,
    
    // Math fallbacks
    valueNoise2D,
    fbm,
    fastInvSqrt,
    fastDistance,
    hash,
    
    // Simple math functions
    getGroundHeight,
    freqToHue,
    lerp
} from './wasm-physics.ts';

// =============================================================================
// EXPORTS FROM wasm-batch.ts
// =============================================================================

export {
    // Type definitions
    type SpawnCandidate,
    type MaterialAnalysisResult,
    type DistanceCullResult,
    
    // Batch upload functions
    uploadPositions,
    uploadMushroomSpecs,
    copySharedPositions,
    uploadAnimationData,
    
    // Culling
    batchDistanceCull,
    
    // Spawning
    batchMushroomSpawnCandidates,
    readSpawnCandidates,
    
    // Materials
    analyzeMaterials,
    getUniqueShaderCount,
    
    // Batch animation
    batchAnimationCalc,
    
    // Agent 1: Simple animation batch
    batchShiver_c,
    batchSpring_c,
    batchFloat_c,
    batchCloudBob_c,
    
    // Agent 2: Mesh deformation
    deformWave_c,
    deformJiggle_c,
    deformWobble_c,
    
    // Agent 3: LOD batch
    batchUpdateLODMatrices_c,
    batchScaleMatrices_c,
    batchFadeColors_c,
    
    // Agent 4: Frustum/distance culling
    batchFrustumCull_c,
    batchDistanceCullIndexed_c,
    
    // Fluid simulation
    fluidInit,
    fluidStep,
    fluidAddDensity,
    fluidAddVelocity,
    getFluidDensityView,
    updateParticlesWASM
} from './wasm-batch.ts';
