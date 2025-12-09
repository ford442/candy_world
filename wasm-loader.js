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

// Emscripten module (native C functions)
let emscriptenInstance = null;
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

        // =====================================================================
        // Load Emscripten WASM module (optional - for native C functions)
        // =====================================================================
        try {
            const emResponse = await fetch('./assets/candy_native.wasm?v=' + Date.now());
            if (emResponse.ok) {
                const emBytes = await emResponse.arrayBuffer();

                // Check magic number
                const emMagic = new Uint8Array(emBytes.slice(0, 4));
                if (emMagic[0] === 0 && emMagic[1] === 0x61 && emMagic[2] === 0x73 && emMagic[3] === 0x6d) {
                    const emResult = await WA.instantiate(emBytes, {
                        wasi_snapshot_preview1: wasiStubs,
                        env: {
                            // Emscripten might request this for memory growth
                            emscripten_notify_memory_growth: () => { }
                        }
                    });

                    emscriptenInstance = emResult.instance;
                    emscriptenMemory = emResult.instance.exports.memory;
                    console.log('Emscripten module loaded:', Object.keys(emResult.instance.exports));
                }
            } else {
                console.log('Emscripten WASM not found (optional), skipping');
            }
        } catch (emError) {
            console.warn('Optional Emscripten WASM failed to load:', emError.message);
        }

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

/**
 * Check if Emscripten module is available
 */
export function isEmscriptenReady() {
    return emscriptenInstance !== null;
}

/**
 * 2D Value Noise (Emscripten)
 * @param {number} x 
 * @param {number} y 
 * @returns {number} Noise value -1 to 1
 */
export function valueNoise2D(x, y) {
    if (!emscriptenInstance) {
        // JS fallback - simple hash-based noise
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return n - Math.floor(n);
    }
    return emscriptenInstance.exports._valueNoise2D(x, y);
}

/**
 * Fractal Brownian Motion (layered noise)
 * @param {number} x 
 * @param {number} y 
 * @param {number} octaves - Number of noise layers (default 4)
 * @returns {number} FBM value
 */
export function fbm(x, y, octaves = 4) {
    if (!emscriptenInstance) {
        // JS fallback
        let value = 0, amp = 0.5, freq = 1;
        for (let i = 0; i < octaves; i++) {
            value += amp * valueNoise2D(x * freq, y * freq);
            amp *= 0.5;
            freq *= 2;
        }
        return value;
    }
    return emscriptenInstance.exports._fbm(x, y, octaves);
}

/**
 * Fast inverse square root (Quake III algorithm)
 * @param {number} x 
 * @returns {number} 1/sqrt(x)
 */
export function fastInvSqrt(x) {
    if (!emscriptenInstance) {
        return 1 / Math.sqrt(x);
    }
    return emscriptenInstance.exports._fastInvSqrt(x);
}

/**
 * Fast distance calculation
 */
export function fastDistance(x1, y1, z1, x2, y2, z2) {
    if (!emscriptenInstance) {
        const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return emscriptenInstance.exports._fastDistance(x1, y1, z1, x2, y2, z2);
}

/**
 * Hash function for procedural generation
 */
export function hash(x, y) {
    if (!emscriptenInstance) {
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return (n - Math.floor(n)) * 2 - 1;
    }
    return emscriptenInstance.exports._hash(x, y);
}
