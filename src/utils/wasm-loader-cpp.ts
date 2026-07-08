import { getNativeFunc, getNativeFuncVoid } from './wasm-loader-core.ts';

// =============================================================================
// C++ EMSCRIPTEN FUNCTION REFERENCES (CACHED)
// =============================================================================

/** Math functions from emscripten/math.cpp */
export let cppValueNoise2DSimd4: ((xPtr: number, yPtr: number, outPtr: number) => void) | null = null;
export let cppFbm2DSimd4: ((xPtr: number, yPtr: number, octaves: number, outPtr: number) => void) | null = null;
export let cppBatchGroundHeightSimd: ((positionsPtr: number, count: number, outputPtr: number) => void) | null = null;
export let cppBatchValueNoiseOmp: ((xPtr: number, yPtr: number, count: number, outPtr: number) => void) | null = null;
export let cppBatchFbmOmp: ((xPtr: number, yPtr: number, count: number, octaves: number, outPtr: number) => void) | null = null;
export let cppBatchDistSq3DOmp: ((axPtr: number, ayPtr: number, azPtr: number, bx: number, by: number, bz: number, count: number, outPtr: number) => void) | null = null;
export let cppFastSin: ((x: number) => number) | null = null;
export let cppFastCos: ((x: number) => number) | null = null;
export let cppFastPow2: ((x: number) => number) | null = null;

/** Unified ground height from emscripten/ground.cpp */
export let cppGetUnifiedGroundHeight: ((x: number, z: number, nowMs: number) => number) | null = null;
export let cppBatchUnifiedGroundHeight: ((positionsPtr: number, count: number, outputPtr: number, nowMs: number) => void) | null = null;
export let cppClearGroundPlatforms: (() => void) | null = null;
export let cppAddGroundPlatform: ((minX: number, maxX: number, minZ: number, maxZ: number, maxY: number) => void) | null = null;
export let cppInvalidateGroundCache: (() => void) | null = null;

/** Foliage interaction batches from emscripten/foliage_interact.cpp */
export let cppBatchGeyserLaunch: ((
    px: number, py: number, pz: number, pvy: number, delta: number,
    geysersPtr: number, count: number, outPtr: number
) => void) | null = null;
export let cppBatchPadForces: ((
    px: number, py: number, pz: number, pvy: number,
    padsPtr: number, count: number, outPtr: number
) => void) | null = null;
export let cppBatchVineInteraction: ((
    px: number, py: number, pz: number,
    vinesPtr: number, count: number, outPtr: number
) => void) | null = null;

/** Animation batch functions from emscripten/animation_batch.cpp */
export let cppBatchShiverSimd: ((inputPtr: number, count: number, time: number, intensity: number, outputPtr: number) => void) | null = null;
export let cppBatchSpringSimd: ((inputPtr: number, count: number, time: number, intensity: number, outputPtr: number) => void) | null = null;
export let cppBatchFloatSimd: ((inputPtr: number, count: number, time: number, intensity: number, outputPtr: number) => void) | null = null;
export let cppBatchCloudBobSimd: ((inputPtr: number, count: number, time: number, intensity: number, outputPtr: number) => void) | null = null;
export let cppBatchVineSwaySimd: ((inputPtr: number, count: number, time: number, intensity: number, outputPtr: number) => void) | null = null;
export let cppBatchGeyserEruptC: ((particlesPtr: number, count: number, time: number, kick: number, outputPtr: number) => void) | null = null;
export let cppBatchRetriggerSimd: ((inputPtr: number, count: number, time: number, retriggerSpeed: number, intensity: number, outputPtr: number) => void) | null = null;

/** Emscripten module (native C functions) */
export let emscriptenInstance: EmscriptenModule | null = null;
export let emscriptenMemory: ArrayBuffer | null = null;

// Physics / animation stubs referenced by initCppFunctions
export let calcFiberWhip: ((...args: number[]) => number) | null = null;
export let calcHopY: ((...args: number[]) => number) | null = null;
export let calcShiver: ((...args: number[]) => number) | null = null;
export let initPhysics: ((...args: number[]) => number) | null = null;
export let updatePhysicsCPP: ((...args: number[]) => number) | null = null;
export let setPhysicsTime: ((...args: number[]) => number) | null = null;
export let setGravity: ((...args: number[]) => number) | null = null;
export let registerMeshCollision: ((...args: number[]) => number) | null = null;
export let batchCollisionCheck_c: ((...args: number[]) => number) | null = null;
export let batchRaycast_c: ((...args: number[]) => number) | null = null;
export let createEntity: ((...args: number[]) => number) | null = null;
export let addTransform: ((...args: number[]) => number) | null = null;
export let addPhysics: ((...args: number[]) => number) | null = null;
export let getTransformX: ((...args: number[]) => number) | null = null;
export let getTransformY: ((...args: number[]) => number) | null = null;
export let getTransformZ: ((...args: number[]) => number) | null = null;
export let setTransform: ((...args: number[]) => number) | null = null;
export let initFluidSolver: ((...args: number[]) => number) | null = null;
export let updateFluidSolver: ((...args: number[]) => number) | null = null;
export let getFluidVelocityX: ((...args: number[]) => number) | null = null;
export let getFluidVelocityY: ((...args: number[]) => number) | null = null;
export let getFluidDensity: ((...args: number[]) => number) | null = null;

export function setEmscriptenInstance(instance: EmscriptenModule | null): void {
  emscriptenInstance = instance;
  if (instance?.wasmMemory) {
    emscriptenMemory = instance.wasmMemory.buffer;
  } else if (instance?.HEAP8) {
    emscriptenMemory = instance.HEAP8.buffer;
  } else {
    emscriptenMemory = null;
  }
}

// =============================================================================
// INITIALIZE C++ EMSCRIPTEN FUNCTIONS
// =============================================================================
export function initCppFunctions(): void {
  // Math (emscripten/math.cpp)
  cppValueNoise2DSimd4 = getNativeFuncVoid('valueNoise2D_simd4');
  cppFbm2DSimd4 = getNativeFuncVoid('fbm2D_simd4');
  cppBatchGroundHeightSimd = getNativeFuncVoid('batchGroundHeight_simd');
  cppBatchValueNoiseOmp = getNativeFuncVoid('batchValueNoise_omp');
  cppBatchFbmOmp = getNativeFuncVoid('batchFbm_omp');
  cppBatchDistSq3DOmp = getNativeFuncVoid('batchDistSq3D_omp');
  cppFastSin = getNativeFunc('fastSin');
  cppFastCos = getNativeFunc('fastCos');
  cppFastPow2 = getNativeFunc('fastPow2');

  // Unified ground (emscripten/ground.cpp)
  cppGetUnifiedGroundHeight = getNativeFunc('getUnifiedGroundHeight');
  cppBatchUnifiedGroundHeight = getNativeFuncVoid('batchUnifiedGroundHeight');
  cppClearGroundPlatforms = getNativeFuncVoid('clearGroundPlatforms');
  cppAddGroundPlatform = getNativeFuncVoid('addGroundPlatform');
  cppInvalidateGroundCache = getNativeFuncVoid('invalidateGroundCache');

  // Foliage interaction (emscripten/foliage_interact.cpp)
  cppBatchGeyserLaunch = getNativeFuncVoid('batchGeyserLaunch_c');
  cppBatchPadForces = getNativeFuncVoid('batchPadForces_c');
  cppBatchVineInteraction = getNativeFuncVoid('batchVineInteraction_c');

  // Animation
  calcFiberWhip = getNativeFunc('calcFiberWhip');
  calcHopY = getNativeFunc('calcHopY');
  calcShiver = getNativeFunc('calcShiver');

  // Physics
  initPhysics = getNativeFunc('initPhysics');
  updatePhysicsCPP = getNativeFunc('updatePhysicsCPP');
  setPhysicsTime = getNativeFunc('setPhysicsTime');
  setGravity = getNativeFunc('setGravity');
  registerMeshCollision = getNativeFunc('registerMeshCollision');
  batchCollisionCheck_c = getNativeFunc('batchCollisionCheck_c');
  batchRaycast_c = getNativeFunc('batchRaycast_c');

  // ECS
  createEntity = getNativeFunc('createEntity');
  addTransform = getNativeFunc('addTransform');
  addPhysics = getNativeFunc('addPhysics');
  getTransformX = getNativeFunc('getTransformX');
  getTransformY = getNativeFunc('getTransformY');
  getTransformZ = getNativeFunc('getTransformZ');
  setTransform = getNativeFunc('setTransform');

  // Fluid
  initFluidSolver = getNativeFunc('initFluidSolver');
  updateFluidSolver = getNativeFunc('updateFluidSolver');
  getFluidVelocityX = getNativeFunc('getFluidVelocityX');
  getFluidVelocityY = getNativeFunc('getFluidVelocityY');
  getFluidDensity = getNativeFunc('getFluidDensity');

  console.log('[WASM] C++ Physics & Math functions mapped successfully');
}

export function setEmscriptenMemory(val: ArrayBuffer | null) { emscriptenMemory = val; }
