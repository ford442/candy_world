// src/utils/wasm-loader.js

// ... (Keep existing AssemblyScript imports and variables) ...
// ... (wasmInstance, wasmMemory, etc for AssemblyScript remain unchanged) ...

// WASM Loader - Candy World Physics & Animation Module
// Loads and wraps AssemblyScript WASM for easy use from JavaScript
//
// WASM-First Architecture: This module now supports parallel WASM loading
// via the WASMOrchestrator for improved startup performance.
//
// Emscripten compile worker is loaded from public/js/emscripten-compile-worker.js as a static Worker
// This avoids Vite bundling issues for workers in production builds.

import { 
    parallelWasmLoad, 
    LOADING_PHASES, 
    initSharedBuffer, 
    getSharedBuffer,
    isSharedMemoryAvailable 
} from './wasm-orchestrator.js';

let wasmInstance = null;
let wasmMemory = null;
let positionView = null;   // Float32Array for object positions
let animationView = null;  // Float32Array for animation data
let outputView = null;     // Float32Array for reading results

// Cached WASM function references (more reliable than accessing exports repeatedly)
let wasmGetGroundHeight = null;
let wasmFreqToHue = null;
let wasmLerp = null;
let wasmBatchMushroomSpawnCandidates = null;
let wasmUpdateFoliageBatch = null;

// Emscripten module (native C functions)
let emscriptenInstance = null;
let wasmBridge = null; // Bridge helper for MEMORY64 interactions

// With Pthreads/MODULARIZE, the instance itself is the Module object
// and memory is typically accessed via Module.HEAP8, Module.HEAPF32 etc.
let emscriptenMemory = null;

// Cache for C-side scratch buffers used by culling to avoid repeated malloc/free
// NOTE: In MEMORY64, these pointers must be BigInts
let cullScratchPos = 0n;   // pointer to positions buffer in emscripten heap
let cullScratchRes = 0n;   // pointer to results buffer in emscripten heap
let cullScratchSize = 0;   // number of object capacity allocated

// Memory layout constants (must match AssemblyScript)
const POSITION_OFFSET = 0;
const ANIMATION_OFFSET = 4096;
const OUTPUT_OFFSET = 8192;
const TOTAL_MEMORY_PAGES = 4; // 256KB total

// Animation type constants (must match AssemblyScript)
export const AnimationType = {
    BOUNCE: 1,
    SWAY: 2,
    WOBBLE: 3,
    HOP: 4
};

// =============================================================================
// WASM BRIDGE (MEMORY64 Support)
// =============================================================================

/**
 * Helper class to bridge JavaScript Numbers and WASM BigInt pointers (MEMORY64)
 */
class WasmBridge {
    constructor(module) {
        this.module = module;
        // Locate memory buffer source
        this.memory = module.wasmMemory || module.memory || (module.exports && module.exports.memory) || module.HEAP8.buffer;
    }

    /**
     * Allocate memory in WASM heap
     * @param {number} size 
     * @returns {BigInt} Pointer
     */
    malloc(size) {
        if (!this.module._malloc) return 0n;
        return this.module._malloc(BigInt(size));
    }

    /**
     * Free memory in WASM heap
     * @param {BigInt} ptr 
     */
    free(ptr) {
        if (!this.module._free) return;
        this.module._free(BigInt(ptr));
    }

    /**
     * Create a Float32 view of a WASM memory region
     * @param {BigInt} ptr Pointer to start
     * @param {number} length Number of elements (floats)
     * @returns {Float32Array}
     */
    readFloat32Array(ptr, length) {
        // Safe conversion: BigInt ptr to Number offset. 
        // Valid for < 9007TB memory (max safe integer), which is always true for WASM (4GB max).
        const offset = Number(ptr);
        
        // Access the current buffer (it might have grown/detached)
        const buffer = this.module.HEAPF32 ? this.module.HEAPF32.buffer : this.memory.buffer;
        
        return new Float32Array(
            buffer,
            offset,
            length
        );
    }
    
    /**
     * Call an exported function, converting relevant args to BigInt if needed
     * NOTE: Logic depends on specific function signatures.
     * This generic helper assumes numbers > MAX_SAFE_INTEGER are meant to be pointers.
     */
    call(funcName, ...args) {
        const func = this.module['_' + funcName] || this.module[funcName];
        if (!func) return null;
        return func(...args);
    }
}

// =============================================================================
// UPDATED: Load Emscripten Module (Pthreads/Worker Version)
// =============================================================================

/**
 * Load the Emscripten-generated JS module which handles WASM & Workers
 */
async function loadEmscriptenModule() {
    // 0. Safety Check for SharedArrayBuffer
    if (typeof SharedArrayBuffer === 'undefined') {
        console.error('[Native] SharedArrayBuffer is missing. Pthreads will NOT work.');
        return false;
    }

    // 1. Restore Native WebAssembly
    // Fixes "TypeError: Cannot mix BigInt..." caused by libopenmpt hijacking WebAssembly
    const hijackedWA = window.WebAssembly;
    const nativeWA = window.NativeWebAssembly || hijackedWA;
    
    if (hijackedWA !== nativeWA) {
        console.log('[WASM] Temporarily restoring Native WebAssembly for Engine load...');
        window.WebAssembly = nativeWA;
    }

    try {
        await updateProgress('Loading Native Engine...');

        // 2. Dynamic Import the generated loader
        let createCandyNative;
        let locatePrefix = '/candy-world';

        try {
            const module = await import(/* @vite-ignore */ `/candy-world/candy_native.js?v=${Date.now()}`);
            createCandyNative = module.default;
        } catch (e) {
            console.log('[WASM] Production path failed, trying local fallback...');
            const module = await import(/* @vite-ignore */ `/candy_native.js?v=${Date.now()}`);
            createCandyNative = module.default;
            locatePrefix = '';
        }

        // 3. Instantiate (This spawns the worker pool automatically)
        await updateProgress('Spawning Physics Workers...');

        emscriptenInstance = await createCandyNative({
            locateFile: (path, prefix) => {
                if (path.endsWith('.wasm')) return `${locatePrefix}/candy_native.wasm`;
                if (path.endsWith('.worker.js')) return `${locatePrefix}/candy_native.worker.js`;
                return prefix + path;
            },
            print: (text) => console.log('[Native]', text),
            printErr: (text) => console.warn('[Native Err]', text),
        });

        console.log('[WASM] Emscripten Pthreads Ready');

        // 4. Initialize Bridge
        wasmBridge = new WasmBridge(emscriptenInstance);

        // Expose memory buffer if needed
        if (emscriptenInstance.wasmMemory) {
            emscriptenMemory = emscriptenInstance.wasmMemory;
        } else if (emscriptenInstance.HEAP8) {
            emscriptenMemory = emscriptenInstance.HEAP8.buffer;
        }

        return true;
    } catch (e) {
        console.warn('Failed to load Native Emscripten module:', e);
        return false;
    } finally {
        // 5. Restore environment (optional, but good practice if other libs rely on the hijack)
        if (window.WebAssembly !== hijackedWA) {
            window.WebAssembly = hijackedWA;
            console.log('[WASM] Restored environment WebAssembly');
        }
    }
}

/**
 * Helper to safely get an Emscripten export (handles _ prefix)
 */
function getNativeFunc(name) {
    if (!emscriptenInstance) return null;
    return emscriptenInstance['_' + name] || null;
}


/**
 * Helper function to start bootstrap terrain pre-computation
 * @param {Object} instance - The Emscripten module instance
 */
let bootstrapStarted = false; // Guard to prevent duplicate initialization

async function startBootstrapIfAvailable(instance) {
    if (!instance || bootstrapStarted) return;
    
    try {
        const { startBootstrap } = await import('./bootstrap-loader.js');
        if (startBootstrap && startBootstrap(instance)) {
            bootstrapStarted = true;
            console.log('[WASM] Bootstrap terrain pre-computation started');
        }
    } catch (e) {
        console.warn('[WASM] Bootstrap loader error:', e);
    }
}

/**
 * Initialize the WASM module
 * @returns {Promise<boolean>} True if loaded successfully
 */
// Helper to update UI status and yield to main thread to prevent hanging
async function updateProgress(msg) {
    if (window.setLoadingStatus) window.setLoadingStatus(msg);

    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.textContent = msg;
    }
    console.log('[WASM Progress]', msg);
    // Yield to browser event loop
    await new Promise(r => setTimeout(r, 20));
}

export async function initWasm() {
    if (wasmInstance) return true;

    // UX: Update button state to indicate loading
    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.disabled = true;
        startButton.style.cursor = 'wait';
    }

    console.log('[WASM] initWasm started');
    await updateProgress('Downloading Physics Engine...');

    try {
        // Load WASM binary with cache buster
        const wasmUrl = './candy_physics.wasm?v=' + Date.now();
        console.log('[WASM] Fetching:', wasmUrl);
        const response = await fetch(wasmUrl);
        
        if (!response.ok) {
            console.warn('WASM not found, using JS fallbacks');
            if (startButton) startButton.disabled = false;
            return false;
        }

        const wasmBytes = await response.arrayBuffer();
        
        // Check Magic
        const firstBytes = new Uint8Array(wasmBytes.slice(0, 4));
        const magic = Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        if (magic !== '0061736d') {
            console.error('[WASM] Invalid file - not a WebAssembly binary!');
            if (startButton) startButton.disabled = false;
            return false;
        }

        // WASI stubs
        const wasiStubs = {
            fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0, fd_read: () => 0,
            fd_fdstat_get: () => 0, fd_prestat_get: () => 0, fd_prestat_dir_name: () => 0,
            path_open: () => 0, environ_sizes_get: () => 0, environ_get: () => 0,
            proc_exit: () => { }, clock_time_get: () => 0,
        };

        await updateProgress('Compiling Physics (WASM)...');

        // Use NativeWebAssembly to bypass libopenmpt's WebAssembly override for ASC load
        const WA = window.NativeWebAssembly || WebAssembly;
        
        const importObject = {
            env: {
                abort: (msg, file, line, col) => {
                    console.error(`WASM abort at ${file}:${line}:${col}: ${msg}`);
                }
            },
            wasi_snapshot_preview1: wasiStubs
        };

        let result;
        try {
            result = await WA.instantiateStreaming(fetch(wasmUrl), importObject);
        } catch (streamError) {
            result = await WA.instantiate(wasmBytes, importObject);
        }

        wasmInstance = result.instance;

        // Use WASM's exported memory (AssemblyScript manages its own)
        if (wasmInstance.exports.memory) {
            wasmMemory = wasmInstance.exports.memory;
            const memBuffer = wasmMemory.buffer;
            positionView = new Float32Array(memBuffer, POSITION_OFFSET, 1024);
            animationView = new Float32Array(memBuffer, ANIMATION_OFFSET, 1024);
            outputView = new Float32Array(memBuffer, OUTPUT_OFFSET, 1024);
        }

        // Cache function references
        wasmGetGroundHeight = wasmInstance.exports.getGroundHeight;
        wasmFreqToHue = wasmInstance.exports.freqToHue;
        wasmLerp = wasmInstance.exports.lerp;
        wasmBatchMushroomSpawnCandidates = wasmInstance.exports.batchMushroomSpawnCandidates || null;
        wasmUpdateFoliageBatch = wasmInstance.exports.updateFoliageBatch || null;

        console.log('[WASM] AssemblyScript module loaded successfully');

        // =====================================================================
        // LOAD EMSCRIPTEN MODULE (Pthreads/Workers)
        // =====================================================================
        await loadEmscriptenModule();

        // Start bootstrap loader
        if (emscriptenInstance) {
            await startBootstrapIfAvailable(emscriptenInstance);
        }

        // UX: Restore button on success
        if (startButton) {
            startButton.disabled = false;
            startButton.textContent = 'Start Exploration 🚀';
            startButton.style.cursor = 'pointer';
        }

        return true;
    } catch (error) {
        console.warn('Failed to load WASM:', error);
        wasmInstance = null;
        if (startButton) startButton.disabled = false;
        return false;
    }
}

/**
 * WASM-First Parallel Initialization (Strategy 1)
 */
export async function initWasmParallel(options = {}) {
    if (wasmInstance) return true;

    const { onProgress = (phase, msg) => {
        if (window.setLoadingStatus) window.setLoadingStatus(msg);
    } } = options;

    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.disabled = true;
        startButton.style.cursor = 'wait';
    }

    // Capture Native WA before parallel load starts to ensure safety
    const hijackedWA = window.WebAssembly;
    const nativeWA = window.NativeWebAssembly || hijackedWA;
    if (hijackedWA !== nativeWA) window.WebAssembly = nativeWA;

    console.log('[WASM] initWasmParallel started (WASM-First Architecture)');

    try {
        const result = await parallelWasmLoad({
            onProgress,
            ascWasmUrl: './candy_physics.wasm',
            emccWasmUrl: './candy_native.wasm'
        });

        // Wire up the ASC module
        if (result.asc) {
            wasmInstance = result.asc;
            if (wasmInstance.exports.memory) {
                wasmMemory = wasmInstance.exports.memory;
                const memBuffer = wasmMemory.buffer;
                positionView = new Float32Array(memBuffer, POSITION_OFFSET, 1024);
                animationView = new Float32Array(memBuffer, ANIMATION_OFFSET, 1024);
                outputView = new Float32Array(memBuffer, OUTPUT_OFFSET, 1024);
            }
            wasmGetGroundHeight = wasmInstance.exports.getGroundHeight;
            wasmFreqToHue = wasmInstance.exports.freqToHue;
            wasmLerp = wasmInstance.exports.lerp;
            wasmBatchMushroomSpawnCandidates = wasmInstance.exports.batchMushroomSpawnCandidates || null;
            wasmUpdateFoliageBatch = wasmInstance.exports.updateFoliageBatch || null;
        }

        // Wire up the EMCC module
        if (result.emcc) {
            emscriptenInstance = result.emcc;
            emscriptenMemory = emscriptenInstance.exports && emscriptenInstance.exports.memory;
            
            // Initialize Bridge
            wasmBridge = new WasmBridge(emscriptenInstance);

            const initFn = getNativeFunc('init_native');
            if (initFn) {
                setTimeout(() => { try { initFn(); } catch (e) { console.warn(e); } }, 0);
            }
            await startBootstrapIfAvailable(emscriptenInstance);
        }

        if (startButton) {
            startButton.disabled = false;
            startButton.textContent = 'Start Exploration 🚀';
            startButton.style.cursor = 'pointer';
        }

        return wasmInstance !== null;
    } catch (error) {
        console.warn('[WASM] Parallel init failed, falling back to sequential:', error);
        // Fallback
        return await initWasm();
    } finally {
         // Restore hijacked WA if needed
         if (window.WebAssembly !== hijackedWA) window.WebAssembly = hijackedWA;
    }
}

// ... (Exported checks: isWasmReady, isEmscriptenReady, getWasmInstance remain the same) ...
export function isWasmReady() { return wasmInstance !== null; }
export function isEmscriptenReady() { return emscriptenInstance !== null; }
export function getWasmInstance() { return wasmInstance; }

// =============================================================================
// SIMPLE MATH FUNCTIONS (ASC - Unchanged)
// =============================================================================
export function getGroundHeight(x, z) {
    if (wasmGetGroundHeight) return wasmGetGroundHeight(x, z);
    if (isNaN(x) || isNaN(z)) return 0;
    return Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 + Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3;
}
export function freqToHue(freq) {
    if (wasmFreqToHue) return wasmFreqToHue(freq);
    if (!freq || freq < 50) return 0;
    return (Math.log2(freq / 55.0) * 0.1) % 1.0;
}
export function lerp(a, b, t) {
    if (wasmLerp) return wasmLerp(a, b, t);
    return a + (b - a) * t;
}

// =============================================================================
// BATCH PROCESSING FUNCTIONS
// =============================================================================

// ... (uploadPositions, uploadMushroomSpecs, copySharedPositions, uploadAnimationData remain the same) ...

export function uploadPositions(objects) {
    if (!positionView) return;
    const count = Math.min(objects.length, 256);
    for (let i = 0; i < count; i++) {
        const obj = objects[i];
        const idx = i * 4;
        positionView[idx] = obj.x || 0;
        positionView[idx + 1] = obj.y || 0;
        positionView[idx + 2] = obj.z || 0;
        positionView[idx + 3] = obj.radius || 1.0;
    }
}

export function uploadMushroomSpecs(mushrooms) {
    if (!positionView || !animationView) return;
    const count = Math.min(mushrooms.length, 256);
    for (let i = 0; i < count; i++) {
        const m = mushrooms[i];
        const idx = i * 4;
        positionView[idx] = m.position.x;
        positionView[idx + 1] = m.position.y;
        positionView[idx + 2] = m.position.z;
        positionView[idx + 3] = m.userData?.radius || 0.5;
        animationView[idx] = 0;
        animationView[idx + 1] = 0;
        animationView[idx + 2] = m.position.y;
        animationView[idx + 3] = m.userData?.colorIndex || 0;
    }
}

export function copySharedPositions(sharedView, objectCount) {
    if (!positionView) return;
    const maxCount = Math.min(objectCount, Math.floor(positionView.length / 4));
    for (let i = 0; i < maxCount * 4; i++) {
        positionView[i] = sharedView[i];
    }
}

export function uploadAnimationData(animData) {
    if (!animationView) return;
    const count = Math.min(animData.length, 256);
    for (let i = 0; i < count; i++) {
        const data = animData[i];
        const idx = i * 4;
        animationView[idx] = data.offset || 0;
        animationView[idx + 1] = data.type || 0;
        animationView[idx + 2] = data.originalY || 0;
        animationView[idx + 3] = (typeof data.colorIndex === 'number') ? data.colorIndex : 0;
    }
}

/**
 * Batch distance culling - returns visibility flags
 * UPDATED: Uses WasmBridge for MEMORY64 pointer safety
 */
export function batchDistanceCull(cameraX, cameraY, cameraZ, maxDistance, objectCount) {
