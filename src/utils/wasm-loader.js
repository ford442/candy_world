// src/utils/wasm-loader.js

import { 
    parallelWasmLoad, 
    LOADING_PHASES, 
    initSharedBuffer, 
    getSharedBuffer,
    isSharedMemoryAvailable 
} from './wasm-orchestrator.js';

import { checkWasmFileExists, inspectWasmExports, patchWasmInstantiateAliases } from './wasm-utils.js';

// FIX: Correct import for toast
import { showToast } from './toast.js';

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
// UPDATED: Load Emscripten Module (Pthreads/Worker Version)
// =============================================================================

async function loadEmscriptenModule() {
    if (typeof SharedArrayBuffer === 'undefined') {
        console.warn('[Native] SharedArrayBuffer is missing. Pthreads will NOT work. Using JS fallback.');
        return false;
    }

    try {
        await updateProgress('Loading Native Engine...');

        // Check if WASM file exists first
        const wasmCheck = await checkWasmFileExists('candy_native.wasm');
        if (!wasmCheck.exists) {
            console.log('[WASM] candy_native.wasm not found. Using JS fallback.');
            return false;
        }

        const locatePrefix = wasmCheck.path;

        // Preflight: inspect wasm exports to ensure it contains the expected symbols
        try {
            const exports = await inspectWasmExports('candy_native.wasm');
            console.log('[WASM] candy_native.wasm exports:', exports);
            const expected = ['calcSpeakerPulse','_calcSpeakerPulse','getSpeakerYOffset','_getSpeakerYOffset'];
            const has = exports && expected.some(n => exports.includes(n));
            if (!has) {
                console.warn('[WASM] candy_native.wasm missing expected exports; using JS fallback.');
                return false;
            }
        } catch (inspectErr) {
            console.warn('[WASM] Unable to inspect candy_native.wasm before load:', inspectErr);
        }

        let createCandyNative;

        // Try to load the JS loader
        try {
            const module = await import(/* @vite-ignore */ `${locatePrefix}/candy_native.js?v=${Date.now()}`);
            createCandyNative = module.default;
        } catch (e) {
            console.log('[WASM] candy_native.js not found. Using JS fallback.');
            return false;
        }

        await updateProgress('Spawning Physics Workers...');

        // Apply instantiate alias patch to prevent aborts when only underscored exports exist
        const restore = patchWasmInstantiateAliases();
        try {
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
        } finally {
            restore();
        }

        if (emscriptenInstance.wasmMemory) {
            emscriptenMemory = emscriptenInstance.wasmMemory;
        } else if (emscriptenInstance.HEAP8) {
            emscriptenMemory = emscriptenInstance.HEAP8.buffer;
        }

        return true;
    } catch (e) {
        console.warn('[WASM] Native module unavailable, using JS fallback:', e);
        return false;
    }
}

function getNativeFunc(name) {
    if (!emscriptenInstance) return null;
    return emscriptenInstance['_' + name] || null;
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
        
        // WASI stubs with BigInt Safety
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
            // Robust clock_time_get handling BigInt mixing
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
                abort: (msg, file, line, col) => {
                    console.error(`WASM abort at ${file}:${line}:${col}: ${msg}`);
                },
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

        // Verify exports
        if (!wasmInstance.exports.getGroundHeight) {
            console.error('WASM exports missing getGroundHeight');
            if (startButton) startButton.disabled = false;
            return false;
        }

        if (wasmInstance.exports.memory) {
            wasmMemory = wasmInstance.exports.memory;
            const memBuffer = wasmMemory.buffer;
            positionView = new Float32Array(memBuffer, POSITION_OFFSET, 1024);
            animationView = new Float32Array(memBuffer, ANIMATION_OFFSET, 1024);
            outputView = new Float32Array(memBuffer, OUTPUT_OFFSET, 1024);
            playerStateView = new Float32Array(memBuffer, PLAYER_STATE_OFFSET, 8);
        }

        // Cache references
        wasmGetGroundHeight = wasmInstance.exports.getGroundHeight;
        wasmFreqToHue = wasmInstance.exports.freqToHue;
        wasmLerp = wasmInstance.exports.lerp;
        wasmBatchMushroomSpawnCandidates = wasmInstance.exports.batchMushroomSpawnCandidates || null;
        wasmUpdateFoliageBatch = wasmInstance.exports.updateFoliageBatch || null;

        // Physics collision
        wasmInitCollisionSystem = wasmInstance.exports.initCollisionSystem || null;
        wasmAddCollisionObject = wasmInstance.exports.addCollisionObject || null;
        wasmResolveGameCollisions = wasmInstance.exports.resolveGameCollisions || null;

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

    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.disabled = true;
        startButton.style.cursor = 'wait';
    }

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

        if (startButton) {
            startButton.disabled = false;
            startButton.textContent = 'Start Exploration 🚀';
            startButton.style.cursor = 'pointer';
        }

        return wasmInstance !== null;
    } catch (error) {
        console.warn('[WASM] Parallel init failed, falling back to sequential:', error);
        return await initWasm();
    }
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

// ... Rest of the file unchanged ... (I will re-add the math helpers below)

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

export function checkCollision(playerX, playerZ, playerRadius, objectCount) {
    if (!wasmInstance) return false;
    return wasmInstance.exports.checkCollision(playerX, playerZ, playerRadius, objectCount) === 1;
}

// =============================================================================
// ADVANCED ANIMATION WRAPPERS (The Missing Exports)
// =============================================================================

let speakerResult = { yOffset: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
let accordionResult = { stretchY: 1, widthXZ: 1 };
let fiberResult = { baseRotY: 0, branchRotZ: 0 };
let shiverResult = { rotX: 0, rotZ: 0 };
let spiralResult = { rotY: 0, yOffset: 0, scale: 1 };
let prismResult = { unfurl: 0, spin: 0, pulse: 1, hue: 0 };
let particleResult = { x: 0, y: 0, z: 0 };
let arpeggioResult = { targetStep: 0, unfurlStep: 0 };

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

export function calcHopY(time, offset, intensity, kick) {
    if (wasmInstance) return wasmInstance.exports.calcHopY(time, offset, intensity, kick);
    const animTime = time + offset;
    const hopVal = Math.sin(animTime * 4.0);
    let bounce = Math.max(0, hopVal) * 0.3 * intensity;
    if (kick > 0.1) bounce += kick * 0.15;
    return bounce;
}

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

export function calcArpeggioStep(currentUnfurl, currentTarget, lastTrigger, arpeggioActive, noteTrigger, maxSteps) {
    // 1. Try Native C++ (fastest)
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
    if (wasmInstance && wasmInstance.exports.calcArpeggioStep) {
        wasmInstance.exports.calcArpeggioStep(currentUnfurl, currentTarget, lastTrigger ? 1 : 0, arpeggioActive ? 1 : 0, noteTrigger ? 1 : 0, maxSteps);
        arpeggioResult.targetStep = wasmInstance.exports.getArpeggioTargetStep();
        arpeggioResult.unfurlStep = wasmInstance.exports.getArpeggioUnfurlStep();
        return arpeggioResult;
    }

    // 3. JS Fallback
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
    if (wasmInstance) return wasmInstance.exports.lerpColor(color1, color2, t);
    const r1 = (color1 >> 16) & 0xFF, g1 = (color1 >> 8) & 0xFF, b1 = color1 & 0xFF;
    const r2 = (color2 >> 16) & 0xFF, g2 = (color2 >> 8) & 0xFF, b2 = color2 & 0xFF;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
}

export function calcRainDropY(startY, time, speed, cycleHeight) {
    if (wasmInstance) return wasmInstance.exports.calcRainDropY(startY, time, speed, cycleHeight);
    const totalDrop = time * speed;
    const cycled = totalDrop % cycleHeight;
    return startY - cycled;
}

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

// Re-exports
export { 
    LOADING_PHASES, 
    isSharedMemoryAvailable,
    initSharedBuffer,
    getSharedBuffer,
    createPlaceholderScene,
    removePlaceholderScene 
} from './wasm-orchestrator.js';
