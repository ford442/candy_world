// WASM Loader - Candy World Physics & Animation Module
// Loads and wraps AssemblyScript WASM for easy use from JavaScript

let wasmInstance = null;
let wasmMemory = null;
let positionView = null;   // Float32Array for object positions
let animationView = null;  // Float32Array for animation data
let outputView = null;     // Float32Array for reading results

// Cached WASM function references (more reliable than accessing exports repeatedly)
let wasmGetGroundHeight = null;
let wasmFreqToHue = null;
let wasmLerp = null;

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

/**
 * Initialize the WASM module
 * @returns {Promise<boolean>} True if loaded successfully
 */
export async function initWasm() {
    if (wasmInstance) return true;

    try {
        // Load WASM binary with cache buster
        const response = await fetch('./candy_physics.wasm?v=' + Date.now());
        console.log('Fetch response:', response.status, response.url);

        if (!response.ok) {
            console.warn('WASM not found, using JS fallbacks');
            return false;
        }

        const wasmBytes = await response.arrayBuffer();
        console.log('WASM buffer size:', wasmBytes.byteLength, 'bytes');

        // Check if we got HTML instead of WASM (common 404 issue)
        const firstBytes = new Uint8Array(wasmBytes.slice(0, 4));
        const magic = Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log('WASM magic number:', magic, '(expected: 0061736d)');

        if (magic !== '0061736d') {
            console.error('Invalid WASM file - not a WebAssembly binary!');
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

        // Instantiate with env AND wasi imports
        // Use NativeWebAssembly to bypass libopenmpt's WebAssembly override
        const WA = window.NativeWebAssembly || WebAssembly;
        console.log('Using WebAssembly API:', WA === WebAssembly ? 'Standard (potentially hijacked)' : 'Native (saved)');
        console.log('Attempting WebAssembly.instantiate...');

        const importObject = {
            env: {
                abort: (msg, file, line, col) => {
                    console.error(`WASM abort at ${file}:${line}:${col}: ${msg}`);
                }
            },
            wasi_snapshot_preview1: wasiStubs
        };

        const result = await WA.instantiate(wasmBytes, importObject);

        console.log('Instantiation successful');
        wasmInstance = result.instance;

        // Log available exports for debugging
        const exportKeys = Object.keys(wasmInstance.exports);
        console.log('WASM exports:', exportKeys);
        console.log('Export count:', exportKeys.length);

        // Verify exports exist
        if (!wasmInstance.exports.getGroundHeight) {
            console.error('WASM exports missing getGroundHeight. Available:', exportKeys);
            wasmInstance = null;
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

        console.log('WASM module loaded successfully');
        console.log('WASM exports:', Object.keys(wasmInstance.exports));
        return true;
    } catch (error) {
        console.warn('Failed to load WASM:', error);
        wasmInstance = null;
        return false;
    }
}

/**
 * Check if WASM is available
 */
export function isWasmReady() {
    return wasmInstance !== null;
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
        animationView[idx + 3] = 0; // padding
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
    if (!wasmInstance) {
        // JS fallback - return all visible
        return { visibleCount: objectCount, flags: null };
    }

    const maxDistSq = maxDistance * maxDistance;
    const visibleCount = wasmInstance.exports.batchDistanceCull(
        cameraX, cameraY, cameraZ, maxDistSq, objectCount
    );

    return {
        visibleCount,
        flags: outputView.slice(0, objectCount)
    };
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
