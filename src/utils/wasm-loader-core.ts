/**
 * @file wasm-loader-core.ts
 * @brief Core WASM Module Initialization and State Management
 * 
 * This module handles:
 * - AssemblyScript WASM initialization (top-level await)
 * - Emscripten module loader (threaded/single-threaded fallback)
 * - Progress UI helpers
 * - State exports and memory views
 * - getNativeFunc() helper
 */

import { updateProgress, setWasmPhase, setWasmError } from '../ui/index.ts';
import { 
    parallelWasmLoad, 
    LOADING_PHASES, 
    initSharedBuffer, 
    getSharedBuffer,
    isSharedMemoryAvailable,
    type ParallelWasmLoadOptions
} from './wasm-orchestrator.ts';

import { checkWasmFileExists, inspectWasmExports, patchWasmInstantiateAliases } from './wasm-utils.ts';
import { showToast } from './toast.ts';

// Import WASM initialization function (Vite + vite-plugin-wasm)
// @ts-ignore - Vite-specific WASM import with vite-plugin-wasm
import initCandyPhysics from '../wasm/candy_physics.wasm?init';

// =============================================================================
// STATE EXPORTS
// =============================================================================

/** WASM instance and memory */
export let wasmInstance: WebAssembly.Instance | null = null;
export let wasmMemory: WebAssembly.Memory | null = null;
export let positionView: Float32Array | null = null;   // Float32Array for object positions
export let animationView: Float32Array | null = null;  // Float32Array for animation data
export let outputView: Float32Array | null = null;     // Float32Array for reading results
export let playerStateView: Float32Array | null = null; // Float32Array for player physics state

/** Shared Float32Array for batch operations */
export let sharedF32: Float32Array | null = null;

/** Cached WASM function references */
export let wasmGetGroundHeight: ((x: number, z: number) => number) | null = null;
export let wasmFreqToHue: ((freq: number) => number) | null = null;
export let wasmLerp: ((a: number, b: number, t: number) => number) | null = null;
export let wasmBatchMushroomSpawnCandidates: ((time: number, windX: number, windZ: number, windSpeed: number, objectCount: number, spawnThreshold: number, minDistance: number, maxDistance: number) => number) | null = null;
export let wasmUpdateFoliageBatch: ((...args: number[]) => void) | null = null;

/** New Physics exports */
export let wasmInitDynamicFoliageMemory: ((maxInstances: number) => number) | null = null;
export let wasmInitCollisionSystem: (() => void) | null = null;
export let wasmAddCollisionObject: ((type: number, x: number, y: number, z: number, r: number, h: number, p1: number, p2: number, p3: number) => void) | null = null;
export let wasmResolveGameCollisions: ((kickTrigger: number) => number) | null = null;
export let wasmCheckPositionValidity: ((x: number, z: number, radius: number) => number) | null = null;

/** Hot-path Foliage Animation exports (Migrated from TS) */
export let wasmSmoothWobble: ((noteBufferPtr: number, bufferSize: number, currentWobble: number, scale: number, maxAmplitude: number, minThreshold: number, smoothingRate: number) => number) | null = null;
export let wasmBatchGrowth: ((dataPtr: number, count: number) => void) | null = null;
export let wasmBatchBloom: ((dataPtr: number, count: number) => void) | null = null;
export let wasmBatchScaleAnimation: ((dataPtr: number, count: number) => void) | null = null;

/** Hot-path Physics exports (Migrated from TS) */
export let wasmBatchGroundHeight: ((positionsPtr: number, count: number, outputPtr: number) => void) | null = null;
export let wasmDampVelocity: ((velocityPtr: number, count: number, damping: number) => void) | null = null;
export let wasmBatchDistanceCalc: ((positionsPtr: number, count: number, camX: number, camY: number, camZ: number, outputPtr: number) => void) | null = null;
export let wasmBatchFrustumTest: ((positionsPtr: number, count: number, frustumPlanesPtr: number, outputPtr: number) => number) | null = null;
export let wasmBatchLODSelect: ((distancesPtr: number, count: number, lodThresholdsPtr: number, outputPtr: number) => number) | null = null;

/** Math functions from assembly/math.ts */
export let wasmHslToRgb: ((h: number, s: number, l: number) => number) | null = null;
export let wasmHash2D: ((x: number, y: number) => number) | null = null;
export let wasmValueNoise2D: ((x: number, y: number) => number) | null = null;
export let wasmFbm2D: ((x: number, y: number, octaves: number) => number) | null = null;
export let wasmDistSq2D: ((ax: number, ay: number, bx: number, by: number) => number) | null = null;
export let wasmDistSq3D: ((ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number) | null = null;
export let wasmSmoothstep: ((t: number) => number) | null = null;
export let wasmInverseLerp: ((a: number, b: number, value: number) => number) | null = null;

/** Batch functions from assembly/batch.ts */
export let wasmBatchHslToRgb: ((ptr: number, count: number) => void) | null = null;
export let wasmBatchSphereCull: ((positionsPtr: number, count: number, camX: number, camY: number, camZ: number, maxDist: number, outputPtr: number) => void) | null = null;
export let wasmBatchLerp: ((ptr: number, count: number) => void) | null = null;

/** Particle functions from assembly/particles.ts */
export let wasmUpdateParticles: ((positionsPtr: number, count: number, dt: number, gravity: number) => void) | null = null;
export let wasmSpawnBurst: ((outputPtr: number, count: number, centerX: number, centerY: number, centerZ: number, speed: number, time: number) => void) | null = null;

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

// =============================================================================
// CONSTANTS
// =============================================================================

/** Memory layout constants */
export const POSITION_OFFSET = 0;
export const ANIMATION_OFFSET = 4096;
export const OUTPUT_OFFSET = 8192;
export const PLAYER_STATE_OFFSET = 16384;

/** Animation type constants */
export const AnimationType = {
    BOUNCE: 1,
    SWAY: 2,
    WOBBLE: 3,
    HOP: 4
} as const;

/** Animation type values */
export type AnimationTypeValue = typeof AnimationType[keyof typeof AnimationType];

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * WASI stub functions
 */
export interface WasiStubs {
    fd_close: () => number;
    fd_seek: () => number;
    fd_write: () => number;
    fd_read: () => number;
    fd_fdstat_get: () => number;
    fd_prestat_get: () => number;
    fd_prestat_dir_name: () => number;
    path_open: () => number;
    environ_sizes_get: () => number;
    environ_get: () => number;
    proc_exit: () => void;
    clock_time_get: (id: number, precision: bigint, outPtr: number | bigint) => number;
}

/**
 * WASM import object
 */
export interface WasmImportObject {
    env: {
        abort: (msg: number, file: number, line: number, col: number) => void;
        seed: () => number;
        now: () => number;
    };
    wasi_snapshot_preview1: WasiStubs;
}

/**
 * Emscripten module interface
 */
export interface EmscriptenModule {
    wasmMemory?: WebAssembly.Memory;
    HEAP8?: Int8Array;
    HEAPU8?: Uint8Array;
    HEAP32?: Int32Array;
    HEAPF32?: Float32Array;
    _malloc?: (size: number) => number;
    _free?: (ptr: number) => void;
    [key: string]: unknown;
}

/**
 * Extended Emscripten module with potential exports
 */
export interface ExtendedEmscriptenModule extends EmscriptenModule {
    // Physics functions
    _updatePhysicsCPP?: (...args: number[]) => number;
    _initPhysics?: (...args: number[]) => void;
    _addObstaclesBatch?: (count: number) => void;
    _initObstacleBuffer?: (maxCount: number) => number;
    _setPlayerState?: (...args: number[]) => void;
    _getPlayerX?: () => number;
    _getPlayerY?: () => number;
    _getPlayerZ?: () => number;
    _getPlayerVX?: () => number;
    _getPlayerVY?: () => number;
    _getPlayerVZ?: () => number;
    _valueNoise2D?: (x: number, y: number) => number;
    _fbm?: (x: number, y: number, octaves: number) => number;
    _fastInvSqrt?: (x: number) => number;
    _fastDistance?: (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => number;
    _hash?: (x: number, y: number) => number;
    // Batch functions
    _batchShiver_c?: (...args: number[]) => void;
    _batchSpring_c?: (...args: number[]) => void;
    _batchFloat_c?: (...args: number[]) => void;
    _batchCloudBob_c?: (...args: number[]) => void;
    _deformWave_c?: (...args: number[]) => void;
    _deformJiggle_c?: (...args: number[]) => void;
    _deformWobble_c?: (...args: number[]) => void;
    _batchUpdateLODMatrices_c?: (...args: number[]) => void;
    _batchScaleMatrices_c?: (...args: number[]) => void;
    _batchFadeColors_c?: (...args: number[]) => void;
    _batchFrustumCull_c?: (...args: number[]) => void;
    _batchDistanceCullIndexed_c?: (...args: number[]) => void;
    // Fluid functions
    _fluidInit?: (size: number) => void;
    _fluidStep?: (dt: number, visc: number, diff: number) => void;
    _fluidAddDensity?: (x: number, y: number, amount: number) => void;
    _fluidAddVelocity?: (x: number, y: number, amountX: number, amountY: number) => void;
    _fluidGetDensityPtr?: () => number;
    _updateParticlesWASM?: (...args: number[]) => void;
    // Speaker and animation
    _calcSpeakerPulse?: (...args: number[]) => void;
    _getSpeakerScale?: () => number;
    // Arpeggio
    _calcArpeggioStep_c?: (...args: number[]) => void;
    _getArpeggioTargetStep_c?: () => number;
    _getArpeggioUnfurlStep_c?: () => number;
}

/**
 * Three.js Object3D-like interface for position
 */
export interface Positionable {
    position: {
        x: number;
        y: number;
        z: number;
    };
}

/**
 * Mushroom object with userData
 */
export interface Mushroom extends Positionable {
    userData: {
        radius?: number;
        capRadius?: number;
        capHeight?: number;
        isTrampoline?: boolean;
        colorIndex?: number;
    };
}

/**
 * Cave object with userData
 */
export interface Matrix4Like {
    elements: number[];
    clone: () => { elements: number[] };
}

export interface Vector3Like {
    x: number;
    y: number;
    z: number;
    clone: () => Vector3Like;
    applyMatrix4: (matrix: Matrix4Like) => Vector3Like;
}

export interface Cave extends Positionable {
    matrixWorld: Matrix4Like;
    userData: {
        isBlocked?: boolean;
        gatePosition: Vector3Like;
    };
}

/**
 * Cloud object with userData
 */
export interface Cloud extends Positionable {
    scale: {
        x: number;
        y: number;
        z: number;
    };
    userData: {
        tier?: number;
    };
}

/**
 * Trampoline object
 */
export interface Trampoline extends Positionable {
    userData: {
        capRadius?: number;
        capHeight?: number;
    };
}

/**
 * Material with shader info
 */
export interface MaterialInfo {
    vertexShaderId?: number;
    fragmentShaderId?: number;
    blendingMode?: number;
    flags?: number;
}

/**
 * Animation data entry
 */
export interface AnimationData {
    offset?: number;
    type?: number;
    originalY?: number;
    colorIndex?: number;
}

/**
 * Position data entry
 */
export interface PositionData {
    x?: number;
    y?: number;
    z?: number;
    radius?: number;
}

/**
 * Player state interface
 */
export interface PlayerState {
    position: {
        x: number;
        y: number;
        z: number;
    };
    velocity: {
        x: number;
        y: number;
        z: number;
    };
    isGrounded: boolean;
}

/**
 * Generic WASM export value type
 */
export type WasmExportValue = WebAssembly.ExportValue | ((...args: number[]) => number) | ((...args: number[]) => void);

/**
 * WASM exports interface
 */
export interface WasmExports {
    [key: string]: WasmExportValue | undefined;
    memory: WebAssembly.Memory;
    getGroundHeight: (x: number, z: number) => number;
    freqToHue: (freq: number) => number;
    lerp: (a: number, b: number, t: number) => number;
    batchMushroomSpawnCandidates?: (time: number, windX: number, windZ: number, windSpeed: number, objectCount: number, spawnThreshold: number, minDistance: number, maxDistance: number) => number;
    updateFoliageBatch?: (...args: number[]) => void;
    initDynamicFoliageMemory?: (maxInstances: number) => number;
    initCollisionSystem?: () => void;
    addCollisionObject?: (type: number, x: number, y: number, z: number, r: number, h: number, p1: number, p2: number, p3: number) => void;
    resolveGameCollisions?: (kickTrigger: number) => number;
    checkPositionValidity?: (x: number, z: number, radius: number) => number;
    addCollisionObjectsBatch?: (ptr: number, count: number) => void;
    malloc?: (size: number) => number;
    __new?: (size: number) => number;
    free?: (ptr: number) => void;
    __free?: (ptr: number) => void;
    batchDistanceCull?: (cameraX: number, cameraY: number, cameraZ: number, maxDistSq: number, objectCount: number) => number;
    // Hot-path Physics exports (from assembly/physics.ts)
    batchGroundHeight?: (positionsPtr: number, count: number, outputPtr: number) => void;
    dampVelocity?: (velocityPtr: number, count: number, damping: number) => void;
    batchDistanceCalc?: (positionsPtr: number, count: number, camX: number, camY: number, camZ: number, outputPtr: number) => void;
    batchFrustumTest?: (positionsPtr: number, count: number, frustumPlanesPtr: number, outputPtr: number) => number;
    batchLODSelect?: (distancesPtr: number, count: number, lodThresholdsPtr: number, outputPtr: number) => number;
    analyzeMaterials?: (offset: number, count: number) => number;
    getUniqueShaderCount?: () => number;
    batchAnimationCalc?: (time: number, intensity: number, kick: number, objectCount: number) => void;
    // Animation functions
    calcBounceY?: (time: number, offset: number, intensity: number, kick: number) => number;
    calcSwayRotZ?: (time: number, offset: number, intensity: number) => number;
    calcWobble?: (time: number, offset: number, intensity: number) => void;
    getWobbleX?: () => number;
    getWobbleZ?: () => number;
    checkCollision?: (playerX: number, playerZ: number, playerRadius: number, objectCount: number) => number;
    // Advanced animations
    calcAccordionStretch?: (animTime: number, offset: number, intensity: number) => void;
    getAccordionStretchY?: () => number;
    getAccordionWidthXZ?: () => number;
    calcFiberWhip?: (time: number, offset: number, leadVol: number, isActive: number, branchIndex: number) => void;
    getFiberBaseRotY?: () => number;
    getFiberBranchRotZ?: () => number;
    calcHopY?: (time: number, offset: number, intensity: number, kick: number) => number;
    calcShiver?: (time: number, offset: number, intensity: number) => void;
    getShiverRotX?: () => number;
    getShiverRotZ?: () => number;
    calcSpiralWave?: (time: number, offset: number, intensity: number, groove: number) => void;
    getSpiralRotY?: () => number;
    getSpiralYOffset?: () => number;
    getSpiralScale?: () => number;
    calcPrismRose?: (time: number, offset: number, kick: number, groove: number, isActive: number) => void;
    getPrismUnfurl?: () => number;
    getPrismSpin?: () => number;
    getPrismPulse?: () => number;
    getPrismHue?: () => number;
    calcArpeggioStep?: (currentUnfurl: number, currentTarget: number, lastTrigger: number, arpeggioActive: number, noteTrigger: number, maxSteps: number) => void;
    getArpeggioTargetStep?: () => number;
    getArpeggioUnfurlStep?: () => number;
    lerpColor?: (color1: number, color2: number, t: number) => number;
    calcRainDropY?: (startY: number, time: number, speed: number, cycleHeight: number) => number;
    calcFloatingParticle?: (baseX: number, baseY: number, baseZ: number, time: number, offset: number, amplitude: number) => void;
    getParticleX?: () => number;
    getParticleY?: () => number;
    getParticleZ?: () => number;
    // New math functions from assembly/math.ts
    hslToRgb?: (h: number, s: number, l: number) => number;
    hash2D?: (x: number, y: number) => number;
    valueNoise2D?: (x: number, y: number) => number;
    fbm2D?: (x: number, y: number, octaves: number) => number;
    distSq2D?: (ax: number, ay: number, bx: number, by: number) => number;
    distSq3D?: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number;
    smoothstep?: (t: number) => number;
    inverseLerp?: (a: number, b: number, value: number) => number;
    // New batch functions from assembly/batch.ts
    batchHslToRgb?: (ptr: number, count: number) => void;
    batchSphereCull?: (positionsPtr: number, count: number, camX: number, camY: number, camZ: number, maxDist: number, outputPtr: number) => void;
    batchLerp?: (ptr: number, count: number) => void;
    // New particle functions from assembly/particles.ts
    updateParticles?: (positionsPtr: number, count: number, dt: number, gravity: number) => void;
    spawnBurst?: (outputPtr: number, count: number, centerX: number, centerY: number, centerZ: number, speed: number, time: number) => void;
}

// Extend window for global functions
declare global {
    interface Window {
        setLoadingStatus?: (msg: string) => void;
        NativeWebAssembly?: typeof WebAssembly;
    }
}

// =============================================================================
// WASM EXPORT VALIDATION
// =============================================================================

/**
 * Validate that the required AssemblyScript WASM exports exist and return sane
 * values. Throws an Error with a descriptive message if validation fails.
 * Exported so it can be used in tests and external tooling.
 * @param instance - The instantiated WebAssembly instance to inspect
 */
export function validateWasmExports(instance: WebAssembly.Instance): void {
    const exports = instance.exports as WasmExports;

    // Required exports: memory and the critical getGroundHeight function
    const required = ['memory', 'getGroundHeight'] as const;
    for (const name of required) {
        if (!exports[name]) {
            throw new Error(`[WASM] Missing required export: ${name}`);
        }
    }

    // Smoke test: getGroundHeight(0, 0) must return a finite number
    const sample = exports.getGroundHeight(0, 0);
    if (typeof sample !== 'number' || !isFinite(sample)) {
        throw new Error(`[WASM] Smoke test failed: getGroundHeight(0,0) returned ${sample}`);
    }
}

// =============================================================================
// INITIALIZATION: TOP-LEVEL AWAIT
// =============================================================================

/** Retry configuration for AssemblyScript WASM initialisation (exported for tests) */
export const WASM_MAX_RETRIES = 3;
export const WASM_RETRY_DELAYS_MS = [1000, 2000, 4000];

// WASI stubs with BigInt Safety (Required for AS environment)
const wasiStubs: WasiStubs = {
    fd_close: () => 0,
    fd_seek: () => 0,
    fd_write: () => 0,
    fd_read: () => 0,
    fd_fdstat_get: () => 0,
    fd_prestat_get: () => 0,
    fd_prestat_dir_name: () => 0,
    path_open: () => 0,
    environ_sizes_get: () => 0,
    environ_get: () => 0,
    proc_exit: () => { },
    clock_time_get: (id: number, precision: bigint, outPtr: number | bigint) => {
        // Robust clock_time_get handling BigInt mixing
        const now = BigInt(Date.now()) * 1000000n;
        if (wasmMemory) {
            const idx = typeof outPtr === 'bigint' ? Number(outPtr) : outPtr;
            const view = new BigInt64Array(wasmMemory.buffer);
            if (idx >= 0 && (idx >> 3) < view.length) {
                view[idx >> 3] = now;
            }
        }
        return 0;
    },
};

const importObject: WasmImportObject = {
    env: {
        abort: (msg: number, file: number, line: number, col: number) => {
            console.error(`WASM abort at ${file}:${line}:${col}: ${msg}`);
        },
        seed: () => Date.now() * Math.random(),
        now: () => Date.now()
    },
    wasi_snapshot_preview1: wasiStubs
};

/**
 * Helper to populate all cached function references from a fully instantiated
 * AssemblyScript WASM instance. Called once initialization succeeds.
 */
function cacheWasmFunctions(instance: WebAssembly.Instance): void {
    wasmInstance = instance;
    const exports = instance.exports as WasmExports;

    if (exports.memory) {
        wasmMemory = exports.memory;
        const memBuffer = wasmMemory.buffer;
        positionView = new Float32Array(memBuffer, POSITION_OFFSET, 1024);
        animationView = new Float32Array(memBuffer, ANIMATION_OFFSET, 1024);
        outputView = new Float32Array(memBuffer, OUTPUT_OFFSET, 1024);
        playerStateView = new Float32Array(memBuffer, PLAYER_STATE_OFFSET, 8);
    }

    wasmGetGroundHeight = exports.getGroundHeight;
    wasmFreqToHue = exports.freqToHue;
    wasmLerp = exports.lerp;
    wasmBatchMushroomSpawnCandidates = exports.batchMushroomSpawnCandidates || null;
    wasmUpdateFoliageBatch = exports.updateFoliageBatch || null;

    wasmInitDynamicFoliageMemory = exports.initDynamicFoliageMemory || null;
    wasmInitCollisionSystem = exports.initCollisionSystem || null;
    wasmAddCollisionObject = exports.addCollisionObject || null;
    wasmResolveGameCollisions = exports.resolveGameCollisions || null;
    wasmCheckPositionValidity = exports.checkPositionValidity || null;

    wasmBatchGroundHeight = exports.batchGroundHeight || null;
    wasmDampVelocity = exports.dampVelocity || null;
    wasmBatchDistanceCalc = exports.batchDistanceCalc || null;
    wasmBatchFrustumTest = exports.batchFrustumTest || null;
    wasmBatchLODSelect = exports.batchLODSelect || null;

    wasmHslToRgb = exports.hslToRgb || null;
    wasmHash2D = exports.hash2D || null;
    wasmValueNoise2D = exports.valueNoise2D || null;
    wasmFbm2D = exports.fbm2D || null;
    wasmDistSq2D = exports.distSq2D || null;
    wasmDistSq3D = exports.distSq3D || null;
    wasmSmoothstep = exports.smoothstep || null;
    wasmInverseLerp = exports.inverseLerp || null;

    wasmBatchHslToRgb = exports.batchHslToRgb || null;
    wasmBatchSphereCull = exports.batchSphereCull || null;
    wasmBatchLerp = exports.batchLerp || null;

    wasmUpdateParticles = exports.updateParticles || null;
    wasmSpawnBurst = exports.spawnBurst || null;
}

// Immediately initialize the AssemblyScript WASM module with retry logic.
// This blocks module execution until the WASM is ready (Vite handles this via
// top-level await wrapper). Up to WASM_MAX_RETRIES attempts are made with
// exponential backoff; if all fail, JS fallbacks remain active.
{
    let lastError: unknown;
    for (let attempt = 0; attempt < WASM_MAX_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                console.warn(`[WASM] AS init attempt ${attempt + 1}/${WASM_MAX_RETRIES}...`);
                await new Promise(r => setTimeout(r, WASM_RETRY_DELAYS_MS[attempt - 1]));
            }

            const instance = await initCandyPhysics(importObject);
            validateWasmExports(instance);
            cacheWasmFunctions(instance);

            console.log('[WASM] AssemblyScript module initialized via Top-Level Await');
            lastError = null;
            break;
        } catch (e) {
            lastError = e;
            console.error(`[WASM] AS init attempt ${attempt + 1}/${WASM_MAX_RETRIES} failed:`, e);
        }
    }

    if (lastError) {
        // All retries exhausted — JS fallbacks will kick in automatically because
        // all function pointers remain null.
        console.error('[WASM] All AssemblyScript init attempts failed. JS fallbacks active.', lastError);
        // Notify loading screen so the user sees a non-fatal warning (not a full
        // fatal error since JS fallbacks allow the game to continue).
        try {
            setWasmPhase('Physics engine unavailable - using JS fallback', 0);
        } catch (_) { /* loading screen may not be ready yet */ }
    }
}

// =============================================================================
// INITIALIZE C++ EMSCRIPTEN FUNCTIONS
// =============================================================================

/**
 * Initialize cached C++ Emscripten function references.
 * Call this after emscriptenInstance is loaded.
 */
export function initCppFunctions(): void {
    if (!emscriptenInstance) return;
    
    // Math functions from emscripten/math.cpp
    cppValueNoise2DSimd4 = getNativeFunc('valueNoise2D_simd4');
    cppFbm2DSimd4 = getNativeFunc('fbm2D_simd4');
    cppBatchGroundHeightSimd = getNativeFunc('batchGroundHeight_simd');
    cppBatchValueNoiseOmp = getNativeFunc('batchValueNoise_omp');
    cppBatchFbmOmp = getNativeFunc('batchFbm_omp');
    cppBatchDistSq3DOmp = getNativeFunc('batchDistSq3D_omp');
    cppFastSin = getNativeFunc('fastSin');
    cppFastCos = getNativeFunc('fastCos');
    cppFastPow2 = getNativeFunc('fastPow2');
    
    // Animation batch functions from emscripten/animation_batch.cpp
    cppBatchShiverSimd = getNativeFunc('batchShiver_simd');
    cppBatchSpringSimd = getNativeFunc('batchSpring_simd');
    cppBatchFloatSimd = getNativeFunc('batchFloat_simd');
    cppBatchCloudBobSimd = getNativeFunc('batchCloudBob_simd');
    cppBatchVineSwaySimd = getNativeFunc('batchVineSway_simd');
    cppBatchGeyserEruptC = getNativeFunc('batchGeyserErupt_c');
    cppBatchRetriggerSimd = getNativeFunc('batchRetrigger_simd');
    
    console.log('[WASM] C++ Emscripten functions initialized');
}

// =============================================================================
// EMSCRIPTEN MODULE LOADER
// =============================================================================

let bootstrapStarted = false;

async function startBootstrapIfAvailable(instance: ExtendedEmscriptenModule): Promise<void> {
    if (!instance || bootstrapStarted) return;
    try {
        const { startBootstrap } = await import('./bootstrap-loader.ts');
        if (startBootstrap && startBootstrap(instance)) {
            bootstrapStarted = true;
            console.log('[WASM] Bootstrap terrain pre-computation started');
        }
    } catch (e) {
        console.warn('[WASM] Bootstrap loader error:', e);
    }
}

/**
 * Update progress UI
 * @param msg - Progress message to display
 */
export async function updateWasmProgress(percent: number, msg: string): Promise<void> {
    updateProgress('wasm-init', percent, msg);
    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.textContent = msg;
    }
    console.log('[WASM Progress]', msg);
    await new Promise(r => setTimeout(r, 20));
}

/**
 * Load Emscripten Module (Pthreads/Worker Version)
 * @param forceSingleThreaded - Force single-threaded mode
 * @returns True if module loaded successfully
 */
export async function loadEmscriptenModule(forceSingleThreaded = false): Promise<boolean> {
    // SINGLE-THREADED FALLBACK STRATEGY:
    // 1. If SharedArrayBuffer is missing, forcing ST.
    // 2. If forceSingleThreaded=true is passed (recursive fallback), use ST.
    // 3. We attempt to load 'candy_native.wasm' (threaded).
    // 4. If that fails (file missing, instantiation error, worker error), we recursively call loadEmscriptenModule(true).

    const canUseThreads = typeof SharedArrayBuffer !== 'undefined' && !forceSingleThreaded;

    try {
        await updateWasmProgress(10, 'Loading Native Engine...');

        let wasmFilename = 'candy_native.wasm';
        let jsFilename = 'candy_native.js';
        let isThreaded = true;

        if (!canUseThreads) {
            console.warn('[Native] Using Single-Threaded Fallback (No SharedArrayBuffer or forced ST)');
            wasmFilename = 'candy_native_st.wasm';
            jsFilename = 'candy_native_st.js';
            isThreaded = false;
        }

        // 2. Check if WASM file exists and RESOLVE THE CORRECT PATH
        const wasmCheck = await checkWasmFileExists(wasmFilename);
        if (!wasmCheck.exists) {
            console.log(`[WASM] ${wasmFilename} not found. Using JS fallback.`);
            // If threaded failed (e.g. file missing), try ST if we haven't already
            if (isThreaded) {
                 return loadEmscriptenModule(true);
            }
            return false;
        }

        // Construct the full resolved path based on checkWasmFileExists result
        const prefix = wasmCheck.path || '';
        const cleanPrefix = prefix.endsWith('/') ? prefix : (prefix ? `${prefix}/` : '');
        const resolvedWasmPath = `${cleanPrefix}${wasmFilename}`;
        const resolvedJsPath = jsFilename.includes('://') ? jsFilename : `${cleanPrefix}${jsFilename}`;

        // Load the JS factory
        let createCandyNative: ((config: Record<string, unknown>) => Promise<ExtendedEmscriptenModule>) | undefined;
        try {
            const module = await import(/* @vite-ignore */ `${resolvedJsPath}?v=${Date.now()}`);
            createCandyNative = module.default;
        } catch (e) {
            console.log(`[WASM] ${jsFilename} not found. Fallback?`, e);
            if (isThreaded) return loadEmscriptenModule(true);
            return false;
        }

        if (!createCandyNative) return false;

        if (isThreaded) {
            await updateWasmProgress(30, 'Spawning Physics Workers...');
        } else {
            await updateWasmProgress(30, 'Initializing Physics (ST)...');
        }

        // Apply aliases (patches NativeWA if available)
        const restore = patchWasmInstantiateAliases();

        // MANUAL FETCH: Pre-fetch binary
        let wasmBinary: ArrayBuffer | null = null;
        try {
             const resp = await fetch(resolvedWasmPath);
             if (resp.ok) {
                 wasmBinary = await resp.arrayBuffer();
             } else {
                 console.warn(`[WASM] Pre-fetch failed with status: ${resp.status}`);
             }
        } catch(e) {
            console.warn("[WASM] Failed to pre-fetch binary:", e);
            // Help diagnose common server configuration issues
            if (e instanceof Error && e.message.toLowerCase().includes("content decoding")) {
                console.error("[WASM] CRITICAL: Content Decoding Failed! The server is likely sending 'Content-Encoding: gzip' for an uncompressed .wasm file. This is a common issue with Vite preview/dev servers.");
            }
        }

        // POLYFILL BYPASS: 
        // If the environment has a NativeWebAssembly object that differs from window.WebAssembly (polyfill),
        // we MUST swap it in. This ensures Emscripten creates a valid native Memory object and
        // that the Module we compile is a real WebAssembly.Module, transferable to the Worker.
        const originalWA = window.WebAssembly;
        const nativeWA = window.NativeWebAssembly;
        let swapped = false;

        if (nativeWA && nativeWA !== originalWA) {
            console.log('[WASM] Swapping to Native WebAssembly for Emscripten init');
            window.WebAssembly = nativeWA;
            swapped = true;
        }

        try {
            const config: Record<string, unknown> = {
                // Critical: Explicitly tell Emscripten where to find the file
                locateFile: (path: string, scriptDirectory: string) => {
                    if (path.endsWith('.wasm')) return resolvedWasmPath;
                    return scriptDirectory + path;
                },
                print: (text: string) => console.log('[Native]', text),
                printErr: (text: string) => console.warn('[Native Err]', text),
                
                // IMPORTANT: Do NOT set wasmBinary in config. 
                // Bypass internal instantiation logic completely
                instantiateWasm: (imports: WebAssembly.Imports, successCallback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
                    console.log('[Native] Manual instantiation hook triggered');

                    const run = async () => {
                        try {
                            let bytes = wasmBinary;
                            
                            // Fallback fetch if pre-fetch failed
                            if (!bytes) {
                                console.log('[Native] Fetching binary inside hook...');
                                const response = await fetch(resolvedWasmPath);
                                if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
                                bytes = await response.arrayBuffer();
                            }

                            // Use the CURRENT global WebAssembly (which should be Native if swapped)
                            const WA = window.WebAssembly;

                            // We use instantiate() directly instead of compile() + instantiate().
                            // This works around missing compile() in some polyfills and ensures 
                            // we get a valid Module/Instance pair from the native implementation.
                            const result = await WA.instantiate(bytes, imports);
                            
                            console.log('[Native] Manual instantiation success');
                            
                            // Standardize result
                            const instance = result.instance;
                            const module = result.module || null; // Some polyfills might not return module

                            // We must pass a valid Module object if Pthreads are used, 
                            // so the worker can receive it.
                            successCallback(instance, module!);

                        } catch (e) {
                            console.error('[Native] Manual instantiation failed:', e);
                        }
                    };

                    run();
                    return {}; // Async indicates to Emscripten we are handling it
                }
            };

            // Initialize Emscripten (will use Native WA for Memory creation)
            emscriptenInstance = await createCandyNative(config);

            console.log(`[WASM] Emscripten ${isThreaded ? 'Pthreads' : 'Single-Threaded'} Ready`);
        } catch (e) {
            console.warn('[WASM] Instantiation failed:', e);
            
            // If threaded failed, try ST (recursive call will handle clean up/restore via finally)
            if (isThreaded) {
                console.log('[WASM] Falling back to Single-Threaded build...');
                // We must restore before recursing, which finally block does
                return loadEmscriptenModule(true); 
            }
            return false;
        } finally {
            // Restore original environment
            if (swapped) {
                window.WebAssembly = originalWA;
                console.log('[WASM] Restored original WebAssembly');
            }
            restore();
        }

        if (emscriptenInstance!.wasmMemory) {
            emscriptenMemory = emscriptenInstance!.wasmMemory.buffer as ArrayBuffer;
        } else if (emscriptenInstance!.HEAP8) {
            emscriptenMemory = emscriptenInstance!.HEAP8.buffer as ArrayBuffer;
        }

        // Initialize cached C++ function references
        initCppFunctions();

        return true;
    } catch (e) {
        console.warn('[WASM] Native module unavailable:', e);
        return false;
    }
}

// =============================================================================
// MEMORY ACCESSORS
// =============================================================================

/**
 * Get the WASM memory buffer
 * @returns The WASM memory ArrayBuffer or null if not initialized
 */
export function getWasmMemory(): ArrayBuffer | null {
    return wasmMemory ? wasmMemory.buffer as ArrayBuffer : null;
}

/**
 * Get the Emscripten memory buffer
 * @returns The Emscripten memory ArrayBuffer or null if not initialized
 */
export function getEmscriptenMemory(): ArrayBuffer | null {
    return emscriptenMemory;
}

/**
 * Get a native C++ function from the Emscripten module.
 * @param name - Function name without underscore prefix
 * @returns The function or null if not found
 */
export function getNativeFunc(name: string): ((...args: number[]) => number) | null {
    if (!emscriptenInstance) return null;
    const inst = emscriptenInstance as ExtendedEmscriptenModule;
    const underscoreName = '_' + name;
    if (typeof inst[underscoreName] === 'function') {
        return inst[underscoreName] as (...args: number[]) => number;
    }
    if (typeof inst[name] === 'function') {
        return inst[name] as (...args: number[]) => number;
    }
    return null;
}

// =============================================================================
// STATE CHECKERS
// =============================================================================

/**
 * Check if WASM is ready
 * @returns True if WASM instance is initialized
 */
export function isWasmReady(): boolean { 
    return wasmInstance !== null; 
}

/**
 * Check if Emscripten is ready
 * @returns True if Emscripten instance is initialized
 */
export function isEmscriptenReady(): boolean { 
    return emscriptenInstance !== null; 
}

/**
 * Get the WASM instance
 * @returns The WASM instance or null
 */
export function getWasmInstance(): WebAssembly.Instance | null { 
    return wasmInstance; 
}

/**
 * Get the Emscripten instance
 * @returns The Emscripten instance or null
 */
export function getEmscriptenInstance(): EmscriptenModule | null {
    return emscriptenInstance;
}

// =============================================================================
// INITIALIZATION FUNCTIONS
// =============================================================================

/** Options for parallel WASM initialization */
export interface InitWasmParallelOptions {
    onProgress?: (phase: string, message: string) => void;
}

/** Retry configuration for Emscripten module initialisation (exported for tests) */
export const EMCC_MAX_RETRIES = 3;
export const EMCC_RETRY_DELAYS_MS = [1000, 2000, 4000];

// NOTE: This function is now a wrapper for Emscripten loading with retry logic
// and user-visible progress reporting. The main AssemblyScript WASM is already
// loaded via Top-Level Await before this is called.
export async function initWasm(): Promise<boolean> {
    // Warn (not error) if the AS instance is somehow missing
    if (!wasmInstance) {
        console.warn('[WASM] AS instance missing even after TLA?');
    }

    const startButton = document.getElementById('startButton');
    if (startButton) {
        (startButton as HTMLButtonElement).disabled = true;
        startButton.setAttribute('aria-busy', 'true');
        startButton.setAttribute('title', 'Please wait while game assets load...');
        startButton.style.cursor = 'wait';
    }

    console.log('[WASM] initWasm called - loading Emscripten with retry');

    let loaded = false;
    let lastError: unknown;

    for (let attempt = 0; attempt < EMCC_MAX_RETRIES; attempt++) {
        try {
            setWasmPhase(
                `Booting Physics Engine… (Attempt ${attempt + 1}/${EMCC_MAX_RETRIES})`,
                Math.round((attempt / EMCC_MAX_RETRIES) * 80)
            );

            const result = await loadEmscriptenModule();

            if (result && emscriptenInstance) {
                await startBootstrapIfAvailable(emscriptenInstance);
                setWasmPhase('Physics Engine ready', 100);
                loaded = true;
                lastError = null;
                break;
            }

            // loadEmscriptenModule returned false (file missing / optional skip) —
            // not a hard error; fall through to allow JS fallbacks.
            console.warn('[WASM] Emscripten module unavailable (optional). JS fallbacks remain active.');
            loaded = true; // treated as "done" — fallbacks are fine
            lastError = null;
            break;
        } catch (err) {
            lastError = err;
            console.error(`[WASM] Emscripten init attempt ${attempt + 1}/${EMCC_MAX_RETRIES} failed:`, err);

            if (attempt < EMCC_MAX_RETRIES - 1) {
                // Wait before next retry (exponential backoff)
                await new Promise(r => setTimeout(r, EMCC_RETRY_DELAYS_MS[attempt]));
            } else {
                // All attempts exhausted
                setWasmError(
                    'Physics engine failed to load. Check your network connection and reload the page.'
                );
            }
        }
    }

    if (startButton) {
        (startButton as HTMLButtonElement).disabled = false;
        startButton.setAttribute('aria-busy', 'false');
        startButton.removeAttribute('title');
        startButton.textContent = 'Start Exploration 🚀';
        startButton.style.cursor = 'pointer';

        // ♿ Aria: Announce that the loading is complete and the button is ready
        import('../ui/announcer.ts').then(({ announce }) => {
            announce('Game ready. Press Enter to start exploration.', 'assertive');
        });
    }

    if (!loaded && lastError) {
        console.error('[WASM] initWasm: all retries failed. JS fallbacks active.', lastError);
        return false;
    }

    return true;
}

// Deprecated: Parallel loading is no longer needed as AS is bundled synchronously (via TLA)
export async function initWasmParallel(options: InitWasmParallelOptions = {}): Promise<boolean> {
    console.log('[WASM] initWasmParallel routed to standard initWasm');
    if (options.onProgress) {
        // Simple shim for progress
        options.onProgress('start', 'Initializing...');
    }
    return initWasm();
}

// Re-exports from orchestrator
export { 
    LOADING_PHASES, 
    isSharedMemoryAvailable,
    initSharedBuffer,
    getSharedBuffer,
    createPlaceholderScene,
    removePlaceholderScene 
} from './wasm-orchestrator.ts';
