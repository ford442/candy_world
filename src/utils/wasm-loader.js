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

let wasmInstance = null;
let wasmMemory = null;
let emscriptenInstance = null;
let emscriptenMemory = null;

// Memory layout constants
const POSITION_OFFSET = 0;
const ANIMATION_OFFSET = 4096;
const OUTPUT_OFFSET = 8192;
const PLAYER_STATE_OFFSET = 16384;

// Memory Configuration (Must match build.sh)
const INITIAL_MEMORY_PAGES = 4096; // 256MB (256 * 1024 * 1024 / 65536)
const MAX_MEMORY_PAGES = 65536;    // 4GB (required for shared memory growth)

// --- Views ---
let positionView = null;
let animationView = null;
let outputView = null;
let playerStateView = null;

// --- Cached Functions ---
let wasmGetGroundHeight = null;
let wasmFreqToHue = null;
let wasmLerp = null;
let wasmBatchMushroomSpawnCandidates = null;
let wasmUpdateFoliageBatch = null;
let wasmInitCollisionSystem = null;
let wasmAddCollisionObject = null;
let wasmResolveGameCollisions = null;

export const AnimationType = { BOUNCE: 1, SWAY: 2, WOBBLE: 3, HOP: 4 };

// =============================================================================
// LOADER LOGIC
// =============================================================================

async function loadEmscriptenModule(forceSingleThreaded = false) {
    const canUseThreads = typeof SharedArrayBuffer !== 'undefined' && !forceSingleThreaded;

    try {
        await updateProgress('Loading Native Engine...');

        let wasmFilename = 'candy_native.wasm';
        let jsFilename = 'candy_native.js';
        let isThreaded = true;

        if (!canUseThreads) {
            console.warn('[Native] Using Single-Threaded Fallback');
            wasmFilename = 'candy_native_st.wasm';
            jsFilename = 'candy_native_st.js';
            isThreaded = false;
        }

        // 1. Resolve Path
        const wasmCheck = await checkWasmFileExists(wasmFilename);
        if (!wasmCheck.exists) {
            console.log(`[WASM] ${wasmFilename} not found.`);
            if (isThreaded) return loadEmscriptenModule(true);
            return false;
        }

        const prefix = wasmCheck.path || '';
        const cleanPrefix = prefix.endsWith('/') ? prefix : (prefix ? `${prefix}/` : '');
        const resolvedWasmPath = `${cleanPrefix}${wasmFilename}`;
        const resolvedJsPath = jsFilename.includes('://') ? jsFilename : `${cleanPrefix}${jsFilename}`;

        // 2. Load JS Factory
        let createCandyNative;
        try {
            // Adding date to bypass cache if needed
            const module = await import(/* @vite-ignore */ `${resolvedJsPath}?v=${Date.now()}`);
            createCandyNative = module.default;
        } catch (e) {
            console.log(`[WASM] Failed to import ${resolvedJsPath}`, e);
            if (isThreaded) return loadEmscriptenModule(true);
            return false;
        }

        if (isThreaded) await updateProgress('Spawning Physics Workers...');
        else await updateProgress('Initializing Physics (ST)...');

        // Prepare Shared Memory for pthreads builds to avoid LinkError
        let customMemory = null;
        if (isThreaded) {
            try {
                customMemory = new WebAssembly.Memory({
                    initial: INITIAL_MEMORY_PAGES,
                    maximum: MAX_MEMORY_PAGES,
                    shared: true
                });
                console.log('[Native] Created Shared Memory manually.');
            } catch (e) {
                console.warn('[Native] Failed to create Shared Memory. Falling back to ST.', e);
                return loadEmscriptenModule(true);
            }
        }

        const restore = patchWasmInstantiateAliases();
        let wasmBinary = null;

        // 3. Pre-fetch Binary
        try {
             const resp = await fetch(resolvedWasmPath);
             if (resp.ok) wasmBinary = await resp.arrayBuffer();
        } catch(e) {
            console.warn("[WASM] Failed to pre-fetch binary:", e);
        }

        // 4. Instantiate
        try {
            const config = {
                // Provide the explicit memory object for threaded builds
                wasmMemory: customMemory,

                locateFile: (path) => {
                    if (path.endsWith('.wasm')) return resolvedWasmPath;
                    return prefix + path;
                },
                print: (text) => console.log('[Native]', text),
                printErr: (text) => console.warn('[Native Err]', text),
                
                // IMPORTANT: Manual instantiation hook
                // Using standard WebAssembly.instantiate(bytes, imports) handles
                // both compilation and instantiation, avoiding "compile is not a function"
                instantiateWasm: (imports, successCallback) => {
                    const run = async () => {
                        try {
                            let bytes = wasmBinary;
                            if (!bytes) {
                                const r = await fetch(resolvedWasmPath);
                                if (!r.ok) throw new Error(r.statusText);
                                bytes = await r.arrayBuffer();
                            }
                            
                            const WA = window.NativeWebAssembly || WebAssembly;

                            // CRITICAL: Forcefully ensure imports.env.memory is the correct shared memory object
                            if (isThreaded && customMemory) {
                                if (!imports.env) imports.env = {};
                                console.log('[Native] ENFORCING SHARED MEMORY IN IMPORTS'); // Debug Log
                                // Overwrite any placeholder memory with our Shared WebAssembly.Memory
                                imports.env.memory = customMemory;
                            }

                            // Instantiate directly with bytes (handles compile+instantiate)
                            const result = await WA.instantiate(bytes, imports);
                            successCallback(result.instance, result.module);
                            
                        } catch (e) {
                            console.error('[Native] Manual instantiation failed:', e);
                            if (isThreaded) {
                                console.warn('[Native] Retrying with ST fallback...');
                                loadEmscriptenModule(true).then(() => {});
                            }
                        }
                    };
                    run();
                    return {};
                }
            };

            emscriptenInstance = await createCandyNative(config);
            console.log(`[WASM] Emscripten ${isThreaded ? 'Pthreads' : 'Single-Threaded'} Ready`);

        } catch (e) {
            console.warn('[WASM] Instantiation failed:', e);
            restore();
            if (isThreaded) return loadEmscriptenModule(true);
            return false;
        } finally {
            restore();
        }

        if (emscriptenInstance.wasmMemory) emscriptenMemory = emscriptenInstance.wasmMemory;
        else if (emscriptenInstance.HEAP8) emscriptenMemory = emscriptenInstance.HEAP8.buffer;

        return true;
    } catch (e) {
        console.warn('[WASM] Native module unavailable:', e);
        return false;
    }
}

function getNativeFunc(name) {
    if (!emscriptenInstance) return null;
    const uName = '_' + name;
    if (typeof emscriptenInstance[uName] === 'function') return emscriptenInstance[uName];
    if (typeof emscriptenInstance[name] === 'function') return emscriptenInstance[name];
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
    if (startButton) startButton.textContent = msg;
    console.log('[WASM Progress]', msg);
    await new Promise(r => setTimeout(r, 20));
}

export async function initWasm() {
    if (wasmInstance) return true;
    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.disabled = true;
        startButton.style.cursor = 'wait';
    }

    console.log('[WASM] initWasm started');
    await updateProgress('Downloading Physics Engine...');

    try {
        const wasmUrl = './candy_physics.wasm?v=' + Date.now();
        const response = await fetch(wasmUrl);
        if (!response.ok) {
            console.warn('WASM not found, using JS fallbacks');
            if (startButton) startButton.disabled = false;
            return false;
        }

        const wasmBytes = await response.arrayBuffer();
        
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

        await updateProgress('Compiling Physics (WASM)...');
        const WA = window.NativeWebAssembly || WebAssembly;
        
        const importObject = {
            env: {
                abort: (msg, file, line, col) => console.error(`WASM abort: ${msg}`),
                seed: () => Date.now() * Math.random(),
                now: () => Date.now() 
            },
            wasi_snapshot_preview1: wasiStubs
        };

        let result;
        try {
            result = await WA.instantiateStreaming(fetch(wasmUrl), importObject);
        } catch (streamError) {
            result = await WA.instantiate(wasmBytes, importObject);
        }

        if (window.setLoadingStatus) window.setLoadingStatus("Physics Engine Ready...");
        wasmInstance = result.instance;

        // Cache references
        if (wasmInstance.exports.memory) {
            wasmMemory = wasmInstance.exports.memory;
            const memBuffer = wasmMemory.buffer;
            positionView = new Float32Array(memBuffer, POSITION_OFFSET, 1024);
            animationView = new Float32Array(memBuffer, ANIMATION_OFFSET, 1024);
            outputView = new Float32Array(memBuffer, OUTPUT_OFFSET, 1024);
            playerStateView = new Float32Array(memBuffer, PLAYER_STATE_OFFSET, 8);
        }

        wasmGetGroundHeight = wasmInstance.exports.getGroundHeight;
        wasmFreqToHue = wasmInstance.exports.freqToHue;
        wasmLerp = wasmInstance.exports.lerp;
        wasmBatchMushroomSpawnCandidates = wasmInstance.exports.batchMushroomSpawnCandidates || null;
        wasmUpdateFoliageBatch = wasmInstance.exports.updateFoliageBatch || null;
        wasmInitCollisionSystem = wasmInstance.exports.initCollisionSystem || null;
        wasmAddCollisionObject = wasmInstance.exports.addCollisionObject || null;
        wasmResolveGameCollisions = wasmInstance.exports.resolveGameCollisions || null;

        await loadEmscriptenModule();
        if (emscriptenInstance) await startBootstrapIfAvailable(emscriptenInstance);

        if (startButton) {
            startButton.disabled = false;
            startButton.textContent = 'Start Exploration 🚀';
            startButton.style.cursor = 'pointer';
        }
        return true;
    } catch (error) {
        console.warn('Failed to load WASM:', error);
        showToast("Physics Engine Failed to Load", "❌");
        if (startButton) startButton.disabled = false;
        return false;
    }
}

export async function initWasmParallel(options = {}) {
    if (wasmInstance) return true;
    const { onProgress = (phase, msg) => {
        if (window.setLoadingStatus) window.setLoadingStatus(msg);
    } } = options;

    try {
        const result = await parallelWasmLoad({
            onProgress,
            ascWasmUrl: './candy_physics.wasm',
            emccWasmUrl: './candy_native.wasm'
        });

        if (result.asc) {
            wasmInstance = result.asc;
            if (wasmInstance.exports.memory) {
                wasmMemory = wasmInstance.exports.memory;
                const memBuffer = wasmMemory.buffer;
                positionView = new Float32Array(memBuffer, POSITION_OFFSET, 1024);
                animationView = new Float32Array(memBuffer, ANIMATION_OFFSET, 1024);
                outputView = new Float32Array(memBuffer, OUTPUT_OFFSET, 1024);
                playerStateView = new Float32Array(memBuffer, PLAYER_STATE_OFFSET, 8);
            }
            wasmGetGroundHeight = wasmInstance.exports.getGroundHeight;
            wasmFreqToHue = wasmInstance.exports.freqToHue;
            wasmLerp = wasmInstance.exports.lerp;
            wasmBatchMushroomSpawnCandidates = wasmInstance.exports.batchMushroomSpawnCandidates || null;
            wasmUpdateFoliageBatch = wasmInstance.exports.updateFoliageBatch || null;
            wasmInitCollisionSystem = wasmInstance.exports.initCollisionSystem || null;
            wasmAddCollisionObject = wasmInstance.exports.addCollisionObject || null;
            wasmResolveGameCollisions = wasmInstance.exports.resolveGameCollisions || null;
        }

        if (result.emcc) {
            emscriptenInstance = result.emcc;
            emscriptenMemory = emscriptenInstance.exports && emscriptenInstance.exports.memory;
            const initFn = getNativeFunc('init_native');
            if (initFn) setTimeout(initFn, 0);
            await startBootstrapIfAvailable(emscriptenInstance);
        }
        return wasmInstance !== null;
    } catch (error) {
        console.warn('[WASM] Parallel init failed, falling back to sequential:', error);
        return await initWasm();
    }
}

// =============================================================================
// CRITICAL EXPORTS (Ensured they exist for build tools)
// =============================================================================

export function isWasmReady() { return wasmInstance !== null; }
export function isEmscriptenReady() { return emscriptenInstance !== null; }
export function getWasmInstance() { return wasmInstance; }

// =============================================================================
// COLLISION WRAPPERS
// =============================================================================

export function uploadCollisionObjects(caves, mushrooms, clouds, trampolines) {
    if (!wasmInitCollisionSystem || !wasmAddCollisionObject) return false;
    wasmInitCollisionSystem();

    // 1. Gates (Type 3)
    if (caves) {
        caves.forEach(cave => {
            if (cave.userData.isBlocked) {
                const gatePos = cave.userData.gatePosition.clone().applyMatrix4(cave.matrixWorld);
                wasmAddCollisionObject(3, gatePos.x, gatePos.y, gatePos.z, 2.5, 5.0, 0, 0);
            }
        });
    }
    // 2. Mushrooms (Type 1 & 4)
    if (mushrooms) {
        mushrooms.forEach(m => {
            const type = m.userData.isTrampoline ? 4 : 1;
            wasmAddCollisionObject(type, m.position.x, m.position.y, m.position.z,
                m.userData.capRadius || 2.0, m.userData.capHeight || 3.0, 0, 0);
        });
    }
    // 3. Clouds (Type 2)
    if (clouds) {
        clouds.forEach(c => {
             if (c.userData.tier === 1) {
                 wasmAddCollisionObject(2, c.position.x, c.position.y, c.position.z,
                    c.scale.x || 1.0, c.scale.y || 1.0, 0, 0);
             }
        });
    }
    return true;
}

export function resolveGameCollisionsWASM(player, kickTrigger) {
    if (!wasmResolveGameCollisions || !playerStateView) return false;
    playerStateView[0] = player.position.x;
    playerStateView[1] = player.position.y;
    playerStateView[2] = player.position.z;
    playerStateView[3] = player.velocity.x;
    playerStateView[4] = player.velocity.y;
    playerStateView[5] = player.velocity.z;
    playerStateView[6] = player.isGrounded ? 1.0 : 0.0;

    const result = wasmResolveGameCollisions(kickTrigger);

    if (result === 1) {
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
// MATH & BATCH FUNCTIONS
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
// ANIMATION HELPERS (Results Reused)
// =============================================================================

let accordionResult = { stretchY: 1, widthXZ: 1 };
let fiberResult = { baseRotY: 0, branchRotZ: 0 };
let shiverResult = { rotX: 0, rotZ: 0 };
let spiralResult = { rotY: 0, yOffset: 0, scale: 1 };
let prismResult = { unfurl: 0, spin: 0, pulse: 1, hue: 0 };
let particleResult = { x: 0, y: 0, z: 0 };
let arpeggioResult = { targetStep: 0, unfurlStep: 0 };

export function calcBounceY(time, offset, intensity, kick) {
    if (wasmInstance && typeof wasmInstance.exports.calcBounceY === 'function') {
        return wasmInstance.exports.calcBounceY(time, offset, intensity, kick);
    }
    const animTime = time + offset;
    let yOffset = Math.sin(animTime * 3) * 0.1 * intensity;
    if (kick > 0.1) yOffset += kick * 0.2;
    return yOffset;
}

export function calcSwayRotZ(time, offset, intensity) {
    if (wasmInstance && typeof wasmInstance.exports.calcSwayRotZ === 'function') {
        return wasmInstance.exports.calcSwayRotZ(time, offset, intensity);
    }
    return Math.sin(time + offset) * 0.1 * intensity;
}

export function calcWobble(time, offset, intensity) {
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
    const animTime = time + offset;
    return {
        rotX: Math.sin(animTime * 3) * 0.15 * intensity,
        rotZ: Math.cos(animTime * 3) * 0.15 * intensity
    };
}

export function calcAccordionStretch(animTime, offset, intensity) {
    if (wasmInstance && 
        typeof wasmInstance.exports.calcAccordionStretch === 'function' &&
        typeof wasmInstance.exports.getAccordionStretchY === 'function' &&
        typeof wasmInstance.exports.getAccordionWidthXZ === 'function') {
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

export function calcFiberWhip(time, offset, leadVol, isActive, branchIndex) {
    if (wasmInstance && 
        typeof wasmInstance.exports.calcFiberWhip === 'function' &&
        typeof wasmInstance.exports.getFiberBaseRotY === 'function' &&
        typeof wasmInstance.exports.getFiberBranchRotZ === 'function') {
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

export function calcHopY(time, offset, intensity, kick) {
    if (wasmInstance && typeof wasmInstance.exports.calcHopY === 'function') {
        return wasmInstance.exports.calcHopY(time, offset, intensity, kick);
    }
    const animTime = time + offset;
    const hopVal = Math.sin(animTime * 4.0);
    let bounce = Math.max(0, hopVal) * 0.3 * intensity;
    if (kick > 0.1) bounce += kick * 0.15;
    return bounce;
}

export function calcShiver(time, offset, intensity) {
    if (wasmInstance && 
        typeof wasmInstance.exports.calcShiver === 'function' &&
        typeof wasmInstance.exports.getShiverRotX === 'function' &&
        typeof wasmInstance.exports.getShiverRotZ === 'function') {
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

export function calcSpiralWave(time, offset, intensity, groove) {
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
        const animTime = time + offset;
        spiralResult.rotY = Math.sin(animTime * 2.0) * 0.2 * intensity;
        spiralResult.yOffset = Math.sin(animTime * 3.0) * 0.1 * (1.0 + groove);
        spiralResult.scale = 1.0 + Math.sin(animTime * 4.0) * 0.05 * intensity;
    }
    return spiralResult;
}

export function calcPrismRose(time, offset, kick, groove, isActive) {
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
        const animTime = time + offset;
        const intensity = isActive ? (1.0 + groove * 3.0) : 0.3;
        prismResult.unfurl = Math.sin(animTime * 2.0) * 0.1 * intensity;
        prismResult.spin = animTime * 0.5 + groove * 2.0;
        prismResult.pulse = 1.0 + kick * 0.3;
        prismResult.hue = (animTime * 0.1) % 1.0;
    }
    return prismResult;
}

// === THIS IS THE FUNCTION YOU ADDED EXPORT TO PREVIOUSLY ===
export function calcArpeggioStep(currentUnfurl, currentTarget, lastTrigger, arpeggioActive, noteTrigger, maxSteps) {
    // 1. Try Native C++
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
    // 2. Try AssemblyScript
    if (wasmInstance && 
        typeof wasmInstance.exports.calcArpeggioStep === 'function' &&
        typeof wasmInstance.exports.getArpeggioTargetStep === 'function' &&
        typeof wasmInstance.exports.getArpeggioUnfurlStep === 'function') {
        wasmInstance.exports.calcArpeggioStep(currentUnfurl, currentTarget, lastTrigger ? 1 : 0, arpeggioActive ? 1 : 0, noteTrigger ? 1 : 0, maxSteps);
        arpeggioResult.targetStep = wasmInstance.exports.getArpeggioTargetStep();
        arpeggioResult.unfurlStep = wasmInstance.exports.getArpeggioUnfurlStep();
        return arpeggioResult;
    }
    // 3. JavaScript Fallback
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

export function lerpColor(color1, color2, t) {
    if (wasmInstance && typeof wasmInstance.exports.lerpColor === 'function') {
        return wasmInstance.exports.lerpColor(color1, color2, t);
    }
    const r1 = (color1 >> 16) & 0xFF, g1 = (color1 >> 8) & 0xFF, b1 = color1 & 0xFF;
    const r2 = (color2 >> 16) & 0xFF, g2 = (color2 >> 8) & 0xFF, b2 = color2 & 0xFF;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
}

export function calcRainDropY(startY, time, speed, cycleHeight) {
    if (wasmInstance && typeof wasmInstance.exports.calcRainDropY === 'function') {
        return wasmInstance.exports.calcRainDropY(startY, time, speed, cycleHeight);
    }
    const totalDrop = time * speed;
    const cycled = totalDrop % cycleHeight;
    return startY - cycled;
}

export function calcFloatingParticle(baseX, baseY, baseZ, time, offset, amplitude) {
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
        const t = time + offset;
        particleResult.x = baseX + Math.sin(t * 0.5) * amplitude;
        particleResult.y = baseY + Math.sin(t * 0.7) * amplitude * 0.5;
        particleResult.z = baseZ + Math.cos(t * 0.6) * amplitude;
    }
    return particleResult;
}

export function calcSpeakerPulse(time, kick, intensity) {
    const f = getNativeFunc('calcSpeakerPulse');
    if (f) {
        f(time, kick, intensity);
        const getScale = getNativeFunc('getSpeakerScale');
        if (getScale) return getScale();
    }
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
    const x = getNativeFunc('getPlayerX') ? getNativeFunc('getPlayerX')() : 0;
    const y = getNativeFunc('getPlayerY') ? getNativeFunc('getPlayerY')() : 0;
    const z = getNativeFunc('getPlayerZ') ? getNativeFunc('getPlayerZ')() : 0;
    const vx = getNativeFunc('getPlayerVX') ? getNativeFunc('getPlayerVX')() : 0;
    const vy = getNativeFunc('getPlayerVY') ? getNativeFunc('getPlayerVY')() : 0;
    const vz = getNativeFunc('getPlayerVZ') ? getNativeFunc('getPlayerVZ')() : 0;
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

// Re-exports
export { 
    LOADING_PHASES, 
    isSharedMemoryAvailable,
    initSharedBuffer,
    getSharedBuffer,
    createPlaceholderScene,
    removePlaceholderScene 
} from './wasm-orchestrator.js';