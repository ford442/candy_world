/**
 * @file wasm-loader.js
 * @brief WASM Module Loader with Graceful JavaScript Fallbacks
 */

import { 
    parallelWasmLoad, 
    LOADING_PHASES, 
    initSharedBuffer, 
    getSharedBuffer,
    isSharedMemoryAvailable 
} from './wasm-orchestrator.js';

import { checkWasmFileExists, inspectWasmExports, patchWasmInstantiateAliases } from './wasm-utils.js';
import { showToast } from './toast.js';

// Import WASM initialization function (Vite + vite-plugin-wasm)
import initCandyPhysics from '../wasm/candy_physics.wasm?init';

let wasmInstance = null;
let wasmMemory = null;
let positionView = null;   // Float32Array for object positions
let animationView = null;  // Float32Array for animation data
let outputView = null;     // Float32Array for reading results
let playerStateView = null; // Float32Array for player physics state

// Cached WASM function references
let wasmGetGroundHeight = null;
let wasmFreqToHue = null;
let wasmLerp = null;
let wasmBatchMushroomSpawnCandidates = null;
let wasmUpdateFoliageBatch = null;

// New Physics exports
let wasmInitCollisionSystem = null;
let wasmAddCollisionObject = null;
let wasmResolveGameCollisions = null;
let wasmCheckPositionValidity = null;

// Emscripten module (native C functions)
let emscriptenInstance = null;
let emscriptenMemory = null;

// Memory layout constants
const POSITION_OFFSET = 0;
const ANIMATION_OFFSET = 4096;
const OUTPUT_OFFSET = 8192;
const PLAYER_STATE_OFFSET = 16384;

// Animation type constants
export const AnimationType = {
    BOUNCE: 1,
    SWAY: 2,
    WOBBLE: 3,
    HOP: 4
};

// =============================================================================
// INITIALIZATION: TOP-LEVEL AWAIT
// =============================================================================

// WASI stubs with BigInt Safety (Required for AS environment)
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
    clock_time_get: (id, precision, outPtr) => {
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

const importObject = {
    env: {
        abort: (msg, file, line, col) => {
            console.error(`WASM abort at ${file}:${line}:${col}: ${msg}`);
        },
        seed: () => Date.now() * Math.random(),
        now: () => Date.now()
    },
    wasi_snapshot_preview1: wasiStubs
};

// Immediately initialize the AssemblyScript WASM module
// This blocks module execution until the WASM is ready (Vite handles this via top-level await wrapper)
try {
    const instance = await initCandyPhysics(importObject);

    // Store global instance
    wasmInstance = instance;

    // Setup Memory Views
    if (wasmInstance.exports.memory) {
        wasmMemory = wasmInstance.exports.memory;
        const memBuffer = wasmMemory.buffer;
        positionView = new Float32Array(memBuffer, POSITION_OFFSET, 1024);
        animationView = new Float32Array(memBuffer, ANIMATION_OFFSET, 1024);
        outputView = new Float32Array(memBuffer, OUTPUT_OFFSET, 1024);
        playerStateView = new Float32Array(memBuffer, PLAYER_STATE_OFFSET, 8);
    }

    // Cache function references
    wasmGetGroundHeight = wasmInstance.exports.getGroundHeight;
    wasmFreqToHue = wasmInstance.exports.freqToHue;
    wasmLerp = wasmInstance.exports.lerp;
    wasmBatchMushroomSpawnCandidates = wasmInstance.exports.batchMushroomSpawnCandidates || null;
    wasmUpdateFoliageBatch = wasmInstance.exports.updateFoliageBatch || null;

    // Physics collision
    wasmInitCollisionSystem = wasmInstance.exports.initCollisionSystem || null;
    wasmAddCollisionObject = wasmInstance.exports.addCollisionObject || null;
    wasmResolveGameCollisions = wasmInstance.exports.resolveGameCollisions || null;
    wasmCheckPositionValidity = wasmInstance.exports.checkPositionValidity || null;

    console.log('[WASM] AssemblyScript module initialized via Top-Level Await');

} catch (e) {
    console.error('[WASM] Failed to initialize AssemblyScript module:', e);
    // JS Fallbacks will automatically kick in because function pointers are null
}

// =============================================================================
// UPDATED: Load Emscripten Module (Pthreads/Worker Version)
// =============================================================================

async function loadEmscriptenModule(forceSingleThreaded = false) {
    // SINGLE-THREADED FALLBACK STRATEGY:
    // 1. If SharedArrayBuffer is missing, forcing ST.
    // 2. If forceSingleThreaded=true is passed (recursive fallback), use ST.
    // 3. We attempt to load 'candy_native.wasm' (threaded).
    // 4. If that fails (file missing, instantiation error, worker error), we recursively call loadEmscriptenModule(true).

    const canUseThreads = typeof SharedArrayBuffer !== 'undefined' && !forceSingleThreaded;

    try {
        await updateProgress('Loading Native Engine...');

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
        let createCandyNative;
        try {
            const module = await import(/* @vite-ignore */ `${resolvedJsPath}?v=${Date.now()}`);
            createCandyNative = module.default;
        } catch (e) {
            console.log(`[WASM] ${jsFilename} not found. Fallback?`, e);
            if (isThreaded) return loadEmscriptenModule(true);
            return false;
        }

        if (isThreaded) {
            await updateProgress('Spawning Physics Workers...');
        } else {
            await updateProgress('Initializing Physics (ST)...');
        }

        // Apply aliases (patches NativeWA if available)
        const restore = patchWasmInstantiateAliases();

        // MANUAL FETCH: Pre-fetch binary
        let wasmBinary = null;
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
            if (e.message && e.message.toLowerCase().includes("content decoding")) {
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
            const config = {
                // Critical: Explicitly tell Emscripten where to find the file
                locateFile: (path, scriptDirectory) => {
                    if (path.endsWith('.wasm')) return resolvedWasmPath;
                    return scriptDirectory + path;
                },
                print: (text) => console.log('[Native]', text),
                printErr: (text) => console.warn('[Native Err]', text),
                
                // IMPORTANT: Do NOT set wasmBinary in config. 
                // Bypass internal instantiation logic completely
                instantiateWasm: (imports, successCallback) => {
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
                            const instance = result.instance || result;
                            const module = result.module || null; // Some polyfills might not return module

                            // We must pass a valid Module object if Pthreads are used, 
                            // so the worker can receive it.
                            successCallback(instance, module);

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

        if (emscriptenInstance.wasmMemory) {
            emscriptenMemory = emscriptenInstance.wasmMemory;
        } else if (emscriptenInstance.HEAP8) {
            emscriptenMemory = emscriptenInstance.HEAP8.buffer;
        }

        return true;
    } catch (e) {
        console.warn('[WASM] Native module unavailable:', e);
        return false;
    }
}

/**
 * Get a native C++ function from the Emscripten module.
 */
function getNativeFunc(name) {
    if (!emscriptenInstance) return null;
    const underscoreName = '_' + name;
    if (typeof emscriptenInstance[underscoreName] === 'function') {
        return emscriptenInstance[underscoreName];
    }
    if (typeof emscriptenInstance[name] === 'function') {
        return emscriptenInstance[name];
    }
    return null;
}

let bootstrapStarted = false;

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

async function updateProgress(msg) {
    if (window.setLoadingStatus) window.setLoadingStatus(msg);
    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.textContent = msg;
    }
    console.log('[WASM Progress]', msg);
    await new Promise(r => setTimeout(r, 20));
}

// NOTE: This function is now just a wrapper for Emscripten loading.
// The main AssemblyScript WASM is already loaded via Top-Level Await.
export async function initWasm() {
    // If we already have the AS instance (which we should), we just proceed to Emscripten
    if (!wasmInstance) {
        console.warn('[WASM] AS instance missing even after TLA?');
    }

    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.disabled = true;
        startButton.style.cursor = 'wait';
    }

    console.log('[WASM] initWasm called - checking Emscripten');

    // Load Emscripten (Complex/Threaded)
    await loadEmscriptenModule();

    if (emscriptenInstance) {
        await startBootstrapIfAvailable(emscriptenInstance);
    }

    if (startButton) {
        startButton.disabled = false;
        startButton.textContent = 'Start Exploration 🚀';
        startButton.style.cursor = 'pointer';
    }

    return true;
}

// Deprecated: Parallel loading is no longer needed as AS is bundled synchronously (via TLA)
export async function initWasmParallel(options = {}) {
    console.log('[WASM] initWasmParallel routed to standard initWasm');
    if (options.onProgress) {
        // Simple shim for progress
        options.onProgress('start', 'Initializing...');
    }
    return initWasm();
}

export function isWasmReady() { return wasmInstance !== null; }
export function isEmscriptenReady() { return emscriptenInstance !== null; }
export function getWasmInstance() { return wasmInstance; }

// =============================================================================
// COLLISION WRAPPERS
// =============================================================================

export function uploadCollisionObjects(caves, mushrooms, clouds, trampolines) {
    if (!wasmInitCollisionSystem || !wasmAddCollisionObject) return false;

    wasmInitCollisionSystem();

    // TYPE_MUSHROOM = 1, TYPE_CLOUD = 2, TYPE_GATE = 3, TYPE_TRAMPOLINE = 4

    // 1. Gates
    if (caves) {
        caves.forEach(cave => {
            if (cave.userData.isBlocked) {
                const gatePos = cave.userData.gatePosition.clone().applyMatrix4(cave.matrixWorld);
                wasmAddCollisionObject(3, gatePos.x, gatePos.y, gatePos.z, 2.5, 5.0, 0, 0); // Radius 2.5
            }
        });
    }

    // 2. Mushrooms
    if (mushrooms) {
        mushrooms.forEach(m => {
            if (m.userData.isTrampoline) {
                 wasmAddCollisionObject(4, m.position.x, m.position.y, m.position.z,
                    m.userData.capRadius || 2.0, m.userData.capHeight || 3.0, 0, 0);
            } else {
                 wasmAddCollisionObject(1, m.position.x, m.position.y, m.position.z,
                    m.userData.capRadius || 2.0, m.userData.capHeight || 3.0, 0, 0);
            }
        });
    }

    // 3. Clouds
    if (clouds) {
        clouds.forEach(c => {
             // Cloud Tier 1 only
             if (c.userData.tier === 1) {
                 wasmAddCollisionObject(2, c.position.x, c.position.y, c.position.z,
                    c.scale.x || 1.0, c.scale.y || 1.0, 0, 0);
             }
        });
    }

    console.log('[WASM] Uploaded collision objects to ASC.');
    return true;
}

export function resolveGameCollisionsWASM(player, kickTrigger) {
    if (!wasmResolveGameCollisions || !playerStateView) return false;

    // Write State
    playerStateView[0] = player.position.x;
    playerStateView[1] = player.position.y;
    playerStateView[2] = player.position.z;
    playerStateView[3] = player.velocity.x;
    playerStateView[4] = player.velocity.y;
    playerStateView[5] = player.velocity.z;
    playerStateView[6] = player.isGrounded ? 1.0 : 0.0;

    const result = wasmResolveGameCollisions(kickTrigger);

    if (result === 1) {
        // Read Back
        player.position.x = playerStateView[0];
        player.position.y = playerStateView[1];
        player.position.z = playerStateView[2];
        player.velocity.x = playerStateView[3];
        player.velocity.y = playerStateView[4];
        player.velocity.z = playerStateView[5];
        player.isGrounded = playerStateView[6] > 0.5;
        return true;
    }
    return false;
}

// =============================================================================
// SIMPLE MATH FUNCTIONS
// =============================================================================

export function getGroundHeight(x, z) {
    if (wasmGetGroundHeight) return wasmGetGroundHeight(x, z);
    if (isNaN(x) || isNaN(z)) return 0;
    return Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 +
        Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3;
}

export function freqToHue(freq) {
    if (wasmFreqToHue) return wasmFreqToHue(freq);
    if (!freq || freq < 50) return 0;
    const logF = Math.log2(freq / 55.0);
    return (logF * 0.1) % 1.0;
}

export function lerp(a, b, t) {
    if (wasmLerp) return wasmLerp(a, b, t);
    return a + (b - a) * t;
}

// =============================================================================
// BATCH PROCESSING
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
    if (!wasmInstance) return { visibleCount: objectCount, flags: null };
    if (objectCount > 5000) return { visibleCount: objectCount, flags: null };

    const visibleCount = wasmInstance.exports.batchDistanceCull(
        cameraX, cameraY, cameraZ, maxDistSq, objectCount
    );

    return { visibleCount, flags: outputView.slice(0, objectCount) };
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

// =============================================================================
// SINGLE ANIMATION HELPERS
// =============================================================================
// 
// These functions wrap WASM animation calculations with JavaScript fallbacks.
// The pattern is: check if WASM export exists, call it if available, else use JS.
//
// IMPORTANT: We check for export existence using typeof to prevent runtime errors
// when specific functions are missing from the WASM build.
// =============================================================================

/**
 * Calculate vertical bounce offset for an object.
 * Uses WASM if available, otherwise falls back to JavaScript.
 * * @param {number} time - Current animation time
 * @param {number} offset - Phase offset for desynchronization
 * @param {number} intensity - Animation intensity multiplier
 * @param {number} kick - Audio kick trigger value (0-1)
 * @returns {number} Vertical offset value
 */
export function calcBounceY(time, offset, intensity, kick) {
    // Check if WASM export exists before calling
    if (wasmInstance && typeof wasmInstance.exports.calcBounceY === 'function') {
        return wasmInstance.exports.calcBounceY(time, offset, intensity, kick);
    }
    // JavaScript fallback - identical algorithm to C++ implementation
    const animTime = time + offset;
    let yOffset = Math.sin(animTime * 3) * 0.1 * intensity;
    if (kick > 0.1) yOffset += kick * 0.2;
    return yOffset;
}

/**
 * Calculate rotation Z sway for an object.
 * Uses WASM if available, otherwise falls back to JavaScript.
 * * @param {number} time - Current animation time
 * @param {number} offset - Phase offset for desynchronization
 * @param {number} intensity - Animation intensity multiplier
 * @returns {number} Rotation Z value in radians
 */
export function calcSwayRotZ(time, offset, intensity) {
    // Check if WASM export exists before calling
    if (wasmInstance && typeof wasmInstance.exports.calcSwayRotZ === 'function') {
        return wasmInstance.exports.calcSwayRotZ(time, offset, intensity);
    }
    // JavaScript fallback
    return Math.sin(time + offset) * 0.1 * intensity;
}

/**
 * Calculate wobble rotation (X and Z axes) for an object.
 * Uses WASM if available, otherwise falls back to JavaScript.
 * * @param {number} time - Current animation time
 * @param {number} offset - Phase offset for desynchronization
 * @param {number} intensity - Animation intensity multiplier
 * @returns {{rotX: number, rotZ: number}} Rotation values in radians
 */
export function calcWobble(time, offset, intensity) {
    // Check if all required WASM exports exist
    if (wasmInstance && 
        typeof wasmInstance.exports.calcWobble === 'function' &&
        typeof wasmInstance.exports.getWobbleX === 'function' &&
        typeof wasmInstance.exports.getWobbleZ === 'function') {
        wasmInstance.exports.calcWobble(time, offset, intensity);
        return {
            rotX: wasmInstance.exports.getWobbleX(),
            rotZ: wasmInstance.exports.getWobbleZ()
        };
    }
    // JavaScript fallback
    const animTime = time + offset;
    return {
        rotX: Math.sin(animTime * 3) * 0.15 * intensity,
        rotZ: Math.cos(animTime * 3) * 0.15 * intensity
    };
}

export function checkCollision(playerX, playerZ, playerRadius, objectCount) {
    if (!wasmInstance) return false;
    return wasmInstance.exports.checkCollision(playerX, playerZ, playerRadius, objectCount) === 1;
}

// =============================================================================
// GENERATION & PHYSICS HELPERS (WASM)
// =============================================================================

export function initCollisionSystem() {
    if (wasmInitCollisionSystem) wasmInitCollisionSystem();
}

export function addCollisionObject(type, x, y, z, r, h, p1, p2, p3) {
    if (wasmAddCollisionObject) {
        wasmAddCollisionObject(type, x, y, z, r, h, p1, p2, p3 ? 1.0 : 0.0);
    }
}

export function checkPositionValidity(x, z, radius) {
    if (wasmCheckPositionValidity) {
        return wasmCheckPositionValidity(x, z, radius);
    }
    return 0; // Default to valid if WASM not ready
}

// =============================================================================
// ADVANCED ANIMATION WRAPPERS
// =============================================================================
//
// These functions implement the animation calculations that were migrated from
// JavaScript to C++ for better performance. Each function:
//
// 1. Checks if the WASM export exists using typeof before calling
// 2. Calls the WASM function if available
// 3. Falls back to JavaScript implementation if WASM is unavailable
//
// The JavaScript fallbacks are identical to the C++ implementations to ensure
// consistent behavior regardless of which implementation is used.
//
// ADDING NEW FUNCTIONS:
// 1. Add the C++ implementation in emscripten/animation.cpp with EMSCRIPTEN_KEEPALIVE
// 2. Add the export name to build.sh EXPORTS list
// 3. Add a wrapper function here with JavaScript fallback
// 4. Run: npm run build:emcc && node emscripten/verify_build.js
// =============================================================================

// Result objects for multi-return functions (reused to avoid allocation)
let accordionResult = { stretchY: 1, widthXZ: 1 };
let fiberResult = { baseRotY: 0, branchRotZ: 0 };
let shiverResult = { rotX: 0, rotZ: 0 };
let spiralResult = { rotY: 0, yOffset: 0, scale: 1 };
let prismResult = { unfurl: 0, spin: 0, pulse: 1, hue: 0 };
let particleResult = { x: 0, y: 0, z: 0 };
let arpeggioResult = { targetStep: 0, unfurlStep: 0 };

/**
 * Calculate accordion stretch animation for instruments.
 * @param {number} animTime - Current animation time
 * @param {number} offset - Phase offset
 * @param {number} intensity - Animation intensity
 * @returns {{stretchY: number, widthXZ: number}} Stretch values
 */
export function calcAccordionStretch(animTime, offset, intensity) {
    // Check if all required WASM exports exist
    if (wasmInstance && 
        typeof wasmInstance.exports.calcAccordionStretch === 'function' &&
        typeof wasmInstance.exports.getAccordionStretchY === 'function' &&
        typeof wasmInstance.exports.getAccordionWidthXZ === 'function') {
        wasmInstance.exports.calcAccordionStretch(animTime, offset, intensity);
        accordionResult.stretchY = wasmInstance.exports.getAccordionStretchY();
        accordionResult.widthXZ = wasmInstance.exports.getAccordionWidthXZ();
    } else {
        // JavaScript fallback - matches C++ implementation in animation.cpp
        const rawStretch = Math.sin(animTime * 10.0 + offset);
        accordionResult.stretchY = 1.0 + Math.max(0, rawStretch) * 0.3 * intensity;
        accordionResult.widthXZ = 1.0 / Math.sqrt(accordionResult.stretchY);
    }
    return accordionResult;
}

/**
 * Calculate fiber whip animation for fiber optic-style trees.
 * This is a key animation function that was often missing from exports.
 * * @param {number} time - Current animation time
 * @param {number} offset - Phase offset for desynchronization
 * @param {number} leadVol - Audio lead volume (0-1)
 * @param {boolean} isActive - Whether audio is currently active
 * @param {number} branchIndex - Index of the branch being animated
 * @returns {{baseRotY: number, branchRotZ: number}} Rotation values in radians
 */
export function calcFiberWhip(time, offset, leadVol, isActive, branchIndex) {
    // Check if all required WASM exports exist before calling
    if (wasmInstance && 
        typeof wasmInstance.exports.calcFiberWhip === 'function' &&
        typeof wasmInstance.exports.getFiberBaseRotY === 'function' &&
        typeof wasmInstance.exports.getFiberBranchRotZ === 'function') {
        wasmInstance.exports.calcFiberWhip(time, offset, leadVol, isActive ? 1 : 0, branchIndex);
        fiberResult.baseRotY = wasmInstance.exports.getFiberBaseRotY();
        fiberResult.branchRotZ = wasmInstance.exports.getFiberBranchRotZ();
    } else {
        // JavaScript fallback - matches C++ implementation in animation.cpp
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
 * Calculate hop Y offset for bouncing objects.
 * @param {number} time - Current animation time
 * @param {number} offset - Phase offset
 * @param {number} intensity - Animation intensity
 * @param {number} kick - Audio kick trigger (0-1)
 * @returns {number} Vertical offset
 */
export function calcHopY(time, offset, intensity, kick) {
    // Check if WASM export exists
    if (wasmInstance && typeof wasmInstance.exports.calcHopY === 'function') {
        return wasmInstance.exports.calcHopY(time, offset, intensity, kick);
    }
    // JavaScript fallback
    const animTime = time + offset;
    const hopVal = Math.sin(animTime * 4.0);
    let bounce = Math.max(0, hopVal) * 0.3 * intensity;
    if (kick > 0.1) bounce += kick * 0.15;
    return bounce;
}

/**
 * Calculate shiver animation for small rapid movements.
 * @param {number} time - Current animation time
 * @param {number} offset - Phase offset
 * @param {number} intensity - Animation intensity
 * @returns {{rotX: number, rotZ: number}} Rotation values
 */
export function calcShiver(time, offset, intensity) {
    // Check if all required WASM exports exist
    if (wasmInstance && 
        typeof wasmInstance.exports.calcShiver === 'function' &&
        typeof wasmInstance.exports.getShiverRotX === 'function' &&
        typeof wasmInstance.exports.getShiverRotZ === 'function') {
        wasmInstance.exports.calcShiver(time, offset, intensity);
        shiverResult.rotX = wasmInstance.exports.getShiverRotX();
        shiverResult.rotZ = wasmInstance.exports.getShiverRotZ();
    } else {
        // JavaScript fallback
        const animTime = time + offset;
        shiverResult.rotX = Math.sin(animTime * 20.0) * 0.02 * intensity;
        shiverResult.rotZ = Math.cos(animTime * 20.0) * 0.02 * intensity;
    }
    return shiverResult;
}

/**
 * Calculate spiral wave animation for rotating objects.
 * @param {number} time - Current animation time
 * @param {number} offset - Phase offset
 * @param {number} intensity - Animation intensity
 * @param {number} groove - Audio groove value
 * @returns {{rotY: number, yOffset: number, scale: number}} Animation values
 */
export function calcSpiralWave(time, offset, intensity, groove) {
    // Check if all required WASM exports exist
    if (wasmInstance && 
        typeof wasmInstance.exports.calcSpiralWave === 'function' &&
        typeof wasmInstance.exports.getSpiralRotY === 'function' &&
        typeof wasmInstance.exports.getSpiralYOffset === 'function' &&
        typeof wasmInstance.exports.getSpiralScale === 'function') {
        wasmInstance.exports.calcSpiralWave(time, offset, intensity, groove);
        spiralResult.rotY = wasmInstance.exports.getSpiralRotY();
        spiralResult.yOffset = wasmInstance.exports.getSpiralYOffset();
        spiralResult.scale = wasmInstance.exports.getSpiralScale();
    } else {
        // JavaScript fallback
        const animTime = time + offset;
        spiralResult.rotY = Math.sin(animTime * 2.0) * 0.2 * intensity;
        spiralResult.yOffset = Math.sin(animTime * 3.0) * 0.1 * (1.0 + groove);
        spiralResult.scale = 1.0 + Math.sin(animTime * 4.0) * 0.05 * intensity;
    }
    return spiralResult;
}

/**
 * Calculate prism rose animation for color-shifting effects.
 * @param {number} time - Current animation time
 * @param {number} offset - Phase offset
 * @param {number} kick - Audio kick trigger
 * @param {number} groove - Audio groove value
 * @param {boolean} isActive - Whether audio is active
 * @returns {{unfurl: number, spin: number, pulse: number, hue: number}} Animation values
 */
export function calcPrismRose(time, offset, kick, groove, isActive) {
    // Check if all required WASM exports exist
    if (wasmInstance && 
        typeof wasmInstance.exports.calcPrismRose === 'function' &&
        typeof wasmInstance.exports.getPrismUnfurl === 'function' &&
        typeof wasmInstance.exports.getPrismSpin === 'function' &&
        typeof wasmInstance.exports.getPrismPulse === 'function' &&
        typeof wasmInstance.exports.getPrismHue === 'function') {
        wasmInstance.exports.calcPrismRose(time, offset, kick, groove, isActive ? 1 : 0);
        prismResult.unfurl = wasmInstance.exports.getPrismUnfurl();
        prismResult.spin = wasmInstance.exports.getPrismSpin();
        prismResult.pulse = wasmInstance.exports.getPrismPulse();
        prismResult.hue = wasmInstance.exports.getPrismHue();
    } else {
        // JavaScript fallback
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
 * Calculate arpeggio step for musical animation.
 * Uses a three-tier fallback: Native C++ -> AssemblyScript -> JavaScript
 * * @param {number} currentUnfurl - Current unfurl value
 * @param {number} currentTarget - Current target step
 * @param {boolean} lastTrigger - Previous trigger state
 * @param {boolean} arpeggioActive - Whether arpeggio is active
 * @param {boolean} noteTrigger - Current note trigger
 * @param {number} maxSteps - Maximum number of steps
 * @returns {{targetStep: number, unfurlStep: number}} Arpeggio values
 */
export function calcArpeggioStep(currentUnfurl, currentTarget, lastTrigger, arpeggioActive, noteTrigger, maxSteps) {
    // 1. Try Native C++ (fastest) - uses getNativeFunc which handles null checks
    const calcFn = getNativeFunc('calcArpeggioStep_c');
    if (calcFn) {
        calcFn(currentUnfurl, currentTarget, lastTrigger ? 1 : 0, arpeggioActive ? 1 : 0, noteTrigger ? 1 : 0, maxSteps);
        const getTarget = getNativeFunc('getArpeggioTargetStep_c');
        const getUnfurl = getNativeFunc('getArpeggioUnfurlStep_c');
        if (getTarget && getUnfurl) {
            arpeggioResult.targetStep = getTarget();
            arpeggioResult.unfurlStep = getUnfurl();
            return arpeggioResult;
        }
    }

    // 2. Try AssemblyScript - check for export existence
    if (wasmInstance && 
        typeof wasmInstance.exports.calcArpeggioStep === 'function' &&
        typeof wasmInstance.exports.getArpeggioTargetStep === 'function' &&
        typeof wasmInstance.exports.getArpeggioUnfurlStep === 'function') {
        wasmInstance.exports.calcArpeggioStep(currentUnfurl, currentTarget, lastTrigger ? 1 : 0, arpeggioActive ? 1 : 0, noteTrigger ? 1 : 0, maxSteps);
        arpeggioResult.targetStep = wasmInstance.exports.getArpeggioTargetStep();
        arpeggioResult.unfurlStep = wasmInstance.exports.getArpeggioUnfurlStep();
        return arpeggioResult;
    }

    // 3. JavaScript Fallback - identical algorithm
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
 * Linearly interpolate between two colors.
 * @param {number} color1 - First color (0xRRGGBB)
 * @param {number} color2 - Second color (0xRRGGBB)
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated color
 */
export function lerpColor(color1, color2, t) {
    // Check for WASM export
    if (wasmInstance && typeof wasmInstance.exports.lerpColor === 'function') {
        return wasmInstance.exports.lerpColor(color1, color2, t);
    }
    // JavaScript fallback
    const r1 = (color1 >> 16) & 0xFF, g1 = (color1 >> 8) & 0xFF, b1 = color1 & 0xFF;
    const r2 = (color2 >> 16) & 0xFF, g2 = (color2 >> 8) & 0xFF, b2 = color2 & 0xFF;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
}

/**
 * Calculate rain drop Y position with cycling.
 * @param {number} startY - Starting Y position
 * @param {number} time - Current time
 * @param {number} speed - Fall speed
 * @param {number} cycleHeight - Height before cycling
 * @returns {number} Current Y position
 */
export function calcRainDropY(startY, time, speed, cycleHeight) {
    // Check for WASM export
    if (wasmInstance && typeof wasmInstance.exports.calcRainDropY === 'function') {
        return wasmInstance.exports.calcRainDropY(startY, time, speed, cycleHeight);
    }
    // JavaScript fallback
    const totalDrop = time * speed;
    const cycled = totalDrop % cycleHeight;
    return startY - cycled;
}

/**
 * Calculate floating particle position.
 * @param {number} baseX - Base X position
 * @param {number} baseY - Base Y position
 * @param {number} baseZ - Base Z position
 * @param {number} time - Current time
 * @param {number} offset - Phase offset
 * @param {number} amplitude - Movement amplitude
 * @returns {{x: number, y: number, z: number}} Particle position
 */
export function calcFloatingParticle(baseX, baseY, baseZ, time, offset, amplitude) {
    // Check for all required WASM exports
    if (wasmInstance && 
        typeof wasmInstance.exports.calcFloatingParticle === 'function' &&
        typeof wasmInstance.exports.getParticleX === 'function' &&
        typeof wasmInstance.exports.getParticleY === 'function' &&
        typeof wasmInstance.exports.getParticleZ === 'function') {
        wasmInstance.exports.calcFloatingParticle(baseX, baseY, baseZ, time, offset, amplitude);
        particleResult.x = wasmInstance.exports.getParticleX();
        particleResult.y = wasmInstance.exports.getParticleY();
        particleResult.z = wasmInstance.exports.getParticleZ();
    } else {
        // JavaScript fallback
        const t = time + offset;
        particleResult.x = baseX + Math.sin(t * 0.5) * amplitude;
        particleResult.y = baseY + Math.sin(t * 0.7) * amplitude * 0.5;
        particleResult.z = baseZ + Math.cos(t * 0.6) * amplitude;
    }
    return particleResult;
}

/**
 * Calculate speaker pulse animation.
 * @param {number} time - Current time
 * @param {number} kick - Audio kick value
 * @param {number} intensity - Animation intensity
 * @returns {number} Scale value
 */
export function calcSpeakerPulse(time, kick, intensity) {
    // Try native C++ wrapper first
    const f = getNativeFunc('calcSpeakerPulse');
    if (f) {
        f(time, kick, intensity);
        const getScale = getNativeFunc('getSpeakerScale');
        if (getScale) {
            return getScale();
        }
    }

    // JavaScript Fallback
    const pulse = kick * 0.4 * intensity;
    const breathe = Math.sin(time * 2.0) * 0.05;
    return 1.0 + pulse + breathe;
}

// =============================================================================
// NATIVE C++ WRAPPERS
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
    let value = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
        value += amp * valueNoise2D(x * freq, y * freq);
        amp *= 0.5;
        freq *= 2;
    }
    return value;
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
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
}

// =============================================================================
// FLUID SIMULATION WRAPPERS
// =============================================================================

export function fluidInit(size) {
    const f = getNativeFunc('fluidInit');
    if (f) f(size);
}

export function fluidStep(dt, visc, diff) {
    const f = getNativeFunc('fluidStep');
    if (f) f(dt, visc, diff);
}

export function fluidAddDensity(x, y, amount) {
    const f = getNativeFunc('fluidAddDensity');
    if (f) f(x, y, amount);
}

export function fluidAddVelocity(x, y, amountX, amountY) {
    const f = getNativeFunc('fluidAddVelocity');
    if (f) f(x, y, amountX, amountY);
}

export function getFluidDensityView(size = 128) {
    const f = getNativeFunc('fluidGetDensityPtr');
    if (f && emscriptenMemory) {
        const ptr = f();
        return new Float32Array(emscriptenMemory, ptr, size * size);
    }
    return null;
}

// Re-exports
export { 
    LOADING_PHASES, 
    isSharedMemoryAvailable,
    initSharedBuffer,
    getSharedBuffer,
    createPlaceholderScene,
    removePlaceholderScene 
} from './wasm-orchestrator.js';
