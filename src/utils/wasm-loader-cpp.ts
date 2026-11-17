import { emMemoryBuffer } from './native-memory.ts';
import type { EmscriptenModule } from './wasm-loader-types.ts';
import type { CppExportName, CppExports } from './native-exports.generated.ts';

// =============================================================================
// NATIVE FUNCTION LOOKUP
// =============================================================================
// These read `emscriptenInstance` (declared below), so they live here rather
// than in wasm-loader-core.ts, which re-exports this module. Keeping them in
// core made this module import core back (#1827).

/**
 * Get a native C++ function from the Emscripten module, typed by its C name
 * (src/utils/native-exports.generated.ts), so tsc checks every argument.
 * @param name - Function name without underscore prefix
 * @returns The function or null if the module is not loaded or lacks it
 */
export function getNativeFunc<K extends CppExportName>(name: K): CppExports[K] | null {
    if (!emscriptenInstance) return null;
    const inst = emscriptenInstance as Record<string, unknown>;
    const fn = inst['_' + name] ?? inst[name];
    return typeof fn === 'function' ? (fn as CppExports[K]) : null;
}

/** Same as getNativeFunc; kept for call sites that read better saying "void". */
export const getNativeFuncVoid = getNativeFunc;

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

export let initPhysics: CppExports['initPhysics'] | null = null;
export let updatePhysicsCPP: CppExports['updatePhysicsCPP'] | null = null;
export let cppUpdateBoids: CppExports['updateBoids_c'] | null = null;
export let setPlayerState: CppExports['setPlayerState'] | null = null;
export let getPlayerX: CppExports['getPlayerX'] | null = null;
export let getPlayerY: CppExports['getPlayerY'] | null = null;
export let getPlayerZ: CppExports['getPlayerZ'] | null = null;
export let getPlayerVX: CppExports['getPlayerVX'] | null = null;
export let getPlayerVY: CppExports['getPlayerVY'] | null = null;
export let getPlayerVZ: CppExports['getPlayerVZ'] | null = null;

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
    cppUpdateBoids = getNativeFuncVoid('updateBoids_c');

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
