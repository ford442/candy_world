import { emMemoryBuffer } from './native-memory.ts';
import type { EmscriptenModule, ExtendedEmscriptenModule } from './wasm-loader-types.ts';

// =============================================================================
// NATIVE FUNCTION LOOKUP
// =============================================================================
// These read `emscriptenInstance` (declared below), so they live here rather
// than in wasm-loader-core.ts, which re-exports this module. Keeping them in
// core made this module import core back (#1827).

/**
 * Get a native C++ function from the Emscripten module.
 * @param name - Function name without underscore prefix
 * @returns The function or null if not found
 */
export function getNativeFunc<T extends (...args: any[]) => number>(name: string): T | null {
    if (!emscriptenInstance) return null;
    const inst = emscriptenInstance as ExtendedEmscriptenModule;
    const underscoreName = '_' + name;
    if (typeof inst[underscoreName] === 'function') {
        return inst[underscoreName] as T;
    }
    if (typeof inst[name] === 'function') {
        return inst[name] as T;
    }
    return null;
}

/**
 * Get a native C++ function that returns void.
 */
export function getNativeFuncVoid<T extends (...args: any[]) => void>(name: string): T | null {
    if (!emscriptenInstance) return null;
    const inst = emscriptenInstance as ExtendedEmscriptenModule;
    const underscoreName = '_' + name;
    if (typeof inst[underscoreName] === 'function') {
        return inst[underscoreName] as T;
    }
    if (typeof inst[name] === 'function') {
        return inst[name] as T;
    }
    return null;
}

// =============================================================================
// C++ EMSCRIPTEN FUNCTION REFERENCES (CACHED)
// =============================================================================

export let cppBatchGroundHeightSimd:
    ((positionsPtr: number, count: number, outputPtr: number) => void) | null = null;

/** Unified ground height from emscripten/ground.cpp */
export let cppGetUnifiedGroundHeight: ((x: number, z: number, nowMs: number) => number) | null =
    null;
export let cppBatchUnifiedGroundHeight:
    ((positionsPtr: number, count: number, outputPtr: number, nowMs: number) => void) | null = null;
export let cppClearGroundPlatforms: (() => void) | null = null;
export let cppAddGroundPlatform:
    ((minX: number, maxX: number, minZ: number, maxZ: number, maxY: number) => void) | null = null;
export let cppInvalidateGroundCache: (() => void) | null = null;
export let cppSetGroundCacheTTL: ((seconds: number) => void) | null = null;

/** Foliage interaction batches from emscripten/foliage_interact.cpp */
export let cppBatchGeyserLaunch:
    | ((
          px: number,
          py: number,
          pz: number,
          pvy: number,
          delta: number,
          geysersPtr: number,
          count: number,
          outPtr: number
      ) => void)
    | null = null;
export let cppBatchPadForces:
    | ((
          px: number,
          py: number,
          pz: number,
          pvy: number,
          padsPtr: number,
          count: number,
          outPtr: number
      ) => void)
    | null = null;
export let cppBatchVineInteraction:
    | ((
          px: number,
          py: number,
          pz: number,
          pvx: number,
          pvy: number,
          pvz: number,
          vinesPtr: number,
          count: number,
          outPtr: number
      ) => void)
    | null = null;
export let cppCalcVineDetachImpulse:
    | ((
          length: number,
          swingAngle: number,
          swingAngularVel: number,
          planeX: number,
          planeZ: number,
          outPtr: number
      ) => void)
    | null = null;


/** Emscripten module (native C functions) */
export let emscriptenInstance: EmscriptenModule | null = null;
/** Snapshot taken at load; may be stale after memory growth. Use getEmscriptenMemory(). */
export let emscriptenMemory: ArrayBufferLike | null = null;

export let initPhysics: ((...args: number[]) => number) | null = null;
export let updatePhysicsCPP: ((...args: number[]) => number) | null = null;
export let setPlayerState: ((...args: number[]) => number) | null = null;
export let getPlayerX: ((...args: number[]) => number) | null = null;
export let getPlayerY: ((...args: number[]) => number) | null = null;
export let getPlayerZ: ((...args: number[]) => number) | null = null;
export let getPlayerVX: ((...args: number[]) => number) | null = null;
export let getPlayerVY: ((...args: number[]) => number) | null = null;
export let getPlayerVZ: ((...args: number[]) => number) | null = null;

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
    cppBatchGroundHeightSimd = getNativeFuncVoid('batchGroundHeight_simd');

    // Unified ground (emscripten/ground.cpp)
    cppGetUnifiedGroundHeight = getNativeFunc('getUnifiedGroundHeight');
    cppBatchUnifiedGroundHeight = getNativeFuncVoid('batchUnifiedGroundHeight');
    cppClearGroundPlatforms = getNativeFuncVoid('clearGroundPlatforms');
    cppAddGroundPlatform = getNativeFuncVoid('addGroundPlatform');
    cppInvalidateGroundCache = getNativeFuncVoid('invalidateGroundCache');
    cppSetGroundCacheTTL = getNativeFuncVoid('setGroundCacheTTL');

    // Foliage interaction (emscripten/foliage_interact.cpp)
    cppBatchGeyserLaunch = getNativeFuncVoid('batchGeyserLaunch_c');
    cppBatchPadForces = getNativeFuncVoid('batchPadForces_c');
    cppBatchVineInteraction = getNativeFuncVoid('batchVineInteraction_c');
    cppCalcVineDetachImpulse = getNativeFuncVoid('calcVineDetachImpulse_c');

    // Physics
    initPhysics = getNativeFunc('initPhysics');
    updatePhysicsCPP = getNativeFunc('updatePhysicsCPP');

    // Player & Math fallbacks
    setPlayerState = getNativeFunc('setPlayerState');
    getPlayerX = getNativeFunc('getPlayerX');
    getPlayerY = getNativeFunc('getPlayerY');
    getPlayerZ = getNativeFunc('getPlayerZ');
    getPlayerVX = getNativeFunc('getPlayerVX');
    getPlayerVY = getNativeFunc('getPlayerVY');
    getPlayerVZ = getNativeFunc('getPlayerVZ');

    console.log('[WASM] C++ Physics & Math functions mapped successfully');
}

export function setEmscriptenMemory(val: ArrayBuffer | null) {
    emscriptenMemory = val;
}

/**
 * Current Emscripten memory buffer. Read fresh from the module because
 * ALLOW_MEMORY_GROWTH detaches (ST) or outgrows (MT) any buffer cached earlier;
 * prefer this over the `emscriptenMemory` snapshot.
 */
export function getEmscriptenMemory(): ArrayBufferLike | null {
    return emMemoryBuffer(emscriptenInstance) ?? emscriptenMemory;
}
