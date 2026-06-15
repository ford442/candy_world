import { getNativeFunc } from './wasm-loader-core.ts';

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

export function setEmscriptenInstance(instance: EmscriptenModule | null) {
  emscriptenInstance = instance;
}

export function setEmscriptenMemory(mem: ArrayBuffer | null) {
  emscriptenMemory = mem;
}

export function getEmscriptenInstance(): EmscriptenModule | null {
  return emscriptenInstance;
}

export function getEmscriptenMemory(): ArrayBuffer | null {
  return emscriptenMemory;
}


// =============================================================================
// INITIALIZE C++ EMSCRIPTEN FUNCTIONS
// =============================================================================
export function initCppFunctions(): void {
  // Math
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
