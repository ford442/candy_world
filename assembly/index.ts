// The AssemblyScript ABI: every name here is a wasm export, and every one has
// a caller in src/ or tests/ (scripts/check-native-exports.mjs enforces it).
// List names explicitly; `export *` would export every helper a module shares
// with its siblings. asc only compiles what these reach.

// Memory layout values tests/wasm.mjs checks against scripts/memory-layout.mjs
export { MAX_COLLISION_OBJECTS, MEMORY_LAYOUT_END } from './constants';

// JS-owned buffers (src/utils/native-memory.ts); getHeapBase for check:memory-layout
export { malloc, free, getHeapBase } from './allocator';

export { getGroundHeight, freqToHue } from './math';

export {
    initDynamicFoliageMemory,
    initCollisionSystem,
    addCollisionObjectsBatch,
    addCollisionObject,
    checkPositionValidity,
    resolveGameCollisions,
    batchGroundHeight,
    batchFrustumTest,
} from './physics';

export { calcArpeggioStep, getArpeggioTargetStep, getArpeggioUnfurlStep } from './animation';

export { processBatchUniversal } from './animation_batch';

export {
    batchMaterialFlash,
    initMaterialEntry,
    triggerMaterialFlash,
    getMaterialResult,
    materialNeedsFadeBack,
    getMaterialFlashIntensity,
} from './material_batch';

export {
    initDiscoverySystem,
    registerDiscoveryObject,
    checkDiscoverySpatial,
    markDiscovered,
    isObjectDiscovered,
    getDiscoveryTypeId,
    resetAllDiscoveries,
    getUndiscoveredCount,
} from './discovery';

export {
    analyzeMaterials,
    batchDistanceCull,
    batchMushroomSpawnCandidates,
    batchComposeMatrices,
    batchWriteInstanceColors,
    batchWriteInstancePose,
} from './batch';

export {
    computeSway,
    computeBounce,
    computeWobble,
    computeGentleSway,
    computeHop,
    smoothWobble,
} from './foliage';

export { updateParticles, spawnBurst } from './particles';

export { updateBoids } from './boids';

export {
    clearGroundPlatforms,
    addGroundPlatform,
    setGroundCacheTTL,
    invalidateGroundCache,
    getUnifiedGroundHeight,
    batchUnifiedGroundHeight,
} from './ground';

export { accumulateArpeggioChannels } from './music_reactivity';

export {
    initRigidBodySystem,
    rbCapacity,
    rbCount,
    rbAwakeCount,
    rbSpawn,
    rbDespawn,
    rbClear,
    rbApplyImpulse,
    rbApplyRadialImpulse,
    rbSetPlayerProxy,
    rbDisablePlayerProxy,
    rbIsSleeping,
    stepRigidBodies,
} from './rigidbody';

export {
    JOINT_FIXED,
    JOINT_HINGE,
    JOINT_SPRING,
    initJointSystem,
    jointPoolPointer,
    jointHighWater,
    jointCapacity,
    jointCount,
    jointCreate,
    jointCreateFixed,
    jointCreateHinge,
    jointCreateSpring,
    jointDestroy,
    jointsClear,
    jointSetSoftness,
    jointGetError,
    solveJoints,
} from './joints';
