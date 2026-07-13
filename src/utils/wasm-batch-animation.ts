/**
 * @file wasm-batch-animation.ts
 * @brief Animation batch functions, mesh deformation, and animation wrappers
 * 
 * Handles:
 * - Basic animations: batchAnimationCalc
 * - Agent 1: Simple animations (shiver, spring, float, cloud bob)
 * - Agent 2: Mesh deformation (wave, jiggle, wobble)
 * - Agent 3: LOD matrix operations
 * - Agent 4: Frustum/distance culling
 * - Fluid simulation
 * - High-level animation wrappers (shiver, spring, float, cloud bob, vine sway, geyser erupt, retrigger)
 */

import { 
    wasmInstance,
    getEmscriptenInstance,
    emscriptenMemory,
    outputView,
    wasmBatchHslToRgb,
    wasmBatchSphereCull,
    wasmBatchLerp,
    getNativeFunc,
    type WasmExports,
} from './wasm-loader-core.ts';

// =============================================================================
// BATCH ANIMATION
// =============================================================================

/**
 * Batch animation calculation
 * @param time - Current time
 * @param intensity - Animation intensity
 * @param kick - Kick trigger
 * @param objectCount - Number of objects
 * @returns Output Float32Array or null
 */
export function batchAnimationCalc(time: number, intensity: number, kick: number, objectCount: number): Float32Array | null {
    if (!wasmInstance) return null;
    const exports = wasmInstance.exports as WasmExports;
    exports.batchAnimationCalc!(time, intensity, kick, objectCount);
    return outputView!.slice(0, objectCount * 4);
}

// =============================================================================
// AGENT 1: SIMPLE ANIMATION BATCH FUNCTIONS
// =============================================================================

/**
 * Batch shiver animation
 * @param input - Input pointer
 * @param count - Count
 * @param time - Time
 * @param intensity - Intensity
 * @param output - Output pointer
 */
export function batchShiver_c(input: number, count: number, time: number, intensity: number, output: number): void {
    const f = getNativeFunc('batchShiver_c');
    if (f) f(input, count, time, intensity, output);
}

/**
 * Batch spring animation
 * @param input - Input pointer
 * @param count - Count
 * @param time - Time
 * @param intensity - Intensity
 * @param output - Output pointer
 */
export function batchSpring_c(input: number, count: number, time: number, intensity: number, output: number): void {
    const f = getNativeFunc('batchSpring_c');
    if (f) f(input, count, time, intensity, output);
}

/**
 * Batch float animation
 * @param input - Input pointer
 * @param count - Count
 * @param time - Time
 * @param intensity - Intensity
 * @param output - Output pointer
 */
export function batchFloat_c(input: number, count: number, time: number, intensity: number, output: number): void {
    const f = getNativeFunc('batchFloat_c');
    if (f) f(input, count, time, intensity, output);
}

/**
 * Batch cloud bob animation
 * @param input - Input pointer
 * @param count - Count
 * @param time - Time
 * @param intensity - Intensity
 * @param output - Output pointer
 */
export function batchCloudBob_c(input: number, count: number, time: number, intensity: number, output: number): void {
    const f = getNativeFunc('batchCloudBob_c');
    if (f) f(input, count, time, intensity, output);
}

// =============================================================================
// AGENT 2: MESH DEFORMATION FUNCTIONS
// =============================================================================

/**
 * Deform wave
 * @param positions - Positions pointer
 * @param count - Count
 * @param time - Time
 * @param strength - Strength
 * @param frequency - Frequency
 */
export function deformWave_c(positions: number, count: number, time: number, strength: number, frequency: number): void {
    const f = getNativeFunc('deformWave_c');
    if (f) f(positions, count, time, strength, frequency);
}

/**
 * Deform jiggle
 * @param positions - Positions pointer
 * @param count - Count
 * @param time - Time
 * @param strength - Strength
 * @param audioPulse - Audio pulse
 */
export function deformJiggle_c(positions: number, count: number, time: number, strength: number, audioPulse: number): void {
    const f = getNativeFunc('deformJiggle_c');
    if (f) f(positions, count, time, strength, audioPulse);
}

/**
 * Deform wobble
 * @param positions - Positions pointer
 * @param count - Count
 * @param time - Time
 * @param strength - Strength
 * @param audioPulse - Audio pulse
 */
export function deformWobble_c(positions: number, count: number, time: number, strength: number, audioPulse: number): void {
    const f = getNativeFunc('deformWobble_c');
    if (f) f(positions, count, time, strength, audioPulse);
}

// =============================================================================
// AGENT 3: LOD BATCH FUNCTIONS
// =============================================================================

/**
 * Batch update LOD matrices
 * @param matrices - Matrices pointer
 * @param colors - Colors pointer
 * @param count - Count
 * @param cameraX - Camera X
 * @param cameraY - Camera Y
 * @param cameraZ - Camera Z
 * @param lod1Dist - LOD 1 distance
 * @param lod2Dist - LOD 2 distance
 * @param cullDist - Cull distance
 * @param results - Results pointer
 */
export function batchUpdateLODMatrices_c(
    matrices: number, 
    colors: number, 
    count: number, 
    cameraX: number, 
    cameraY: number, 
    cameraZ: number, 
    lod1Dist: number, 
    lod2Dist: number, 
    cullDist: number, 
    results: number
): void {
    const f = getNativeFunc('batchUpdateLODMatrices_c');
    if (f) f(matrices, colors, count, cameraX, cameraY, cameraZ, lod1Dist, lod2Dist, cullDist, results);
}

/**
 * Batch scale matrices
 * @param matrices - Matrices pointer
 * @param count - Count
 * @param scaleX - Scale X
 * @param scaleY - Scale Y
 * @param scaleZ - Scale Z
 */
export function batchScaleMatrices_c(matrices: number, count: number, scaleX: number, scaleY: number, scaleZ: number): void {
    const f = getNativeFunc('batchScaleMatrices_c');
    if (f) f(matrices, count, scaleX, scaleY, scaleZ);
}

/**
 * Batch fade colors
 * @param colors - Colors pointer
 * @param count - Count
 * @param fadeAmount - Fade amount
 */
export function batchFadeColors_c(colors: number, count: number, fadeAmount: number): void {
    const f = getNativeFunc('batchFadeColors_c');
    if (f) f(colors, count, fadeAmount);
}

// =============================================================================
// AGENT 4: FRUSTUM/DISTANCE CULLING FUNCTIONS
// =============================================================================

/**
 * Batch frustum cull
 * @param positions - Positions pointer
 * @param count - Count
 * @param frustumPlanes - Frustum planes pointer
 * @param results - Results pointer
 */
export function batchFrustumCull_c(positions: number, count: number, frustumPlanes: number, results: number): void {
    const f = getNativeFunc('batchFrustumCull_c');
    if (f) f(positions, count, frustumPlanes, results);
}

/**
 * Batch distance cull indexed
 * @param positions - Positions pointer
 * @param indices - Indices pointer
 * @param indexCount - Index count
 * @param camX - Camera X
 * @param camY - Camera Y
 * @param camZ - Camera Z
 * @param maxDistSq - Max distance squared
 * @param results - Results pointer
 */
export function batchDistanceCullIndexed_c(
    positions: number, 
    indices: number, 
    indexCount: number, 
    camX: number, 
    camY: number, 
    camZ: number, 
    maxDistSq: number, 
    results: number
): void {
    const f = getNativeFunc('batchDistanceCullIndexed_c');
    if (f) f(positions, indices, indexCount, camX, camY, camZ, maxDistSq, results);
}

// =============================================================================
// FLUID SIMULATION
// =============================================================================

/**
 * Initialize fluid simulation
 * @param size - Grid size
 */
export function fluidInit(size: number): void {
    const f = getNativeFunc('fluidInit');
    if (f) f(size);
}

/**
 * Step fluid simulation
 * @param dt - Delta time
 * @param visc - Viscosity
 * @param diff - Diffusion
 */
export function fluidStep(dt: number, visc: number, diff: number): void {
    const f = getNativeFunc('fluidStep');
    if (f) f(dt, visc, diff);
}

/**
 * Add density to fluid
 * @param x - X position
 * @param y - Y position
 * @param amount - Amount to add
 */
export function fluidAddDensity(x: number, y: number, amount: number): void {
    const f = getNativeFunc('fluidAddDensity');
    if (f) f(x, y, amount);
}

/**
 * Add velocity to fluid
 * @param x - X position
 * @param y - Y position
 * @param amountX - X velocity
 * @param amountY - Y velocity
 */
export function fluidAddVelocity(x: number, y: number, amountX: number, amountY: number): void {
    const f = getNativeFunc('fluidAddVelocity');
    if (f) f(x, y, amountX, amountY);
}

/**
 * Get fluid density view
 * @param size - Grid size
 * @returns Float32Array view or null
 */
export function getFluidDensityView(size = 128): Float32Array | null {
    const f = getNativeFunc('fluidGetDensityPtr');
    if (f && emscriptenMemory) {
        const ptr = f();
        return new Float32Array(emscriptenMemory, ptr, size * size);
    }
    return null;
}

/**
 * Update particles using WASM
 * @param positions - Positions array
 * @param velocities - Velocities array
 * @param count - Particle count
 * @param deltaTime - Delta time
 * @param gravityY - Gravity Y
 * @param audioPulse - Audio pulse
 * @param spawnX - Spawn X
 * @param spawnY - Spawn Y
 * @param spawnZ - Spawn Z
 */
export function updateParticlesWASM(
    positions: Float32Array, 
    velocities: Float32Array, 
    count: number, 
    deltaTime: number, 
    gravityY: number, 
    audioPulse: number, 
    spawnX: number, 
    spawnY: number, 
    spawnZ: number
): void {
    const f = getNativeFunc('updateParticlesWASM');
    if (!f || !emscriptenMemory || !getEmscriptenInstance()?._malloc || !getEmscriptenInstance()._free) return;

    const ptrP = getEmscriptenInstance()._malloc(count * 4 * 4);
    const ptrV = getEmscriptenInstance()._malloc(count * 4 * 4);

    if (!ptrP || !ptrV) return;

    const heapF32 = new Float32Array(emscriptenMemory);
    heapF32.set(positions, ptrP >> 2);
    heapF32.set(velocities, ptrV >> 2);

    f(ptrP, ptrV, count, deltaTime, gravityY, audioPulse, spawnX, spawnY, spawnZ);

    positions.set(heapF32.subarray(ptrP >> 2, (ptrP >> 2) + count * 4));
    velocities.set(heapF32.subarray(ptrV >> 2, (ptrV >> 2) + count * 4));

    getEmscriptenInstance()._free(ptrP);
    getEmscriptenInstance()._free(ptrV);
}

// =============================================================================
// HIGH-LEVEL BATCH UTILITIES
// =============================================================================

/**
 * Batch HSL to RGB conversion
 * Input format: [h0, s0, l0, h1, s1, l1, ...] (3 floats per color)
 * Output format: [r0, g0, b0, r1, g1, b1, ...] written in-place as integers packed into floats
 * @param hslData - Float32Array of HSL values (3 floats per color) or pointer offset
 * @param count - Number of colors to convert
 */
export function batchHslToRgb(hslData: Float32Array | number, count: number): void {
    if (!emscriptenMemory || !outputView) return;
    
    if (wasmBatchHslToRgb && typeof hslData === 'number') {
        wasmBatchHslToRgb(hslData, count);
        return;
    }
    
    // JS fallback: Convert HSL to RGB in-place
    if (hslData instanceof Float32Array) {
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const h = hslData[idx];
            const s = hslData[idx + 1];
            const l = hslData[idx + 2];
            
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
            
            hslData[idx] = r;
            hslData[idx + 1] = g;
            hslData[idx + 2] = b;
        }
    }
}

/**
 * Batch sphere culling - cull objects based on distance from camera
 * @param positions - Float32Array of positions [x0, y0, z0, x1, y1, z1, ...] or pointer offset
 * @param count - Number of positions
 * @param camX - Camera X position
 * @param camY - Camera Y position
 * @param camZ - Camera Z position
 * @param maxDist - Maximum distance
 * @param output - Output array for visibility flags (1 = visible, 0 = culled) or pointer offset
 */
export function batchSphereCull(
    positions: Float32Array | number,
    count: number,
    camX: number,
    camY: number,
    camZ: number,
    maxDist: number,
    output: Float32Array | number
): void {
    if (wasmBatchSphereCull && typeof positions === 'number' && typeof output === 'number') {
        wasmBatchSphereCull(positions, count, camX, camY, camZ, maxDist, output);
        return;
    }
    
    // JS fallback
    if (positions instanceof Float32Array && output instanceof Float32Array) {
        const maxDistSq = maxDist * maxDist;
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const dx = positions[idx] - camX;
            const dy = positions[idx + 1] - camY;
            const dz = positions[idx + 2] - camZ;
            const distSq = dx * dx + dy * dy + dz * dz;
            output[i] = distSq <= maxDistSq ? 1 : 0;
        }
    }
}

/**
 * Batch linear interpolation
 * Input format: [a0, b0, t0, a1, b1, t1, ...] (3 floats per lerp)
 * Output: Results written back to the array [result0, result1, ...]
 * @param data - Float32Array of [a, b, t] triplets or pointer offset
 * @param count - Number of lerp operations
 */
export function batchLerp(data: Float32Array | number, count: number): void {
    if (wasmBatchLerp && typeof data === 'number') {
        wasmBatchLerp(data, count);
        return;
    }
    
    // JS fallback
    if (data instanceof Float32Array) {
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const a = data[idx];
            const b = data[idx + 1];
            const t = data[idx + 2];
            data[i] = a + (b - a) * t;
        }
    }
}
