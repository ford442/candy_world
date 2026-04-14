/**
 * @file wasm-physics.ts
 * @brief Physics Functions with WASM and JavaScript Fallbacks
 * 
 * This module contains:
 * - Collision system: uploadCollisionObjects, resolveGameCollisionsWASM
 * - Physics helpers: initCollisionSystem, addCollisionObject, checkPositionValidity
 * - Native C++ physics wrappers: updatePhysicsCPP, initPhysics, addObstacle, uploadObstaclesBatch
 * - Player state: setPlayerState, getPlayerState
 * - Math fallbacks: valueNoise2D, fbm, fastInvSqrt, fastDistance, hash
 */

import { 
    wasmInstance,
    wasmMemory,
    wasmInitCollisionSystem,
    wasmAddCollisionObject,
    wasmResolveGameCollisions,
    wasmCheckPositionValidity,
    emscriptenInstance,
    emscriptenMemory,
    playerStateView,
    wasmGetGroundHeight,
    wasmFreqToHue,
    wasmLerp,
    getNativeFunc,
    POSITION_OFFSET,
    type WasmExports,
    type Cave,
    type Mushroom,
    type Cloud,
    type Trampoline,
    type PlayerState
} from './wasm-loader-core.js';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Player state result
 */
export interface PlayerStateResult {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
}

// =============================================================================
// COLLISION SYSTEM
// =============================================================================

/**
 * Upload collision objects to WASM
 * @param caves - Array of cave objects
 * @param mushrooms - Array of mushroom objects
 * @param clouds - Array of cloud objects
 * @param trampolines - Array of trampoline objects
 * @returns True if upload was successful
 */
export function uploadCollisionObjects(
    caves: Cave[] | undefined, 
    mushrooms: Mushroom[] | undefined, 
    clouds: Cloud[] | undefined, 
    trampolines: Trampoline[] | undefined
): boolean {
    if (!wasmInitCollisionSystem || !wasmAddCollisionObject) return false;

    wasmInitCollisionSystem();

    // ⚡ PERFORMANCE: Use batch upload instead of sequential calls
    // TYPE_MUSHROOM = 1, TYPE_CLOUD = 2, TYPE_GATE = 3, TYPE_TRAMPOLINE = 4

    // Calculate total count first
    // ⚡ OPTIMIZATION: Eliminated array allocations (.filter) in hot update path to prevent GC spikes
    let totalCount = 0;
    if (caves) {
        for (let i = 0; i < caves.length; i++) {
            if (caves[i].userData.isBlocked) totalCount++;
        }
    }
    if (mushrooms) totalCount += mushrooms.length;
    if (clouds) {
        for (let i = 0; i < clouds.length; i++) {
            if (clouds[i].userData.tier === 1) totalCount++;
        }
    }

    if (totalCount === 0) {
        console.log('[WASM] No collision objects to upload.');
        return true;
    }

    const exports = wasmInstance!.exports as WasmExports;
    
    // Check if batch function exists
    const hasBatchFunction = exports.addCollisionObjectsBatch;

    if (hasBatchFunction) {
        // Use batch upload - reduces JS<->WASM bridge crossings from N to 1
        const BATCH_SIZE = 8; // [type, x, y, z, r, h, p1, p2]
        const batchData = new Float32Array(totalCount * BATCH_SIZE);
        let ptr = 0;

        // 1. Gates
        if (caves) {
            for (const cave of caves) {
                if (cave.userData.isBlocked) {
                    const gatePos = cave.userData.gatePosition.clone().applyMatrix4(cave.matrixWorld);
                    batchData[ptr++] = 3; // type
                    batchData[ptr++] = gatePos.x;
                    batchData[ptr++] = gatePos.y;
                    batchData[ptr++] = gatePos.z;
                    batchData[ptr++] = 2.5; // r
                    batchData[ptr++] = 5.0; // h
                    batchData[ptr++] = 0;   // p1
                    batchData[ptr++] = 0;   // p2
                }
            }
        }

        // 2. Mushrooms
        if (mushrooms) {
            for (const m of mushrooms) {
                const type = m.userData.isTrampoline ? 4 : 1;
                batchData[ptr++] = type;
                batchData[ptr++] = m.position.x;
                batchData[ptr++] = m.position.y;
                batchData[ptr++] = m.position.z;
                batchData[ptr++] = m.userData.capRadius || 2.0;
                batchData[ptr++] = m.userData.capHeight || 3.0;
                batchData[ptr++] = 0;
                batchData[ptr++] = 0;
            }
        }

        // 3. Clouds
        if (clouds) {
            for (const c of clouds) {
                if (c.userData.tier === 1) {
                    batchData[ptr++] = 2; // type
                    batchData[ptr++] = c.position.x;
                    batchData[ptr++] = c.position.y;
                    batchData[ptr++] = c.position.z;
                    batchData[ptr++] = c.scale.x || 1.0;
                    batchData[ptr++] = c.scale.y || 1.0;
                    batchData[ptr++] = 0;
                    batchData[ptr++] = 0;
                }
            }
        }

        // Upload batch to WASM
        const wasmBatchUpload = exports.addCollisionObjectsBatch;
        if (wasmBatchUpload) {
            // Allocate memory in WASM and copy data
            const wasmMalloc = exports.malloc || exports.__new;
            if (wasmMalloc) {
                const dataPtr = wasmMalloc(batchData.length * 4); // 4 bytes per float
                const wasmFloatView = new Float32Array(wasmMemory!.buffer, dataPtr, batchData.length);
                wasmFloatView.set(batchData);

                wasmBatchUpload(dataPtr, totalCount);

                // Free the allocated memory
                const wasmFree = exports.free || exports.__free;
                if (wasmFree) wasmFree(dataPtr);
            }
        }
    } else {
        // Fallback: Sequential upload (for backwards compatibility)
        // 1. Gates
        if (caves) {
            caves.forEach(cave => {
                if (cave.userData.isBlocked) {
                    const gatePos = cave.userData.gatePosition.clone().applyMatrix4(cave.matrixWorld);
                    wasmAddCollisionObject!(3, gatePos.x, gatePos.y, gatePos.z, 2.5, 5.0, 0, 0, 0);
                }
            });
        }

        // 2. Mushrooms
        if (mushrooms) {
            mushrooms.forEach(m => {
                if (m.userData.isTrampoline) {
                     wasmAddCollisionObject!(4, m.position.x, m.position.y, m.position.z,
                        m.userData.capRadius || 2.0, m.userData.capHeight || 3.0, 0, 0, 0);
                } else {
                     wasmAddCollisionObject!(1, m.position.x, m.position.y, m.position.z,
                        m.userData.capRadius || 2.0, m.userData.capHeight || 3.0, 0, 0, 0);
                }
            });
        }

        // 3. Clouds
        if (clouds) {
            clouds.forEach(c => {
                 if (c.userData.tier === 1) {
                     wasmAddCollisionObject!(2, c.position.x, c.position.y, c.position.z,
                        c.scale.x || 1.0, c.scale.y || 1.0, 0, 0, 0);
                 }
            });
        }
    }

    console.log(`[WASM] Uploaded ${totalCount} collision objects to ASC.${hasBatchFunction ? ' (batched)' : ' (sequential)'}`);
    return true;
}

/**
 * Resolve game collisions using WASM
 * @param player - Player state object
 * @param kickTrigger - Kick trigger value
 * @returns True if collision was resolved
 */
export function resolveGameCollisionsWASM(player: PlayerState, kickTrigger: number): boolean {
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
// PHYSICS HELPERS
// =============================================================================

/**
 * Initialize the collision system
 */
export function initCollisionSystem(): void {
    if (wasmInitCollisionSystem) wasmInitCollisionSystem();
}

/**
 * Add a collision object
 * @param type - Object type
 * @param x - X position
 * @param y - Y position
 * @param z - Z position
 * @param r - Radius
 * @param h - Height
 * @param p1 - Parameter 1
 * @param p2 - Parameter 2
 * @param p3 - Parameter 3 (boolean)
 */
export function addCollisionObject(type: number, x: number, y: number, z: number, r: number, h: number, p1: number, p2: number, p3?: boolean): void {
    if (wasmAddCollisionObject) {
        wasmAddCollisionObject(type, x, y, z, r, h, p1, p2, p3 ? 1.0 : 0.0);
    }
}

/**
 * Check position validity
 * @param x - X position
 * @param z - Z position
 * @param radius - Radius
 * @returns Validity code (0 = valid)
 */
export function checkPositionValidity(x: number, z: number, radius: number): number {
    if (wasmCheckPositionValidity) {
        return wasmCheckPositionValidity(x, z, radius);
    }
    return 0; // Default to valid if WASM not ready
}

/**
 * Check collision
 * @param playerX - Player X position
 * @param playerZ - Player Z position
 * @param playerRadius - Player radius
 * @param objectCount - Number of objects
 * @returns True if collision detected
 */
export function checkCollision(playerX: number, playerZ: number, playerRadius: number, objectCount: number): boolean {
    if (!wasmInstance) return false;
    const exports = wasmInstance.exports as WasmExports;
    return exports.checkCollision!(playerX, playerZ, playerRadius, objectCount) === 1;
}

// =============================================================================
// NATIVE C++ PHYSICS WRAPPERS
// =============================================================================

/**
 * Update physics using C++
 * @param delta - Delta time
 * @param inputX - Input X
 * @param inputZ - Input Z
 * @param speed - Speed
 * @param jump - Jump flag
 * @param sprint - Sprint flag
 * @param sneak - Sneak flag
 * @param grooveGravity - Groove gravity
 * @returns Physics result code
 */
export function updatePhysicsCPP(delta: number, inputX: number, inputZ: number, speed: number, jump: boolean, sprint: boolean, sneak: boolean, grooveGravity: number): number {
    const f = getNativeFunc('updatePhysicsCPP');
    if (f) return f(delta, inputX, inputZ, speed, jump ? 1 : 0, sprint ? 1 : 0, sneak ? 1 : 0, grooveGravity);
    return -1;
}

/**
 * Initialize physics
 * @param x - Initial X position
 * @param y - Initial Y position
 * @param z - Initial Z position
 */
export function initPhysics(x: number, y: number, z: number): void {
    const f = getNativeFunc('initPhysics');
    if (f) f(x, y, z);
}

/**
 * Add an obstacle
 * @param type - Obstacle type
 * @param x - X position
 * @param y - Y position
 * @param z - Z position
 * @param r - Radius
 * @param h - Height
 * @param p1 - Parameter 1
 * @param p2 - Parameter 2
 * @param p3 - Parameter 3 (boolean)
 */
export function addObstacle(type: number, x: number, y: number, z: number, r: number, h: number, p1: number, p2: number, p3: boolean): void {
    const f = getNativeFunc('addObstacle');
    if (f) f(type, x, y, z, r, h, p1, p2, p3 ? 1.0 : 0.0);
}

/**
 * Upload obstacles in batch
 * @param objectsData - Float32Array of object data
 * @param count - Number of objects
 */
export function uploadObstaclesBatch(objectsData: Float32Array, count: number): void {
    if (!emscriptenInstance || !emscriptenInstance._malloc || !emscriptenInstance._free) return;
    const f = getNativeFunc('addObstaclesBatch');
    if (!f) return;

    // 9 floats per obstacle
    const bytes = count * 9 * 4;
    const ptr = emscriptenInstance._malloc(bytes);
    if (!ptr) return;

    // ⚡ OPTIMIZATION: Copy JS float array into WASM memory using batched writes
    // emscriptenMemory holds the WASM heap buffer
    if (!emscriptenMemory) return;
    const heapF32 = new Float32Array(emscriptenMemory);
    heapF32.set(objectsData, ptr >> 2);

    // Invoke C++
    f(ptr, count);

    // Free memory
    emscriptenInstance._free(ptr);
}

// =============================================================================
// PLAYER STATE
// =============================================================================

/**
 * Set player state
 * @param x - X position
 * @param y - Y position
 * @param z - Z position
 * @param vx - X velocity
 * @param vy - Y velocity
 * @param vz - Z velocity
 */
export function setPlayerState(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const f = getNativeFunc('setPlayerState');
    if (f) f(x, y, z, vx, vy, vz);
}

/**
 * Get player state
 * @param out - Optional output object to prevent allocation
 * @returns Player state
 */
export function getPlayerState(out: Partial<PlayerStateResult> = {}): PlayerStateResult {
    const result: PlayerStateResult = {
        x: getNativeFunc('getPlayerX')?.() ?? 0,
        y: getNativeFunc('getPlayerY')?.() ?? 0,
        z: getNativeFunc('getPlayerZ')?.() ?? 0,
        vx: getNativeFunc('getPlayerVX')?.() ?? 0,
        vy: getNativeFunc('getPlayerVY')?.() ?? 0,
        vz: getNativeFunc('getPlayerVZ')?.() ?? 0
    };
    Object.assign(out, result);
    return result;
}

// =============================================================================
// MATH FALLBACKS
// =============================================================================

/**
 * Value noise 2D
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns Noise value
 */
export function valueNoise2D(x: number, y: number): number {
    const f = getNativeFunc('valueNoise2D');
    if (f) return f(x, y);
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

/**
 * Fractal Brownian Motion
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param octaves - Number of octaves
 * @returns FBM value
 */
export function fbm(x: number, y: number, octaves = 4): number {
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

/**
 * Fast inverse square root
 * @param x - Input value
 * @returns 1/sqrt(x)
 */
export function fastInvSqrt(x: number): number {
    const f = getNativeFunc('fastInvSqrt');
    if (f) return f(x);
    return 1 / Math.sqrt(x);
}

/**
 * Fast distance calculation
 * @param x1 - Point 1 X
 * @param y1 - Point 1 Y
 * @param z1 - Point 1 Z
 * @param x2 - Point 2 X
 * @param y2 - Point 2 Y
 * @param z2 - Point 2 Z
 * @returns Distance
 */
export function fastDistance(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): number {
    const f = getNativeFunc('fastDistance');
    if (f) return f(x1, y1, z1, x2, y2, z2);
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Hash function
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns Hash value
 */
export function hash(x: number, y: number): number {
    const f = getNativeFunc('hash');
    if (f) return f(x, y);
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
}

// =============================================================================
// SIMPLE MATH FUNCTIONS (WASM-based with JS fallbacks)
// =============================================================================

/**
 * Get ground height at position
 * @param x - X coordinate
 * @param z - Z coordinate
 * @returns Height value
 */
export function getGroundHeight(x: number, z: number): number {
    if (wasmGetGroundHeight) return wasmGetGroundHeight(x, z);
    if (isNaN(x) || isNaN(z)) return 0;
    return Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 +
        Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3;
}

/**
 * Convert frequency to hue
 * @param freq - Frequency value
 * @returns Hue value (0-1)
 */
export function freqToHue(freq: number): number {
    if (wasmFreqToHue) return wasmFreqToHue(freq);
    if (!freq || freq < 50) return 0;
    const logF = Math.log2(freq / 55.0);
    return (logF * 0.1) % 1.0;
}

/**
 * Linear interpolation
 * @param a - Start value
 * @param b - End value
 * @param t - Interpolation factor (0-1)
 * @returns Interpolated value
 */
export function lerp(a: number, b: number, t: number): number {
    if (wasmLerp) return wasmLerp(a, b, t);
    return a + (b - a) * t;
}

// =============================================================================
// NEW MATH FUNCTIONS FROM ASSEMBLY/MATH.TS
// =============================================================================

import {
    wasmHslToRgb,
    wasmHash2D,
    wasmValueNoise2D,
    wasmFbm2D,
    wasmDistSq2D,
    wasmDistSq3D,
    wasmSmoothstep,
    wasmInverseLerp
} from './wasm-loader-core.js';

/**
 * Convert HSL color to RGB integer
 * @param h - Hue (0-1)
 * @param s - Saturation (0-1)
 * @param l - Lightness (0-1)
 * @returns RGB integer (0xRRGGBB)
 */
export function hslToRgb(h: number, s: number, l: number): number {
    if (wasmHslToRgb) return wasmHslToRgb(h, s, l);
    
    // JS fallback: Standard HSL to RGB conversion
    const hue2rgb = (p: number, q: number, t: number): number => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };

    let r: number, g: number, b: number;

    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/**
 * Simple hash function for 2D coordinates
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns Hash value (0-1)
 */
export function hash2D(x: number, y: number): number {
    if (wasmHash2D) return wasmHash2D(x, y);
    // JS fallback: Simple sin/fract based hash
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

/**
 * Value noise 2D (AssemblyScript version)
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns Noise value (0-1)
 */
export function ascValueNoise2D(x: number, y: number): number {
    if (wasmValueNoise2D) return wasmValueNoise2D(x, y);
    // JS fallback: Smooth noise
    const i = Math.floor(x);
    const j = Math.floor(y);
    const u = x - i;
    const v = y - j;
    
    const a = hash2D(i, j);
    const b = hash2D(i + 1, j);
    const c = hash2D(i, j + 1);
    const d = hash2D(i + 1, j + 1);
    
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/**
 * Fractal Brownian Motion 2D (AssemblyScript version)
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param octaves - Number of octaves
 * @returns FBM value
 */
export function fbm2D(x: number, y: number, octaves: number): number {
    if (wasmFbm2D) return wasmFbm2D(x, y, octaves);
    // JS fallback: Fractal Brownian Motion
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
        value += amplitude * ascValueNoise2D(x * frequency, y * frequency);
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    
    return value / maxValue;
}

/**
 * Squared distance between two 2D points
 * @param ax - Point A X
 * @param ay - Point A Y
 * @param bx - Point B X
 * @param by - Point B Y
 * @returns Squared distance
 */
export function distSq2D(ax: number, ay: number, bx: number, by: number): number {
    if (wasmDistSq2D) return wasmDistSq2D(ax, ay, bx, by);
    const dx = bx - ax;
    const dy = by - ay;
    return dx * dx + dy * dy;
}

/**
 * Squared distance between two 3D points
 * @param ax - Point A X
 * @param ay - Point A Y
 * @param az - Point A Z
 * @param bx - Point B X
 * @param by - Point B Y
 * @param bz - Point B Z
 * @returns Squared distance
 */
export function distSq3D(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    if (wasmDistSq3D) return wasmDistSq3D(ax, ay, az, bx, by, bz);
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    return dx * dx + dy * dy + dz * dz;
}

/**
 * Smoothstep interpolation
 * @param t - Input value (0-1)
 * @returns Smoothed value (0-1)
 */
export function smoothstep(t: number): number {
    if (wasmSmoothstep) return wasmSmoothstep(t);
    // JS fallback: t*t*(3-2*t)
    return t * t * (3 - 2 * t);
}

/**
 * Inverse linear interpolation
 * @param a - Start value
 * @param b - End value
 * @param value - Current value
 * @returns Interpolation factor (0-1)
 */
export function inverseLerp(a: number, b: number, value: number): number {
    if (wasmInverseLerp) return wasmInverseLerp(a, b, value);
    // JS fallback: (value-a)/(b-a)
    if (Math.abs(b - a) < 1e-10) return 0;
    return (value - a) / (b - a);
}
