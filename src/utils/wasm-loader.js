// src/utils/wasm-loader.js

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
let emscriptenMemory = null;

// Memory layout constants (must match AssemblyScript)
const POSITION_OFFSET = 0;
const ANIMATION_OFFSET = 4096;
const OUTPUT_OFFSET = 8192;

// Particle system constants
const PARTICLE_HALF_AREA = 50.0; // Firefly boundary limit (±50)

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
        this.memory = module.wasmMemory || module.memory || (module.exports && module.exports.memory) || module.HEAP8.buffer;
    }

    malloc(size) {
        if (!this.module._malloc) return 0n;
        return this.module._malloc(BigInt(size));
    }

    free(ptr) {
        if (!this.module._free) return;
        this.module._free(BigInt(ptr));
    }

    readFloat32Array(ptr, length) {
        const offset = Number(ptr);
        const buffer = this.module.HEAPF32 ? this.module.HEAPF32.buffer : this.memory.buffer;
        return new Float32Array(buffer, offset, length);
    }
    
    call(funcName, ...args) {
        const func = this.module['_' + funcName] || this.module[funcName];
        if (!func) return null;
        return func(...args);
    }
}

// =============================================================================
// UPDATED: Load Emscripten Module (Pthreads/Worker Version)
// =============================================================================

async function loadEmscriptenModule() {
    if (typeof SharedArrayBuffer === 'undefined') {
        console.error('[Native] SharedArrayBuffer is missing. Pthreads will NOT work.');
        return false;
    }

    // 1. Restore Native WebAssembly to bypass libopenmpt shim
    const hijackedWA = window.WebAssembly;
    const nativeWA = window.NativeWebAssembly || hijackedWA;
    
    if (hijackedWA !== nativeWA) {
        console.log('[WASM] Temporarily restoring Native WebAssembly for 64-bit Engine load...');
        window.WebAssembly = nativeWA;
    }

    try {
        await updateProgress('Loading Native Engine...');

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
        wasmBridge = new WasmBridge(emscriptenInstance);

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
        if (window.WebAssembly !== hijackedWA) {
            window.WebAssembly = hijackedWA;
        }
    }
}

function getNativeFunc(name) {
    if (!emscriptenInstance) return null;
    return emscriptenInstance['_' + name] || null;
}

// ... (Bootstrap loader remains the same) ...
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
    await new Promise(r => setTimeout(r, 20));
}

export async function initWasm() {
    if (wasmInstance) return true;

    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.disabled = true;
        startButton.style.cursor = 'wait';
    }

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
            fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0, fd_read: () => 0,
            fd_fdstat_get: () => 0, fd_prestat_get: () => 0, fd_prestat_dir_name: () => 0,
            path_open: () => 0, environ_sizes_get: () => 0, environ_get: () => 0,
            proc_exit: () => { }, clock_time_get: () => 0,
        };

        await updateProgress('Compiling Physics (WASM)...');

        const WA = window.NativeWebAssembly || WebAssembly;
        
        const importObject = {
            env: { abort: (msg, file, line, col) => console.error(`WASM abort: ${msg}`) },
            wasi_snapshot_preview1: wasiStubs
        };

        let result;
        try {
            result = await WA.instantiateStreaming(fetch(wasmUrl), importObject);
        } catch (streamError) {
            result = await WA.instantiate(wasmBytes, importObject);
        }

        wasmInstance = result.instance;

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
        wasmInstance = null;
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

    // Capture Native WA before parallel load starts
    const hijackedWA = window.WebAssembly;
    const nativeWA = window.NativeWebAssembly || hijackedWA;
    if (hijackedWA !== nativeWA) window.WebAssembly = nativeWA;

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
            }
            wasmGetGroundHeight = wasmInstance.exports.getGroundHeight;
            wasmFreqToHue = wasmInstance.exports.freqToHue;
            wasmLerp = wasmInstance.exports.lerp;
            wasmBatchMushroomSpawnCandidates = wasmInstance.exports.batchMushroomSpawnCandidates || null;
            wasmUpdateFoliageBatch = wasmInstance.exports.updateFoliageBatch || null;
        }

        if (result.emcc) {
            emscriptenInstance = result.emcc;
            emscriptenMemory = emscriptenInstance.exports && emscriptenInstance.exports.memory;
            
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
        return await initWasm();
    } finally {
         if (window.WebAssembly !== hijackedWA) window.WebAssembly = hijackedWA;
    }
}

export function isWasmReady() { return wasmInstance !== null; }
export function isEmscriptenReady() { return emscriptenInstance !== null; }
export function getWasmInstance() { return wasmInstance; }

// =============================================================================
// SIMPLE MATH FUNCTIONS
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
    if (!wasmInstance) return { visibleCount: objectCount, flags: null };
    if (objectCount > 5000) return { visibleCount: objectCount, flags: null };

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
// ANIMATION HELPERS
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
        return { rotX: wasmInstance.exports.getWobbleX(), rotZ: wasmInstance.exports.getWobbleZ() };
    }
    const animTime = time + offset;
    return { rotX: Math.sin(animTime * 3) * 0.15 * intensity, rotZ: Math.cos(animTime * 3) * 0.15 * intensity };
}

export function checkCollision(playerX, playerZ, playerRadius, objectCount) {
    if (!wasmInstance) return false;
    return wasmInstance.exports.checkCollision(playerX, playerZ, playerRadius, objectCount) === 1;
}

// Result caches
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
        if (isActive) fiberResult.branchRotZ += Math.sin(time * 10.0 + childOffset) * whip;
    }
    return fiberResult;
}

export function calcHopY(time, offset, intensity, kick) {
    if (wasmInstance) return wasmInstance.exports.calcHopY(time, offset, intensity, kick);
    const animTime = time + offset;
    let bounce = Math.max(0, Math.sin(animTime * 4.0)) * 0.3 * intensity;
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

// THIS WAS MISSING from export!
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

/**
 * JS fallback implementation for particle updates
 */
function updateParticlesJS(positions, phases, count, time) {
    for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const phase = phases[i];
        
        const driftX = Math.sin(time * 0.3 + phase) * 0.02;
        const driftY = Math.cos(time * 0.5 + phase * 1.3) * 0.01;
        const driftZ = Math.sin(time * 0.4 + phase * 0.7) * 0.02;
        
        positions[idx] += driftX;
        positions[idx + 1] += driftY;
        positions[idx + 2] += driftZ;
        
        if (positions[idx] > PARTICLE_HALF_AREA) positions[idx] = -PARTICLE_HALF_AREA;
        if (positions[idx] < -PARTICLE_HALF_AREA) positions[idx] = PARTICLE_HALF_AREA;
        if (positions[idx + 1] < 0.3) positions[idx + 1] = 0.3;
        if (positions[idx + 1] > 5) positions[idx + 1] = 5;
        if (positions[idx + 2] > PARTICLE_HALF_AREA) positions[idx + 2] = -PARTICLE_HALF_AREA;
        if (positions[idx + 2] < -PARTICLE_HALF_AREA) positions[idx + 2] = PARTICLE_HALF_AREA;
    }
}

/**
 * Update firefly particles using WASM for performance
 * 
 * @param {Float32Array} positions - Particle positions array
 * @param {Float32Array} phases - Particle phase offsets array  
 * @param {number} count - Number of particles
 * @param {number} time - Current animation time
 */
export function updateParticles(positions, phases, count, time) {
    if (!wasmInstance) {
        // JS fallback when WASM not available
        updateParticlesJS(positions, phases, count, time);
        return;
    }
    
    // Bounds checking for WASM memory regions
    const MAX_POSITION_FLOATS = 1024; // positionView buffer capacity
    const MAX_PHASE_FLOATS = 1024;    // animationView buffer capacity
    
    // Positions need 3 floats per particle (x,y,z), max capacity is 341 particles
    // Phases need 1 float per particle
    if (count * 3 > MAX_POSITION_FLOATS || count > MAX_PHASE_FLOATS) {
        console.warn(`Particle count ${count} exceeds WASM buffer capacity (max 341 particles). Using JS fallback.`);
        updateParticlesJS(positions, phases, count, time);
        return;
    }
    
    // Copy data to WASM memory
    const positionsPtr = POSITION_OFFSET;
    const phasesPtr = ANIMATION_OFFSET;
    
    const memBuffer = wasmMemory.buffer;
    const wasmPositions = new Float32Array(memBuffer, positionsPtr, count * 3);
    const wasmPhases = new Float32Array(memBuffer, phasesPtr, count);
    
    // Upload to WASM
    for (let i = 0; i < count * 3; i++) {
        wasmPositions[i] = positions[i];
    }
    for (let i = 0; i < count; i++) {
        wasmPhases[i] = phases[i];
    }
    
    // Call WASM function
    wasmInstance.exports.updateParticles(positionsPtr, phasesPtr, count, time);
    
    // Copy results back
    for (let i = 0; i < count * 3; i++) {
        positions[i] = wasmPositions[i];
    }
}

// =============================================================================
// EMSCRIPTEN NATIVE EXPORTS
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
    if (!emscriptenInstance) return { x:0, y:0, z:0, vx:0, vy:0, vz:0 };
    return {
        x: getNativeFunc('getPlayerX')(),
        y: getNativeFunc('getPlayerY')(),
        z: getNativeFunc('getPlayerZ')(),
        vx: getNativeFunc('getPlayerVX')(),
        vy: getNativeFunc('getPlayerVY')(),
        vz: getNativeFunc('getPlayerVZ')()
    };
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

export { 
    LOADING_PHASES, 
    isSharedMemoryAvailable,
    initSharedBuffer,
    getSharedBuffer,
    createPlaceholderScene,
    removePlaceholderScene 
} from './wasm-orchestrator.js';
