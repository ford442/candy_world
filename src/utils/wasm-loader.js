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
let wasmBridge = null; // Helper for MEMORY64 BigInt conversion

// With Pthreads/MODULARIZE, the instance itself is the Module object
let emscriptenMemory = null;

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
 * This acts like the "Component Model" interface, handling type conversion automatically.
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
     * NOTE: This is a simplified bridge. 
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

    // 1. Restore Native WebAssembly to bypass libopenmpt shim
    // This fixes "TypeError: Cannot mix BigInt..." caused by libopenmpt hijacking WebAssembly
    const hijackedWA = window.WebAssembly;
    const nativeWA = window.NativeWebAssembly || hijackedWA;
    
    // If libopenmpt or another shim has replaced the global object, temporarily revert it
    if (hijackedWA !== nativeWA) {
        console.log('[WASM] Temporarily restoring Native WebAssembly for 64-bit Engine load...');
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
        // 5. Restore the shim (optional, but good practice if audio lib relies on it)
        if (window.WebAssembly !== hijackedWA) {
            window.WebAssembly = hijackedWA;
            console.log('[WASM] Restored Audio Engine environment');
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
            if (startButton) {
                startButton.disabled = false;
                startButton.textContent = 'Start Exploration 🚀';
                startButton.style.cursor = 'pointer';
            }
            return false;
        }

        const wasmBytes = await response.arrayBuffer();
        
        // Check Magic
        const firstBytes = new Uint8Array(wasmBytes.slice(0, 4));
        const magic = Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        if (magic !== '0061736d') {
            console.error('[WASM] Invalid file - not a WebAssembly binary!');
            if (startButton) {
                startButton.disabled = false;
                startButton.textContent = 'Start Exploration 🚀';
                startButton.style.cursor = 'pointer';
            }
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
        if (startButton) {
            startButton.disabled = false;
            startButton.textContent = 'Start Exploration 🚀';
            startButton.style.cursor = 'pointer';
        }
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

export function batchDistanceCull(cameraX, cameraY, cameraZ, maxDistance, objectCount) {
    const maxDistSq = maxDistance * maxDistance;

    if (!wasmInstance) {
        return { visibleCount: objectCount, flags: null };
    }

    if (objectCount > 5000) {
        return { visibleCount: objectCount, flags: null };
    }

    const visibleCount = wasmInstance.exports.batchDistanceCull(
        cameraX, cameraY, cameraZ, maxDistSq, objectCount
    );

    return {
        visibleCount,
        flags: outputView.slice(0, objectCount)
    };
}

export function batchMushroomSpawnCandidates(time, windX, windZ, windSpeed, objectCount, spawnThreshold, minDistance, maxDistance) {
    if (wasmBatchMushroomSpawnCandidates && wasmInstance) {
        return wasmBatchMushroomSpawnCandidates(time, windX, windZ, windSpeed, objectCount, spawnThreshold, minDistance, maxDistance);
    }
    return 0;
}

export function readSpawnCandidates(candidateCount) {
    if (!outputView) return [];
    const arr = [];
    const maxCount = Math.min(candidateCount, 128);
    for (let i = 0; i < maxCount; i++) {
        const idx = i * 4;
        const x = outputView[idx];
        const y = outputView[idx + 1];
        const z = outputView[idx + 2];
        const colorIndex = outputView[idx + 3];
        if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
        arr.push({ x, y, z, colorIndex: Math.round(colorIndex) });
    }
    return arr;
}

export function analyzeMaterials(materials) {
    // Falls back to JS if WASM unavailable
    if (!wasmInstance || !wasmInstance.exports.analyzeMaterials) {
        const seen = new Map();
        const shaders = [];
        for (const mat of materials) {
            const key = `${mat.vertexShaderId}-${mat.fragmentShaderId}-${mat.blendingMode}-${mat.flags || 0}`;
            if (!seen.has(key)) {
                seen.set(key, true);
                shaders.push({
                    vertexId: mat.vertexShaderId || 0,
                    fragmentId: mat.fragmentShaderId || 0,
                    blendMode: mat.blendingMode || 0,
                    flags: mat.flags || 0
                });
            }
        }
        return { uniqueCount: shaders.length, shaders };
    }
    
    const count = Math.min(materials.length, 256);
    const MATERIAL_OFFSET = 12288;
    
    if (!wasmMemory) return { uniqueCount: 0, shaders: [] };
    
    const materialView = new Int32Array(wasmMemory.buffer, MATERIAL_OFFSET, count * 4);
    for (let i = 0; i < count; i++) {
        const mat = materials[i];
        const idx = i * 4;
        materialView[idx] = mat.vertexShaderId || 0;
        materialView[idx + 1] = mat.fragmentShaderId || 0;
        materialView[idx + 2] = mat.blendingMode || 0;
        materialView[idx + 3] = mat.flags || 0;
    }
    
    const uniqueCount = wasmInstance.exports.analyzeMaterials(MATERIAL_OFFSET, count);
    
    const outputView = new Int32Array(wasmMemory.buffer, MATERIAL_OFFSET, Math.min(uniqueCount, 64) * 4);
    const shaders = [];
    for (let i = 0; i < Math.min(uniqueCount, 64); i++) {
        const idx = i * 4;
        shaders.push({
            vertexId: outputView[idx],
            fragmentId: outputView[idx + 1],
            blendMode: outputView[idx + 2],
            flags: outputView[idx + 3]
        });
    }
    
    return { uniqueCount, shaders };
}

export function getUniqueShaderCount() {
    if (wasmInstance && wasmInstance.exports.getUniqueShaderCount) {
        return wasmInstance.exports.getUniqueShaderCount();
    }
    return 0;
}

export function batchAnimationCalc(time, intensity, kick, objectCount) {
    if (!wasmInstance) return null;
    wasmInstance.exports.batchAnimationCalc(time, intensity, kick, objectCount);
    return outputView.slice(0, objectCount * 4);
}

// ... (calcBounceY, calcSwayRotZ, calcWobble, checkCollision, calcSpeakerPulse, calcAccordionStretch, calcFiberWhip, calcHopY, calcShiver, calcSpiralWave, calcPrismRose, calcArpeggioStep, lerpColor, calcRainDropY, calcFloatingParticle remain unchanged) ...
// (Omitting for brevity as they don't interact with Emscripten heap directly in this context)
// ... Keep existing logic for these functions ...

export function calcBounceY(time, offset, intensity, kick) {
    if (wasmInstance) return wasmInstance.exports.calcBounceY(time, offset, intensity, kick);
    const animTime = time + offset;
    let yOffset = Math.sin(animTime * 3) * 0.1 * intensity;
    if (kick > 0.1) yOffset += kick * 0.2;
    return yOffset;
}
export function calcSwayRotZ(time, offset, intensity) {
    if (wasmInstance) return wasmInstance.exports.calcSwayRotZ(time, offset, intensity);
    return Math.sin(time + offset) * 0.1 * intensity;
}
export function calcWobble(time, offset, intensity) {
    if (wasmInstance) {
        wasmInstance.exports.calcWobble(time, offset, intensity);
        return { rotX: wasmInstance.exports.getWobbleX(), rotZ: wasmInstance.exports.getWobbleZ() };
    }
    const animTime = time + offset;
    return { rotX: Math.sin(animTime * 3) * 0.15 * intensity, rotZ: Math.cos(animTime * 3) * 0.15 * intensity };
}
export function checkCollision(playerX, playerZ, playerRadius, objectCount) {
    if (!wasmInstance) return false;
    return wasmInstance.exports.checkCollision(playerX, playerZ, playerRadius, objectCount) === 1;
}

let speakerResult = { yOffset: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
export function calcSpeakerPulse(time, offset, kick) {
    if (wasmInstance) {
        wasmInstance.exports.calcSpeakerPulse(time, offset, kick);
        speakerResult.yOffset = wasmInstance.exports.getSpeakerYOffset();
        speakerResult.scaleX = wasmInstance.exports.getSpeakerScaleX();
        speakerResult.scaleY = wasmInstance.exports.getSpeakerScaleY();
        speakerResult.scaleZ = wasmInstance.exports.getSpeakerScaleZ();
    } else {
        speakerResult.yOffset = Math.sin(time + offset) * 0.2;
        const pump = kick * 0.5;
        speakerResult.scaleX = 1.0 + pump * 0.2;
        speakerResult.scaleY = 1.0 - pump * 0.5;
        speakerResult.scaleZ = 1.0 + pump * 0.2;
    }
    return speakerResult;
}

// ... (Other animation functions omitted for brevity, logic remains identical to original file) ...
// ... Add back calcAccordionStretch, calcFiberWhip, calcHopY, calcShiver, calcSpiralWave, calcPrismRose, calcArpeggioStep, lerpColor, calcRainDropY, calcFloatingParticle ...
// (I am including one or two examples above, please retain the rest from your original file)

export function calcAccordionStretch(animTime, offset, intensity) {
    if (wasmInstance) {
        wasmInstance.exports.calcAccordionStretch(animTime, offset, intensity);
        return { stretchY: wasmInstance.exports.getAccordionStretchY(), widthXZ: wasmInstance.exports.getAccordionWidthXZ() };
    }
    return { stretchY: 1, widthXZ: 1 };
}
// ... etc

// =============================================================================
// EMSCRIPTEN NATIVE FUNCTIONS (from candy_native.c)
// =============================================================================

export function updatePhysicsCPP(delta, inputX, inputZ, speed, jump, sprint, sneak, grooveGravity) {
    const f = getNativeFunc('updatePhysicsCPP');
    if (f) return f(delta, inputX, inputZ, speed, jump ? 1 : 0, sprint ? 1 : 0, sneak ? 1 : 0, grooveGravity);
    return -1;
}

export function initPhysics(x, y, z) {
    const f = getNativeFunc('initPhysics');
    if (f) f(x, y, z);
}

export function addObstacle(type, x, y, z, r, h, p1, p2, p3) {
    const f = getNativeFunc('addObstacle');
    if (f) f(type, x, y, z, r, h, p1, p2, p3 ? 1.0 : 0.0);
}

export function setPlayerState(x, y, z, vx, vy, vz) {
    const f = getNativeFunc('setPlayerState');
    if (f) f(x, y, z, vx, vy, vz);
}

export function getPlayerState() {
    const x = getNativeFunc('getPlayerX')();
    const y = getNativeFunc('getPlayerY')();
    const z = getNativeFunc('getPlayerZ')();
    const vx = getNativeFunc('getPlayerVX')();
    const vy = getNativeFunc('getPlayerVY')();
    const vz = getNativeFunc('getPlayerVZ')();
    return { x, y, z, vx, vy, vz };
}

export function valueNoise2D(x, y) {
    const f = getNativeFunc('valueNoise2D');
    if (f) return f(x, y);
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

export function fbm(x, y, octaves = 4) {
    const f = getNativeFunc('fbm');
    if (f) return f(x, y, octaves);
    return 0;
}

export function fastInvSqrt(x) {
    const f = getNativeFunc('fastInvSqrt');
    if (f) return f(x);
    return 1 / Math.sqrt(x);
}

export function fastDistance(x1, y1, z1, x2, y2, z2) {
    const f = getNativeFunc('fastDistance');
    if (f) return f(x1, y1, z1, x2, y2, z2);
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function hash(x, y) {
    const f = getNativeFunc('hash');
    if (f) return f(x, y);
    return 0;
}

// =============================================================================
// RE-EXPORTS
// =============================================================================
export { 
    LOADING_PHASES, 
    isSharedMemoryAvailable,
    initSharedBuffer,
    getSharedBuffer,
    createPlaceholderScene,
    removePlaceholderScene 
} from './wasm-orchestrator.js';
