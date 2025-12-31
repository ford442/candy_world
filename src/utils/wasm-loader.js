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
// With Pthreads/MODULARIZE, the instance itself is the Module object
// and memory is typically accessed via Module.HEAP8, Module.HEAPF32 etc.
// or exports if using specific bindings.
// However, the original code used `emscriptenMemory` which might be irrelevant if we don't access it directly.
// We will keep the variable for consistency but it might be unused.
let emscriptenMemory = null;

// Cache for C-side scratch buffers used by culling to avoid repeated malloc/free
let cullScratchPos = 0;   // pointer to positions buffer in emscripten heap
let cullScratchRes = 0;   // pointer to results buffer in emscripten heap
let cullScratchSize = 0;  // number of object capacity allocated

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
// UPDATED: Load Emscripten Module (Pthreads/Worker Version)
// =============================================================================

/**
 * Load the Emscripten-generated JS module which handles WASM & Workers
 */
async function loadEmscriptenModule() {
    // 0. Safety Check for SharedArrayBuffer
    if (typeof SharedArrayBuffer === 'undefined') {
        console.error('[Native] SharedArrayBuffer is missing. Pthreads will NOT work.');
        console.error('[Native] If hosting statically, ensure you have COOP/COEP headers configured.');
        console.error('[Native] (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp)');
        // We return false here to prevent a crash during instantiation
        return false;
    }

    try {
        await updateProgress('Loading Native Engine...');

        // 1. Dynamic Import the generated loader
        // Note: build.sh now outputs to public/candy_native.js
        // Robust strategy for module loading
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

        // 2. Instantiate (This spawns the worker pool automatically)
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

        // Expose memory buffer if needed by legacy code (scratch buffers, etc.)
        if (emscriptenInstance.wasmMemory) {
            emscriptenMemory = emscriptenInstance.wasmMemory;
        } else if (emscriptenInstance.HEAP8) {
            emscriptenMemory = emscriptenInstance.HEAP8.buffer;
        }

        return true;
    } catch (e) {
        console.warn('Failed to load Native Emscripten module:', e);
        return false;
    }
}

/**
 * Helper to safely get an Emscripten export (handles _ prefix)
 */
function getNativeFunc(name) {
    if (!emscriptenInstance) return null;
    // Emscripten MODULARIZE puts exports directly on the instance using the underscore name
    // e.g. Module._valueNoise2D
    return emscriptenInstance['_' + name] || null;
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
        console.log('[WASM] Fetch response:', response.status, response.statusText);

        if (!response.ok) {
            console.warn('WASM not found, using JS fallbacks');
            // UX: Restore button even on failure (fallback mode)
            if (startButton) {
                startButton.disabled = false;
                startButton.textContent = 'Start Exploration 🚀';
                startButton.style.cursor = 'pointer';
            }
            return false;
        }

        const wasmBytes = await response.arrayBuffer();
        console.log('WASM buffer size:', wasmBytes.byteLength, 'bytes');

        // Check if we got HTML instead of WASM (common 404 issue)
        const firstBytes = new Uint8Array(wasmBytes.slice(0, 4));
        const magic = Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log('[WASM] Magic number:', magic, '(expected: 0061736d)');

        if (magic !== '0061736d') {
            console.error('[WASM] Invalid file - not a WebAssembly binary!');
            // UX: Restore button even on failure
            if (startButton) {
                startButton.disabled = false;
                startButton.textContent = 'Start Exploration 🚀';
                startButton.style.cursor = 'pointer';
            }
            return false;
        }

        // WASI stubs (required for some runtime features)
        const wasiStubs = {
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
            clock_time_get: () => 0,
        };

        await updateProgress('Compiling Physics (WASM)...');

        // Use NativeWebAssembly to bypass libopenmpt's WebAssembly override
        const WA = window.NativeWebAssembly || WebAssembly;
        console.log('Using WebAssembly API:', WA === WebAssembly ? 'Standard (potentially hijacked)' : 'Native (saved)');

        const importObject = {
            env: {
                abort: (msg, file, line, col) => {
                    console.error(`WASM abort at ${file}:${line}:${col}: ${msg}`);
                }
            },
            wasi_snapshot_preview1: wasiStubs
        };

        // Try streaming instantiation first for faster compilation
        let result;
        try {
            console.log('Attempting WebAssembly.instantiateStreaming...');
            result = await WA.instantiateStreaming(
                fetch(wasmUrl),
                importObject
            );
            console.log('Streaming instantiation successful');
        } catch (streamError) {
            console.log('Streaming instantiation failed, falling back to buffer method:', streamError);
            // Fallback to traditional method if streaming fails
            result = await WA.instantiate(wasmBytes, importObject);
            console.log('Buffer instantiation successful');
        }

        console.log('Instantiation successful');
        if (window.setLoadingStatus) window.setLoadingStatus("Physics Engine Ready...");
        wasmInstance = result.instance;

        // Log available exports for debugging
        const exportKeys = Object.keys(wasmInstance.exports);
        console.log('WASM exports:', exportKeys);
        console.log('Export count:', exportKeys.length);

        // Verify exports exist
        if (!wasmInstance.exports.getGroundHeight) {
            console.error('WASM exports missing getGroundHeight. Available:', exportKeys);
            wasmInstance = null;
            // UX: Restore button even on failure
            if (startButton) {
                startButton.disabled = false;
                startButton.textContent = 'Start Exploration 🚀';
                startButton.style.cursor = 'pointer';
            }
            return false;
        }

        // Use WASM's exported memory (AssemblyScript manages its own)
        if (wasmInstance.exports.memory) {
            wasmMemory = wasmInstance.exports.memory;
            const memBuffer = wasmMemory.buffer;
            positionView = new Float32Array(memBuffer, POSITION_OFFSET, 1024);
            animationView = new Float32Array(memBuffer, ANIMATION_OFFSET, 1024);
            outputView = new Float32Array(memBuffer, OUTPUT_OFFSET, 1024);
        }

        // Cache function references for reliable access
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
        // UX: Restore button on failure
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
 * 
 * Loads both AssemblyScript and Emscripten modules in parallel for faster startup.
 * Uses SharedArrayBuffer for cross-module coordination when available.
 * 
 * @param {Object} options
 * @param {Function} options.onProgress - Progress callback (phase, message)
 * @returns {Promise<boolean>} True if at least ASC module loaded successfully
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

    console.log('[WASM] initWasmParallel started (WASM-First Architecture)');

    try {
        // Use the parallel orchestrator for concurrent module loading
        const result = await parallelWasmLoad({
            onProgress,
            ascWasmUrl: './candy_physics.wasm',
            emccWasmUrl: './candy_native.wasm'
        });

        // Wire up the ASC module
        if (result.asc) {
            wasmInstance = result.asc;

            // Verify exports exist
            if (!wasmInstance.exports.getGroundHeight) {
                console.error('[WASM] ASC exports missing getGroundHeight');
                wasmInstance = null;
            } else {
                // Use WASM's exported memory
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

                console.log('[WASM] AssemblyScript module loaded via parallel orchestrator');
            }
        }

        // Wire up the EMCC module
        if (result.emcc) {
            emscriptenInstance = result.emcc;
            emscriptenMemory = emscriptenInstance.exports && emscriptenInstance.exports.memory;
            console.log('[WASM] Emscripten module loaded via parallel orchestrator');

            // Call init if available
            const initFn = getNativeFunc('init_native');
            if (initFn) {
                setTimeout(() => {
                    try { initFn(); console.log('[WASM] init_native() invoked'); }
                    catch (e) { console.warn(e); }
                }, 0);
            }
        }

        // Log shared memory status
        if (result.sharedBuffer) {
            console.log('[WASM] SharedArrayBuffer coordination active');
        }

        // UX: Restore button
        if (startButton) {
            startButton.disabled = false;
            startButton.textContent = 'Start Exploration 🚀';
            startButton.style.cursor = 'pointer';
        }

        return wasmInstance !== null;
    } catch (error) {
        console.warn('[WASM] Parallel init failed, falling back to sequential:', error);
        
        // Fallback to original sequential loading
        return await initWasm();
    }
}

/**
 * Check if WASM is available
 */
export function isWasmReady() {
    return wasmInstance !== null;
}

/**
 * Check if Emscripten module is available
 */
export function isEmscriptenReady() {
    return emscriptenInstance !== null;
}

/**
 * Get the raw WASM instance (for advanced usage like direct memory access)
 */
export function getWasmInstance() {
    return wasmInstance;
}

// =============================================================================
// SIMPLE MATH FUNCTIONS (with JS fallbacks)
// =============================================================================

/**
 * Get procedural ground height at coordinates
 */
export function getGroundHeight(x, z) {
    if (wasmGetGroundHeight) {
        return wasmGetGroundHeight(x, z);
    }
    // JS fallback
    if (isNaN(x) || isNaN(z)) return 0;
    return Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 +
        Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3;
}

/**
 * Convert audio frequency to HSL hue
 */
export function freqToHue(freq) {
    if (wasmFreqToHue) {
        return wasmFreqToHue(freq);
    }
    // JS fallback
    if (!freq || freq < 50) return 0;
    const logF = Math.log2(freq / 55.0);
    return (logF * 0.1) % 1.0;
}

/**
 * Linear interpolation
 */
export function lerp(a, b, t) {
    if (wasmLerp) {
        return wasmLerp(a, b, t);
    }
    return a + (b - a) * t;
}

// =============================================================================
// BATCH PROCESSING FUNCTIONS
// =============================================================================

/**
 * Upload object positions to WASM memory
 * @param {Array<{x: number, y: number, z: number, radius?: number}>} objects
 */
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

/**
 * Upload mushroom data (positions + animation specs) directly to WASM memory.
 * Optimized to avoid creating intermediate objects (GC pressure reduction).
 * @param {Array<THREE.Object3D>} mushrooms Array of mushroom meshes
 */
export function uploadMushroomSpecs(mushrooms) {
    if (!positionView || !animationView) return;

    const count = Math.min(mushrooms.length, 256);
    for (let i = 0; i < count; i++) {
        const m = mushrooms[i];
        const idx = i * 4;

        // Position Data
        positionView[idx] = m.position.x;
        positionView[idx + 1] = m.position.y;
        positionView[idx + 2] = m.position.z;
        positionView[idx + 3] = m.userData?.radius || 0.5;

        // Animation Data
        animationView[idx] = 0; // offset
        animationView[idx + 1] = 0; // type
        animationView[idx + 2] = m.position.y; // originalY
        animationView[idx + 3] = m.userData?.colorIndex || 0;
    }
}

/**
 * Fast copy from a SharedArrayBuffer-backed Float32Array into WASM position memory.
 * This avoids creating JS objects for each position and is ideal for large counts.
 * @param {Float32Array} sharedView Float32Array backed by SharedArrayBuffer
 * @param {number} objectCount number of objects to copy
 */
export function copySharedPositions(sharedView, objectCount) {
    if (!positionView) return;
    const maxCount = Math.min(objectCount, Math.floor(positionView.length / 4));
    // Perform the copy (per-element loop is fast for typed arrays)
    for (let i = 0; i < maxCount * 4; i++) {
        positionView[i] = sharedView[i];
    }
}

/**
 * Upload animation data to WASM memory
 * @param {Array<{offset: number, type: number, originalY: number}>} animData
 */
export function uploadAnimationData(animData) {
    if (!animationView) return;

    const count = Math.min(animData.length, 256);
    for (let i = 0; i < count; i++) {
        const data = animData[i];
        const idx = i * 4;
        animationView[idx] = data.offset || 0;
        animationView[idx + 1] = data.type || 0;
        animationView[idx + 2] = data.originalY || 0;
        // Store colorIndex in the 4th slot for spawn/candidate logic
        animationView[idx + 3] = (typeof data.colorIndex === 'number') ? data.colorIndex : 0;
    }
}

/**
 * Batch distance culling - returns visibility flags
 * @param {number} cameraX 
 * @param {number} cameraY 
 * @param {number} cameraZ 
 * @param {number} maxDistance 
 * @param {number} objectCount 
 * @returns {{visibleCount: number, flags: Float32Array}}
 */
export function batchDistanceCull(cameraX, cameraY, cameraZ, maxDistance, objectCount) {
    const maxDistSq = maxDistance * maxDistance;

    // Fallback to AssemblyScript batchDistanceCull (Direct Memory Access)
    if (!wasmInstance) {
        return { visibleCount: objectCount, flags: null };
    }

    if (objectCount > 5000) {
        console.warn(`[WASM] Object count ${objectCount} exceeds safety limit for batch processing. Skipping WASM cull.`);
        return { visibleCount: objectCount, flags: null }; // Skip optimization, assume all visible
    }

    const visibleCount = wasmInstance.exports.batchDistanceCull(
        cameraX, cameraY, cameraZ, maxDistSq, objectCount
    );

    return {
        visibleCount,
        flags: outputView.slice(0, objectCount)
    };
}

/**
 * Run WASM batch function to generate mushroom spawn candidates.
 * Returns candidateCount and writes candidates into the existing output buffer.
 */
export function batchMushroomSpawnCandidates(time, windX, windZ, windSpeed, objectCount, spawnThreshold, minDistance, maxDistance) {
    if (wasmBatchMushroomSpawnCandidates && wasmInstance) {
        const count = wasmBatchMushroomSpawnCandidates(time, windX, windZ, windSpeed, objectCount, spawnThreshold, minDistance, maxDistance);
        return count;
    }
    return 0;
}

/**
 * Read candidate data from output buffer, each candidate is 4 floats: x,y,z,colorIndex
 */
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

// =============================================================================
// MATERIAL ANALYSIS (Strategy 3: Shader Pre-Hashing & Deduplication)
// =============================================================================

/**
 * Analyze materials and identify unique shader combinations
 * This enables compileAsync optimizations by pre-deduplicating shader modules
 * 
 * @param {Array<{vertexShaderId: number, fragmentShaderId: number, blendingMode: number, flags: number}>} materials
 * @returns {{uniqueCount: number, shaders: Array<{vertexId: number, fragmentId: number, blendMode: number, flags: number}>}}
 */
export function analyzeMaterials(materials) {
    if (!wasmInstance || !wasmInstance.exports.analyzeMaterials) {
        // JS fallback - simple deduplication
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
    
    // Use WASM for analysis (faster for large material counts)
    const count = Math.min(materials.length, 256);
    // MATERIAL_DATA_OFFSET: Must match assembly/constants.ts MATERIAL_DATA_OFFSET (12288)
    const MATERIAL_OFFSET = 12288;
    
    // Upload material data to WASM memory
    if (!wasmMemory) return { uniqueCount: 0, shaders: [] };
    
    // Each material is 4 x i32 (16 bytes), so we need count * 4 elements
    const materialView = new Int32Array(wasmMemory.buffer, MATERIAL_OFFSET, count * 4);
    for (let i = 0; i < count; i++) {
        const mat = materials[i];
        const idx = i * 4; // 4 int32 elements per material
        materialView[idx] = mat.vertexShaderId || 0;
        materialView[idx + 1] = mat.fragmentShaderId || 0;
        materialView[idx + 2] = mat.blendingMode || 0;
        materialView[idx + 3] = mat.flags || 0;
    }
    
    // Run WASM analysis
    const uniqueCount = wasmInstance.exports.analyzeMaterials(MATERIAL_OFFSET, count);
    
    // Read back unique shader configurations from the output area
    // WASM writes results starting at MATERIAL_OFFSET (same location, overwritten)
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

/**
 * Get unique shader count from last material analysis
 * @returns {number}
 */
export function getUniqueShaderCount() {
    if (wasmInstance && wasmInstance.exports.getUniqueShaderCount) {
        return wasmInstance.exports.getUniqueShaderCount();
    }
    return 0;
}

/**
 * Batch animation calculations
 * @param {number} time 
 * @param {number} intensity 
 * @param {number} kick 
 * @param {number} objectCount 
 * @returns {Float32Array} Results array [yOffset, rotX, rotZ, 0, ...] per object
 */
export function batchAnimationCalc(time, intensity, kick, objectCount) {
    if (!wasmInstance) return null;

    wasmInstance.exports.batchAnimationCalc(time, intensity, kick, objectCount);

    // Return slice of output buffer (4 floats per object)
    return outputView.slice(0, objectCount * 4);
}

// =============================================================================
// SINGLE ANIMATION HELPERS (with JS fallbacks)
// =============================================================================

/**
 * Calculate bounce Y offset
 */
export function calcBounceY(time, offset, intensity, kick) {
    if (wasmInstance) {
        return wasmInstance.exports.calcBounceY(time, offset, intensity, kick);
    }
    // JS fallback
    const animTime = time + offset;
    let yOffset = Math.sin(animTime * 3) * 0.1 * intensity;
    if (kick > 0.1) yOffset += kick * 0.2;
    return yOffset;
}

/**
 * Calculate sway rotation Z
 */
export function calcSwayRotZ(time, offset, intensity) {
    if (wasmInstance) {
        return wasmInstance.exports.calcSwayRotZ(time, offset, intensity);
    }
    return Math.sin(time + offset) * 0.1 * intensity;
}

/**
 * Calculate wobble rotations
 * @returns {{rotX: number, rotZ: number}}
 */
export function calcWobble(time, offset, intensity) {
    if (wasmInstance) {
        wasmInstance.exports.calcWobble(time, offset, intensity);
        return {
            rotX: wasmInstance.exports.getWobbleX(),
            rotZ: wasmInstance.exports.getWobbleZ()
        };
    }
    // JS fallback
    const animTime = time + offset;
    return {
        rotX: Math.sin(animTime * 3) * 0.15 * intensity,
        rotZ: Math.cos(animTime * 3) * 0.15 * intensity
    };
}

// =============================================================================
// COLLISION DETECTION
// =============================================================================

/**
 * Check collision between player and objects
 * @param {number} playerX 
 * @param {number} playerZ 
 * @param {number} playerRadius 
 * @param {number} objectCount 
 * @returns {boolean}
 */
export function checkCollision(playerX, playerZ, playerRadius, objectCount) {
    if (!wasmInstance) return false;
    return wasmInstance.exports.checkCollision(playerX, playerZ, playerRadius, objectCount) === 1;
}

// =============================================================================
// ADVANCED ANIMATION FUNCTIONS (AssemblyScript)
// =============================================================================

// Result caches for multi-return functions
let speakerResult = { yOffset: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
let accordionResult = { stretchY: 1, widthXZ: 1 };
let fiberResult = { baseRotY: 0, branchRotZ: 0 };
let shiverResult = { rotX: 0, rotZ: 0 };
let spiralResult = { rotY: 0, yOffset: 0, scale: 1 };
let prismResult = { unfurl: 0, spin: 0, pulse: 1, hue: 0 };
let particleResult = { x: 0, y: 0, z: 0 };
let arpeggioResult = { targetStep: 0, unfurlStep: 0 }; // New result cache

/**
 * Speaker Pulse animation (Subwoofer Lotus)
 */
export function calcSpeakerPulse(time, offset, kick) {
    if (wasmInstance) {
        wasmInstance.exports.calcSpeakerPulse(time, offset, kick);
        speakerResult.yOffset = wasmInstance.exports.getSpeakerYOffset();
        speakerResult.scaleX = wasmInstance.exports.getSpeakerScaleX();
        speakerResult.scaleY = wasmInstance.exports.getSpeakerScaleY();
        speakerResult.scaleZ = wasmInstance.exports.getSpeakerScaleZ();
    } else {
        // JS fallback
        speakerResult.yOffset = Math.sin(time + offset) * 0.2;
        const pump = kick * 0.5;
        speakerResult.scaleX = 1.0 + pump * 0.2;
        speakerResult.scaleY = 1.0 - pump * 0.5;
        speakerResult.scaleZ = 1.0 + pump * 0.2;
    }
    return speakerResult;
}

/**
 * Accordion Stretch animation (Accordion Palm)
 */
export function calcAccordionStretch(animTime, offset, intensity) {
    if (wasmInstance) {
        wasmInstance.exports.calcAccordionStretch(animTime, offset, intensity);
        accordionResult.stretchY = wasmInstance.exports.getAccordionStretchY();
        accordionResult.widthXZ = wasmInstance.exports.getAccordionWidthXZ();
    } else {
        const rawStretch = Math.sin(animTime * 10.0 + offset);
        accordionResult.stretchY = 1.0 + Math.max(0, rawStretch) * 0.3 * intensity;
        accordionResult.widthXZ = 1.0 / Math.sqrt(accordionResult.stretchY);
    }
    return accordionResult;
}

/**
 * Fiber Whip animation (Willow branches)
 */
export function calcFiberWhip(time, offset, leadVol, isActive, branchIndex) {
    if (wasmInstance) {
        wasmInstance.exports.calcFiberWhip(time, offset, leadVol, isActive ? 1 : 0, branchIndex);
        fiberResult.baseRotY = wasmInstance.exports.getFiberBaseRotY();
        fiberResult.branchRotZ = wasmInstance.exports.getFiberBranchRotZ();
    } else {
        fiberResult.baseRotY = Math.sin(time * 0.5 + offset) * 0.1;
        const whip = leadVol * 2.0;
        const childOffset = branchIndex * 0.5;
        fiberResult.branchRotZ = Math.PI / 4 + Math.sin(time * 2.0 + childOffset) * 0.1;
        if (isActive) {
            fiberResult.branchRotZ += Math.sin(time * 10.0 + childOffset) * whip;
        }
    }
    return fiberResult;
}

/**
 * Hop animation with squash/stretch
 */
export function calcHopY(time, offset, intensity, kick) {
    if (wasmInstance) {
        return wasmInstance.exports.calcHopY(time, offset, intensity, kick);
    }
    const animTime = time + offset;
    const hopVal = Math.sin(animTime * 4.0);
    let bounce = Math.max(0, hopVal) * 0.3 * intensity;
    if (kick > 0.1) bounce += kick * 0.15;
    return bounce;
}

/**
 * Shiver animation (small rapid vibration)
 */
export function calcShiver(time, offset, intensity) {
    if (wasmInstance) {
        wasmInstance.exports.calcShiver(time, offset, intensity);
        shiverResult.rotX = wasmInstance.exports.getShiverRotX();
        shiverResult.rotZ = wasmInstance.exports.getShiverRotZ();
    } else {
        const animTime = time + offset;
        shiverResult.rotX = Math.sin(animTime * 20.0) * 0.02 * intensity;
        shiverResult.rotZ = Math.cos(animTime * 20.0) * 0.02 * intensity;
    }
    return shiverResult;
}

/**
 * Spiral Wave animation
 */
export function calcSpiralWave(time, offset, intensity, groove) {
    if (wasmInstance) {
        wasmInstance.exports.calcSpiralWave(time, offset, intensity, groove);
        spiralResult.rotY = wasmInstance.exports.getSpiralRotY();
        spiralResult.yOffset = wasmInstance.exports.getSpiralYOffset();
        spiralResult.scale = wasmInstance.exports.getSpiralScale();
    } else {
        const animTime = time + offset;
        spiralResult.rotY = Math.sin(animTime * 2.0) * 0.2 * intensity;
        spiralResult.yOffset = Math.sin(animTime * 3.0) * 0.1 * (1.0 + groove);
        spiralResult.scale = 1.0 + Math.sin(animTime * 4.0) * 0.05 * intensity;
    }
    return spiralResult;
}

/**
 * Prism Rose animation
 */
export function calcPrismRose(time, offset, kick, groove, isActive) {
    if (wasmInstance) {
        wasmInstance.exports.calcPrismRose(time, offset, kick, groove, isActive ? 1 : 0);
        prismResult.unfurl = wasmInstance.exports.getPrismUnfurl();
        prismResult.spin = wasmInstance.exports.getPrismSpin();
        prismResult.pulse = wasmInstance.exports.getPrismPulse();
        prismResult.hue = wasmInstance.exports.getPrismHue();
    } else {
        const animTime = time + offset;
        const intensity = isActive ? (1.0 + groove * 3.0) : 0.3;
        prismResult.unfurl = Math.sin(animTime * 2.0) * 0.1 * intensity;
        prismResult.spin = animTime * 0.5 + groove * 2.0;
        prismResult.pulse = 1.0 + kick * 0.3;
        prismResult.hue = (animTime * 0.1) % 1.0;
    }
    return prismResult;
}

/**
 * Arpeggio Animation (WASM wrapper)
 *
 * Optimized to prefer C++ Native WASM if available, then AssemblyScript, then JS fallback.
 */
export function calcArpeggioStep(currentUnfurl, currentTarget, lastTrigger, arpeggioActive, noteTrigger, maxSteps) {
    // 1. Try Native C++ (fastest)
    const calcFn = getNativeFunc('calcArpeggioStep_c');
    if (calcFn) {
        calcFn(currentUnfurl, currentTarget, lastTrigger ? 1 : 0, arpeggioActive ? 1 : 0, noteTrigger ? 1 : 0, maxSteps);

        // Retrieve results from C global storage
        const getTarget = getNativeFunc('getArpeggioTargetStep_c');
        const getUnfurl = getNativeFunc('getArpeggioUnfurlStep_c');

        if (getTarget && getUnfurl) {
            arpeggioResult.targetStep = getTarget();
            arpeggioResult.unfurlStep = getUnfurl();
            return arpeggioResult;
        }
    }

    // 2. Try AssemblyScript (fast)
    if (wasmInstance && wasmInstance.exports.calcArpeggioStep) {
        wasmInstance.exports.calcArpeggioStep(currentUnfurl, currentTarget, lastTrigger ? 1 : 0, arpeggioActive ? 1 : 0, noteTrigger ? 1 : 0, maxSteps);
        arpeggioResult.targetStep = wasmInstance.exports.getArpeggioTargetStep();
        arpeggioResult.unfurlStep = wasmInstance.exports.getArpeggioUnfurlStep();
        return arpeggioResult;
    }

    // 3. JS Fallback (slowest)
    let nextTarget = currentTarget;
    if (arpeggioActive) {
        if (noteTrigger && !lastTrigger) {
            nextTarget = Math.min(maxSteps, nextTarget + 1);
        }
    } else {
        nextTarget = 0;
    }
    const speed = (nextTarget > currentUnfurl) ? 0.3 : 0.05;
    const nextUnfurl = currentUnfurl + (nextTarget - currentUnfurl) * speed;
    return { targetStep: nextTarget, unfurlStep: nextUnfurl };
}

/**
 * Lerp between two RGB colors (packed as 0xRRGGBB)
 */
export function lerpColor(color1, color2, t) {
    if (wasmInstance) {
        return wasmInstance.exports.lerpColor(color1, color2, t);
    }
    const r1 = (color1 >> 16) & 0xFF, g1 = (color1 >> 8) & 0xFF, b1 = color1 & 0xFF;
    const r2 = (color2 >> 16) & 0xFF, g2 = (color2 >> 8) & 0xFF, b2 = color2 & 0xFF;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
}

/**
 * Calculate rain droplet Y position
 */
export function calcRainDropY(startY, time, speed, cycleHeight) {
    if (wasmInstance) {
        return wasmInstance.exports.calcRainDropY(startY, time, speed, cycleHeight);
    }
    const totalDrop = time * speed;
    const cycled = totalDrop % cycleHeight;
    return startY - cycled;
}

/**
 * Calculate floating particle position
 */
export function calcFloatingParticle(baseX, baseY, baseZ, time, offset, amplitude) {
    if (wasmInstance) {
        wasmInstance.exports.calcFloatingParticle(baseX, baseY, baseZ, time, offset, amplitude);
        particleResult.x = wasmInstance.exports.getParticleX();
        particleResult.y = wasmInstance.exports.getParticleY();
        particleResult.z = wasmInstance.exports.getParticleZ();
    } else {
        const t = time + offset;
        particleResult.x = baseX + Math.sin(t * 0.5) * amplitude;
        particleResult.y = baseY + Math.sin(t * 0.7) * amplitude * 0.5;
        particleResult.z = baseZ + Math.cos(t * 0.6) * amplitude;
    }
    return particleResult;
}

// =============================================================================
// EMSCRIPTEN NATIVE FUNCTIONS (from candy_native.c)
// =============================================================================

export function updatePhysicsCPP(delta, inputX, inputZ, speed, jump, sprint, sneak, grooveGravity) {
    const f = getNativeFunc('updatePhysicsCPP');
    if (f) return f(delta, inputX, inputZ, speed, jump ? 1 : 0, sprint ? 1 : 0, sneak ? 1 : 0, grooveGravity);
    return -1; // Fallback
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

/**
 * 2D Value Noise (Emscripten)
 * @param {number} x 
 * @param {number} y 
 * @returns {number} Noise value -1 to 1
 */
export function valueNoise2D(x, y) {
    const f = getNativeFunc('valueNoise2D');
    if (f) return f(x, y);
    // JS fallback - simple hash-based noise
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

/**
 * Fractal Brownian Motion (layered noise)
 * @param {number} x 
 * @param {number} y 
 * @param {number} octaves - Number of noise layers (default 4)
 * @returns {number} FBM value
 */
export function fbm(x, y, octaves = 4) {
    const f = getNativeFunc('fbm');
    if (f) return f(x, y, octaves);

    // JS fallback
    let value = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
        value += amp * valueNoise2D(x * freq, y * freq);
        amp *= 0.5;
        freq *= 2;
    }
    return value;
}

/**
 * Fast inverse square root (Quake III algorithm)
 * @param {number} x 
 * @returns {number} 1/sqrt(x)
 */
export function fastInvSqrt(x) {
    const f = getNativeFunc('fastInvSqrt');
    if (f) return f(x);
    return 1 / Math.sqrt(x);
}

/**
 * Fast distance calculation
 */
export function fastDistance(x1, y1, z1, x2, y2, z2) {
    const f = getNativeFunc('fastDistance');
    if (f) return f(x1, y1, z1, x2, y2, z2);
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Hash function for procedural generation
 */
export function hash(x, y) {
    const f = getNativeFunc('hash');
    if (f) return f(x, y);
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
}

// =============================================================================
// RE-EXPORTS FROM WASM ORCHESTRATOR (for convenient access)
// =============================================================================
export { 
    LOADING_PHASES, 
    isSharedMemoryAvailable,
    initSharedBuffer,
    getSharedBuffer,
    createPlaceholderScene,
    removePlaceholderScene 
} from './wasm-orchestrator.js';
