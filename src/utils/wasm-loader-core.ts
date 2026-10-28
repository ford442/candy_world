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

import { createNativeModule, firstNativeModule } from './native-instantiate.ts';
import { isSharedMemoryAvailable } from './wasm-orchestrator.ts';
import { checkWasmFileExists, patchWasmInstantiateAliases } from './wasm-utils.ts';

// Vite's built-in `?init` WASM import (no plugin needed)
import initCandyPhysics from '../wasm/candy_physics.wasm?init';
import { bootProgress } from './boot-progress.ts';
import { log } from './log.ts';
import { bindAssemblyScriptMemory } from './native-memory.ts';
import {
    POSITION_OFFSET,
    POSITION_BYTES,
    ANIMATION_OFFSET,
    ANIMATION_BYTES,
    OUTPUT_OFFSET,
    OUTPUT_BYTES,
    PLAYER_STATE_OFFSET,
    PLAYER_STATE_BYTES,
} from './native-memory-layout.ts';

// =============================================================================
// STATE EXPORTS
// =============================================================================

/** WASM instance and memory */
export let wasmInstance: WebAssembly.Instance | null = null;
export let wasmMemory: WebAssembly.Memory | null = null;
export let positionView: Float32Array | null = null; // Float32Array for object positions
export let animationView: Float32Array | null = null; // Float32Array for animation data
export let outputView: Float32Array | null = null; // Float32Array for reading results
export let playerStateView: Float32Array | null = null; // Float32Array for player physics state

/** Cached WASM function references */
export let wasmGetGroundHeight: ((x: number, z: number) => number) | null = null;
export let wasmFreqToHue: ((freq: number) => number) | null = null;
export let wasmBatchMushroomSpawnCandidates:
    | ((
          time: number,
          windX: number,
          windZ: number,
          windSpeed: number,
          objectCount: number,
          spawnThreshold: number,
          minDistance: number,
          maxDistance: number
      ) => number)
    | null = null;

/** New Physics exports */
export let wasmInitDynamicFoliageMemory: ((maxInstances: number) => number) | null = null;
export let wasmInitCollisionSystem: (() => void) | null = null;
export let wasmAddCollisionObject:
    | ((
          type: number,
          x: number,
          y: number,
          z: number,
          r: number,
          h: number,
          p1: number,
          p2: number,
          p3: number
      ) => void)
    | null = null;
export let wasmResolveGameCollisions: ((kickTrigger: number) => number) | null = null;
export let wasmCheckPositionValidity: ((x: number, z: number, radius: number) => number) | null =
    null;
/** Fauna boids from assembly/boids.ts (ptr,count,dt,playerX,playerZ,time) */
export let wasmUpdateBoids:
    | ((
          boidsPtr: number,
          count: number,
          dt: number,
          playerX: number,
          playerZ: number,
          time: number
      ) => void)
    | null = null;
export let cppUpdateBoids:
    | ((
          boidsPtr: number,
          count: number,
          dt: number,
          playerX: number,
          playerZ: number,
          time: number
      ) => void)
    | null = null;

/** Hot-path Foliage Animation exports (Migrated from TS) */
export let wasmSmoothWobble:
    | ((
          noteBufferPtr: number,
          bufferSize: number,
          currentWobble: number,
          scale: number,
          maxAmplitude: number,
          minThreshold: number,
          smoothingRate: number
      ) => number)
    | null = null;
export const wasmBatchGrowth: ((dataPtr: number, count: number) => void) | null = null;
export const wasmBatchBloom: ((dataPtr: number, count: number) => void) | null = null;
export const wasmBatchScaleAnimation: ((dataPtr: number, count: number) => void) | null = null;


/** Hot-path Physics exports (Migrated from TS) */
export let wasmBatchGroundHeight:
    ((positionsPtr: number, count: number, outputPtr: number) => void) | null = null;
/** Unified ground height (assembly/ground.ts) */
export let wasmGetUnifiedGroundHeight: ((x: number, z: number, nowMs: number) => number) | null =
    null;
export let wasmBatchUnifiedGroundHeight:
    ((positionsPtr: number, count: number, outputPtr: number, nowMs: number) => void) | null = null;
export let wasmClearGroundPlatforms: (() => void) | null = null;
export let wasmAddGroundPlatform:
    ((minX: number, maxX: number, minZ: number, maxZ: number, maxY: number) => void) | null = null;
export let wasmInvalidateGroundCache: (() => void) | null = null;
export let wasmSetGroundCacheTTL: ((seconds: number) => void) | null = null;




export * from './wasm-loader-cpp.ts';
import {
    initCppFunctions,
    setEmscriptenInstance,
    setEmscriptenMemory,
    emscriptenInstance,
    getNativeFuncVoid,
} from './wasm-loader-cpp.ts';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Memory layout constants (generated from scripts/memory-layout.mjs) */
export {
    POSITION_OFFSET,
    ANIMATION_OFFSET,
    OUTPUT_OFFSET,
    PLAYER_STATE_OFFSET,
    BATCH_UPLOAD_OFFSET,
} from './native-memory-layout.ts';

export * from './wasm-loader-types.ts';
import type {
    EmscriptenModule,
    ExtendedEmscriptenModule,
    WasmExports,
    WasiStubs,
    WasmImportObject,
} from './wasm-loader-types.ts';
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
    proc_exit: () => {},
    clock_time_get: (id: number, precision: bigint, outPtr: number | bigint) => {
        // Robust clock_time_get handling BigInt mixing
        const now = BigInt(Date.now()) * 1000000n;
        if (wasmMemory) {
            const idx = typeof outPtr === 'bigint' ? Number(outPtr) : outPtr;
            const view = new BigInt64Array(wasmMemory.buffer);
            if (idx >= 0 && idx >> 3 < view.length) {
                view[idx >> 3] = now;
            }
        }
        return 0;
    },
};

/** Decode an AssemblyScript string (UTF-16, byte length at ptr - 4). */
function readAsString(ptr: number): string {
    if (!wasmMemory || !ptr) return '';
    const buffer = wasmMemory.buffer;
    if (ptr < 4 || ptr > buffer.byteLength) return `<string @${ptr}>`;
    const byteLength = new Uint32Array(buffer, ptr - 4, 1)[0];
    if (ptr + byteLength > buffer.byteLength) return `<string @${ptr}>`;
    return String.fromCharCode(...new Uint16Array(buffer, ptr, byteLength >>> 1));
}

const importObject: WasmImportObject = {
    env: {
        // AS emits `unreachable` after abort anyway; throwing surfaces a readable
        // message instead of a bare RuntimeError, and never lets execution continue.
        abort: (msg: number, file: number, line: number, col: number) => {
            const text = `${readAsString(msg)} at ${readAsString(file)}:${line}:${col}`;
            console.error(`[WASM] abort: ${text}`);
            throw new Error(`WASM abort: ${text}`);
        },
        seed: () => Date.now() * Math.random(),
        now: () => Date.now(),
    },
    wasi_snapshot_preview1: wasiStubs,
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
        bindAssemblyScriptMemory(exports);
        refreshWasmViews();
    }

    wasmGetGroundHeight = exports.getGroundHeight;
    wasmFreqToHue = exports.freqToHue;
    wasmBatchMushroomSpawnCandidates = exports.batchMushroomSpawnCandidates || null;

    wasmInitDynamicFoliageMemory = exports.initDynamicFoliageMemory || null;
    wasmInitCollisionSystem = exports.initCollisionSystem || null;
    wasmAddCollisionObject = exports.addCollisionObject || null;
    wasmResolveGameCollisions = exports.resolveGameCollisions || null;
    wasmCheckPositionValidity = exports.checkPositionValidity || null;
    wasmUpdateBoids = exports.updateBoids || null;

    wasmBatchGroundHeight = exports.batchGroundHeight || null;
    cppUpdateBoids = getNativeFuncVoid('updateBoids_c');

    wasmGetUnifiedGroundHeight = exports.getUnifiedGroundHeight || null;
    wasmBatchUnifiedGroundHeight = exports.batchUnifiedGroundHeight || null;
    wasmClearGroundPlatforms = exports.clearGroundPlatforms || null;
    wasmAddGroundPlatform = exports.addGroundPlatform || null;
    wasmInvalidateGroundCache = exports.invalidateGroundCache || null;
    wasmSetGroundCacheTTL = exports.setGroundCacheTTL || null;

    wasmSmoothWobble = exports.smoothWobble || null;


}

let viewsBuffer: ArrayBufferLike | null = null;

/**
 * Re-create the fixed-region views if AS memory grew since they were made.
 * Growth detaches the old buffer, so call this before touching positionView,
 * animationView, outputView or playerStateView after any native call.
 */
export function refreshWasmViews(): void {
    if (!wasmMemory) return;
    const buffer = wasmMemory.buffer;
    if (buffer === viewsBuffer) return;
    viewsBuffer = buffer;
    positionView = new Float32Array(buffer, POSITION_OFFSET, POSITION_BYTES / 4);
    animationView = new Float32Array(buffer, ANIMATION_OFFSET, ANIMATION_BYTES / 4);
    outputView = new Float32Array(buffer, OUTPUT_OFFSET, OUTPUT_BYTES / 4);
    playerStateView = new Float32Array(buffer, PLAYER_STATE_OFFSET, PLAYER_STATE_BYTES / 4);
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
                await new Promise((r) => setTimeout(r, WASM_RETRY_DELAYS_MS[attempt - 1]));
            }

            const instance = await initCandyPhysics(importObject as unknown as WebAssembly.Imports);
            validateWasmExports(instance);
            cacheWasmFunctions(instance);

            log.info('WASM', 'AssemblyScript module initialized via Top-Level Await');
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
        console.error(
            '[WASM] All AssemblyScript init attempts failed. JS fallbacks active.',
            lastError
        );
        // Notify loading screen so the user sees a non-fatal warning (not a full
        // fatal error since JS fallbacks allow the game to continue).
        try {
            bootProgress.setWasmPhase('Physics engine unavailable - using JS fallback', 0);
        } catch {
            /* loading screen may not be ready yet */
        }
    }
}

// =============================================================================
// INITIALIZE C++ EMSCRIPTEN FUNCTIONS
// =============================================================================
// EMSCRIPTEN MODULE LOADER
// =============================================================================

/**
 * Update progress UI
 * @param msg - Progress message to display
 */
export async function updateWasmProgress(percent: number, msg: string): Promise<void> {
    bootProgress.updateProgress('wasm-init', percent, msg);
    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.textContent = msg;
    }
    log.info('WASM Progress', msg);
    await new Promise((r) => setTimeout(r, 20));
}

/**
 * Load Emscripten Module (Pthreads/Worker Version)
 * @param forceSingleThreaded - Force single-threaded mode
 * @returns True if module loaded successfully
 */
export async function loadEmscriptenModule(forceSingleThreaded = false): Promise<boolean> {
    // SINGLE-THREADED FALLBACK STRATEGY:
    // 1. If SharedArrayBuffer is missing, or forceSingleThreaded=true, only try ST.
    // 2. Otherwise try 'candy_native.wasm' (threaded) first.
    // 3. Any failure there (file missing, instantiation error or timeout, worker
    //    error) moves on to ST; if ST fails too, JS fallbacks stay active.

    // typeof SharedArrayBuffer !== 'undefined' alone doesn't guarantee a shared
    // WebAssembly.Memory can actually be constructed (e.g. COOP/COEP present
    // but the runtime still rejects atomics); isSharedMemoryAvailable() does a
    // real try/catch construction test instead of a weaker duplicate check.
    const canUseThreads = isSharedMemoryAvailable() && !forceSingleThreaded;
    if (!canUseThreads) {
        console.warn('[Native] Using Single-Threaded Fallback (No SharedArrayBuffer or forced ST)');
    }

    const variants = canUseThreads ? [true, false] : [false];
    const instance = await firstNativeModule(
        variants.map((threaded) => ({
            label: threaded ? 'Pthreads' : 'Single-Threaded',
            load: () => loadEmscriptenVariant(threaded),
        })),
        (label, err) => {
            if (err) console.warn(`[WASM] ${label} native build failed:`, err);
            else log.warn('WASM', `${label} native build unavailable`);
        }
    );
    if (!instance) return false;

    setEmscriptenInstance(instance);
    if (instance.wasmMemory) {
        setEmscriptenMemory(instance.wasmMemory.buffer as ArrayBuffer);
    } else if (instance.HEAP8) {
        setEmscriptenMemory(instance.HEAP8.buffer as ArrayBuffer);
    }

    // Initialize cached C++ function references
    initCppFunctions();

    return true;
}

/**
 * Load one Emscripten build. Resolves null when its files are missing, and
 * rejects when it fails to instantiate (including a hang past
 * NATIVE_INIT_TIMEOUT_MS), so the caller can move on to the next variant.
 */
async function loadEmscriptenVariant(
    isThreaded: boolean
): Promise<ExtendedEmscriptenModule | null> {
    const wasmFilename = isThreaded ? 'candy_native.wasm' : 'candy_native_st.wasm';
    const jsFilename = isThreaded ? 'candy_native.js' : 'candy_native_st.js';

    await updateWasmProgress(10, 'Loading Native Engine...');

    // Check if WASM file exists and RESOLVE THE CORRECT PATH
    const wasmCheck = await checkWasmFileExists(wasmFilename);
    if (!wasmCheck.exists) {
        log.warn('WASM', `${wasmFilename} not found. Using JS fallback.`);
        return null;
    }

    // Construct the full resolved path based on checkWasmFileExists result
    const prefix = wasmCheck.path || '';
    const cleanPrefix = prefix.endsWith('/') ? prefix : prefix ? `${prefix}/` : '';
    const base = typeof document !== 'undefined' ? document.baseURI : self.location.href;
    const jsUrl = new URL(`${cleanPrefix}${jsFilename}`, base).href;
    const wasmUrl = new URL(`${cleanPrefix}${wasmFilename}`, base).href;
    log.info('WASM', 'Loading WASM:', jsUrl);

    // Load the JS factory
    let createCandyNative:
        ((config: Record<string, unknown>) => Promise<ExtendedEmscriptenModule>) | undefined;
    try {
        const module = await import(/* @vite-ignore */ jsUrl);
        createCandyNative = module.default;
    } catch (e) {
        log.warn('WASM', `${jsFilename} not found. Fallback?`, e);
        return null;
    }
    if (!createCandyNative) return null;

    await updateWasmProgress(
        30,
        isThreaded ? 'Spawning Physics Workers...' : 'Initializing Physics (ST)...'
    );

    // Apply aliases (patches NativeWA if available)
    const restore = patchWasmInstantiateAliases();

    // MANUAL FETCH: Pre-fetch binary
    let wasmBinary: ArrayBuffer | null = null;
    try {
        const resp = await fetch(wasmUrl);
        if (resp.ok) {
            wasmBinary = await resp.arrayBuffer();
        } else {
            console.warn(`[WASM] Pre-fetch failed with status: ${resp.status}`);
        }
    } catch (e) {
        console.warn('[WASM] Failed to pre-fetch binary:', e);
        // Help diagnose common server configuration issues
        if (e instanceof Error && e.message.toLowerCase().includes('content decoding')) {
            console.error(
                "[WASM] CRITICAL: Content Decoding Failed! The server is likely sending 'Content-Encoding: gzip' for an uncompressed .wasm file. This is a common issue with Vite preview/dev servers."
            );
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
        log.info('WASM', 'Swapping to Native WebAssembly for Emscripten init');
        window.WebAssembly = nativeWA;
        swapped = true;
    }

    try {
        const config: Record<string, unknown> = {
            // Critical: Explicitly tell Emscripten where to find the file
            locateFile: (path: string, scriptDirectory: string) => {
                if (path.endsWith('.wasm')) return wasmUrl;
                return scriptDirectory + path;
            },
            print: (text: string) => log.info('Native', text),
            printErr: (text: string) => console.warn('[Native Err]', text),
            // IMPORTANT: Do NOT set wasmBinary in config; createNativeModule
            // installs the instantiateWasm hook below instead.
        };

        // Bypass Emscripten's internal instantiation. A failure here rejects
        // (instead of leaving the factory pending) so ST/JS fallbacks run.
        const instantiate = async (imports: WebAssembly.Imports) => {
            log.info('Native', 'Manual instantiation hook triggered');
            let bytes = wasmBinary;

            // Fallback fetch if pre-fetch failed
            if (!bytes) {
                log.info('Native', 'Fetching binary inside hook...');
                const response = await fetch(wasmUrl);
                if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
                bytes = await response.arrayBuffer();
            }

            // Use the CURRENT global WebAssembly (which should be Native if swapped).
            // instantiate() directly instead of compile() + instantiate() works around
            // missing compile() in some polyfills and yields a valid Module/Instance pair.
            const result = await window.WebAssembly.instantiate(bytes, imports);
            log.info('Native', 'Manual instantiation success');

            // We must pass a valid Module object if Pthreads are used, so the
            // worker can receive it. Some polyfills might not return one.
            return { instance: result.instance, module: result.module };
        };

        // Initialize Emscripten (will use Native WA for Memory creation)
        const instance = await createNativeModule(createCandyNative, config, instantiate);
        log.info('WASM', `Emscripten ${isThreaded ? 'Pthreads' : 'Single-Threaded'} Ready`);
        return instance;
    } finally {
        // Restore original environment
        if (swapped) {
            window.WebAssembly = originalWA;
            log.info('WASM', 'Restored original WebAssembly');
        }
        restore();
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
    return wasmMemory ? (wasmMemory.buffer as ArrayBuffer) : null;
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
        startButton.setAttribute('title', 'Please wait while game assets load...');
        startButton.style.cursor = 'wait';
    }

    log.info('WASM', 'initWasm called - loading Emscripten with retry');

    let loaded = false;
    let lastError: unknown;

    for (let attempt = 0; attempt < EMCC_MAX_RETRIES; attempt++) {
        try {
            bootProgress.setWasmPhase(
                `Booting Physics Engine… (Attempt ${attempt + 1}/${EMCC_MAX_RETRIES})`,
                Math.round((attempt / EMCC_MAX_RETRIES) * 80)
            );

            const result = await loadEmscriptenModule();

            if (result && emscriptenInstance) {
                bootProgress.setWasmPhase('Physics Engine ready', 100);
                loaded = true;
                lastError = null;
                break;
            }

            // loadEmscriptenModule returned false (file missing / optional skip) —
            // not a hard error; fall through to allow JS fallbacks.
            console.warn(
                '[WASM] Emscripten module unavailable (optional). JS fallbacks remain active.'
            );
            loaded = true; // treated as "done" — fallbacks are fine
            lastError = null;
            break;
        } catch (err) {
            lastError = err;
            console.error(
                `[WASM] Emscripten init attempt ${attempt + 1}/${EMCC_MAX_RETRIES} failed:`,
                err
            );

            if (attempt < EMCC_MAX_RETRIES - 1) {
                // Wait before next retry (exponential backoff)
                await new Promise((r) => setTimeout(r, EMCC_RETRY_DELAYS_MS[attempt]));
            } else {
                // All attempts exhausted
                bootProgress.setWasmError(
                    'Physics engine failed to load. Check your network connection and reload the page.'
                );
            }
        }
    }

    if (startButton) {
        (startButton as HTMLButtonElement).disabled = false;
        startButton.removeAttribute('aria-busy');
        startButton.removeAttribute('title');
        startButton.innerHTML = 'Start Exploration <span aria-hidden="true">🚀</span>';
        startButton.style.cursor = 'pointer';

        // ♿ Aria: Announce that the loading is complete and the button is ready
        log.info('WASM', 'Game ready. Press Enter to start exploration.');
        // ♿ Aria: Announce that the loading is complete and the button is ready.
        // Dynamic import keeps the announcer chunk off the WASM boot path.
        void import('../ui/announcer.ts').then(({ announce }) => {
            announce('Game ready. Press Enter to start exploration.', 'assertive');
        });
    }

    if (!loaded && lastError) {
        console.error('[WASM] initWasm: all retries failed. JS fallbacks active.', lastError);
        return false;
    }

    return true;
}

export { isSharedMemoryAvailable } from './wasm-orchestrator.ts';
