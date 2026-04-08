/**
 * @file wasm-batch.ts
 * @brief Batch Processing and Culling Functions
 * 
 * This module contains:
 * - Batch functions: uploadPositions, uploadMushroomSpecs, copySharedPositions, uploadAnimationData
 * - Culling: batchDistanceCull
 * - Spawning: batchMushroomSpawnCandidates, readSpawnCandidates
 * - Materials: analyzeMaterials, getUniqueShaderCount
 * - Batch animation: batchAnimationCalc
 * - Agent 1-4 batch functions
 * - Fluid simulation: fluidInit, fluidStep, updateParticlesWASM
 */

import { 
    wasmInstance,
    wasmMemory,
    emscriptenInstance,
    emscriptenMemory,
    positionView,
    animationView,
    outputView,
    wasmBatchMushroomSpawnCandidates,
    wasmBatchHslToRgb,
    wasmBatchSphereCull,
    wasmBatchLerp,
    wasmUpdateParticles,
    wasmSpawnBurst,
    getNativeFunc,
    initCppFunctions,
    POSITION_OFFSET,
    OUTPUT_OFFSET,
    // C++ Emscripten function references
    cppValueNoise2DSimd4,
    cppFbm2DSimd4,
    cppBatchGroundHeightSimd,
    cppBatchValueNoiseOmp,
    cppBatchFbmOmp,
    cppBatchDistSq3DOmp,
    cppFastSin,
    cppFastCos,
    cppFastPow2,
    cppBatchShiverSimd,
    cppBatchSpringSimd,
    cppBatchFloatSimd,
    cppBatchCloudBobSimd,
    cppBatchVineSwaySimd,
    cppBatchGeyserEruptC,
    cppBatchRetriggerSimd,
    type WasmExports,
    type Mushroom,
    type AnimationData,
    type PositionData
} from './wasm-loader-core.js';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Spawn candidate result
 */
export interface SpawnCandidate {
    x: number;
    y: number;
    z: number;
    colorIndex: number;
}

/**
 * Material analysis result
 */
export interface MaterialAnalysisResult {
    uniqueCount: number;
    shaders: Array<{
        vertexId: number;
        fragmentId: number;
        blendMode: number;
        flags: number;
    }>;
}

/**
 * Distance cull result
 */
export interface DistanceCullResult {
    visibleCount: number;
    flags: Float32Array | null;
}

/**
 * Material with shader info
 */
export interface MaterialInfo {
    vertexShaderId?: number;
    fragmentShaderId?: number;
    blendingMode?: number;
    flags?: number;
}

// =============================================================================
// BATCH UPLOAD FUNCTIONS
// =============================================================================

/**
 * Upload positions to WASM
 * @param objects - Array of position data
 */
export function uploadPositions(objects: PositionData[]): void {
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
 * Upload mushroom specs to WASM
 * @param mushrooms - Array of mushroom objects
 */
export function uploadMushroomSpecs(mushrooms: Mushroom[]): void {
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

/**
 * Copy shared positions to WASM
 * @param sharedView - Shared Float32Array
 * @param objectCount - Number of objects
 */
export function copySharedPositions(sharedView: Float32Array, objectCount: number): void {
    if (!positionView) return;
    const maxCount = Math.min(objectCount, Math.floor(positionView.length / 4));
    for (let i = 0; i < maxCount * 4; i++) {
        positionView[i] = sharedView[i];
    }
}

/**
 * Upload animation data to WASM
 * @param animData - Array of animation data
 */
export function uploadAnimationData(animData: AnimationData[]): void {
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

// =============================================================================
// CULLING
// =============================================================================

/**
 * Batch distance cull
 * @param cameraX - Camera X position
 * @param cameraY - Camera Y position
 * @param cameraZ - Camera Z position
 * @param maxDistance - Maximum distance
 * @param objectCount - Number of objects
 * @returns Distance cull result
 */
export function batchDistanceCull(cameraX: number, cameraY: number, cameraZ: number, maxDistance: number, objectCount: number): DistanceCullResult {
    const maxDistSq = maxDistance * maxDistance;
    if (!wasmInstance) return { visibleCount: objectCount, flags: null };
    if (objectCount > 5000) return { visibleCount: objectCount, flags: null };

    const exports = wasmInstance.exports as WasmExports;
    const visibleCount = exports.batchDistanceCull!(cameraX, cameraY, cameraZ, maxDistSq, objectCount);

    return { visibleCount, flags: outputView!.slice(0, objectCount) };
}

// =============================================================================
// SPAWNING
// =============================================================================

/**
 * Batch mushroom spawn candidates
 * @param time - Current time
 * @param windX - Wind X
 * @param windZ - Wind Z
 * @param windSpeed - Wind speed
 * @param objectCount - Number of objects
 * @param spawnThreshold - Spawn threshold
 * @param minDistance - Minimum distance
 * @param maxDistance - Maximum distance
 * @returns Number of candidates
 */
export function batchMushroomSpawnCandidates(
    time: number, 
    windX: number, 
    windZ: number, 
    windSpeed: number, 
    objectCount: number, 
    spawnThreshold: number, 
    minDistance: number, 
    maxDistance: number
): number {
    if (wasmBatchMushroomSpawnCandidates && wasmInstance) {
        return wasmBatchMushroomSpawnCandidates(time, windX, windZ, windSpeed, objectCount, spawnThreshold, minDistance, maxDistance);
    }
    return 0;
}

/**
 * Read spawn candidates from output view
 * @param candidateCount - Number of candidates to read
 * @returns Array of spawn candidates
 */
export function readSpawnCandidates(candidateCount: number): SpawnCandidate[] {
    if (!outputView) return [];
    const arr: SpawnCandidate[] = [];
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
// MATERIALS
// =============================================================================

/**
 * Analyze materials
 * @param materials - Array of material info
 * @returns Material analysis result
 */
export function analyzeMaterials(materials: MaterialInfo[]): MaterialAnalysisResult {
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (!exports?.analyzeMaterials) {
        const seen = new Map<string, boolean>();
        const shaders: Array<{ vertexId: number; fragmentId: number; blendMode: number; flags: number }> = [];
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
    
    const uniqueCount = exports.analyzeMaterials(MATERIAL_OFFSET, count);
    const outputView = new Int32Array(wasmMemory.buffer, MATERIAL_OFFSET, Math.min(uniqueCount, 64) * 4);
    const shaders: Array<{ vertexId: number; fragmentId: number; blendMode: number; flags: number }> = [];
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
 * Get unique shader count
 * @returns Number of unique shaders
 */
export function getUniqueShaderCount(): number {
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.getUniqueShaderCount) {
        return exports.getUniqueShaderCount();
    }
    return 0;
}

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
    if (!f || !emscriptenMemory || !emscriptenInstance?._malloc || !emscriptenInstance._free) return;

    // We expect positions and velocities to be TypedArrays
    // Since this is a C function expecting float*, we should allocate memory for it,
    // or assume the caller passed the offset if the memory is already on the WASM heap.
    // In `particle_compute.ts`, it might pass raw Float32Arrays. We need to copy to/from.
    const ptrP = emscriptenInstance._malloc(count * 4 * 4);
    const ptrV = emscriptenInstance._malloc(count * 4 * 4);

    if (!ptrP || !ptrV) return;

    const heapF32 = new Float32Array(emscriptenMemory);
    heapF32.set(positions, ptrP >> 2);
    heapF32.set(velocities, ptrV >> 2);

    f(ptrP, ptrV, count, deltaTime, gravityY, audioPulse, spawnX, spawnY, spawnZ);

    positions.set(heapF32.subarray(ptrP >> 2, (ptrP >> 2) + count * 4));
    velocities.set(heapF32.subarray(ptrV >> 2, (ptrV >> 2) + count * 4));

    emscriptenInstance._free(ptrP);
    emscriptenInstance._free(ptrV);
}

// =============================================================================
// NEW BATCH FUNCTIONS FROM ASSEMBLY/BATCH.TS
// =============================================================================

/**
 * Batch HSL to RGB conversion
 * Input format: [h0, s0, l0, h1, s1, l1, ...] (3 floats per color)
 * Output format: [r0, g0, b0, r1, g1, b1, ...] written in-place as integers packed into floats
 * @param hslData - Float32Array of HSL values (3 floats per color) or pointer offset
 * @param count - Number of colors to convert
 */
export function batchHslToRgb(hslData: Float32Array | number, count: number): void {
    if (!wasmMemory || !outputView) return;
    
    if (wasmBatchHslToRgb && typeof hslData === 'number') {
        // Use WASM batch function with pointer
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

// =============================================================================
// C++ EMSCRIPTEN MATH WRAPPERS
// =============================================================================

const MATH_STRIDE = 4;  // 4 floats per result (rotX, rotY, rotZ, scale)

/**
 * JS fallback for valueNoise2D_simd4
 */
function valueNoise2DJS(x: number, y: number): number {
    // Simple value noise implementation
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const u = x - fx;
    const v = y - fy;
    
    const hash = (x: number, y: number): number => {
        let n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return n - Math.floor(n);
    };
    
    const n00 = hash(fx, fy);
    const n10 = hash(fx + 1, fy);
    const n01 = hash(fx, fy + 1);
    const n11 = hash(fx + 1, fy + 1);
    
    // Smooth interpolation
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    
    return n00 * (1 - su) * (1 - sv) +
           n10 * su * (1 - sv) +
           n01 * (1 - su) * sv +
           n11 * su * sv;
}

/**
 * Batch value noise calculation using SIMD4 C++ function
 * @param x - Float32Array of X coordinates
 * @param y - Float32Array of Y coordinates
 * @returns Float32Array of noise values
 */
export function batchValueNoiseSimd4(x: Float32Array, y: Float32Array): Float32Array {
    const count = x.length;
    const output = new Float32Array(count);
    
    if (cppValueNoise2DSimd4 && emscriptenInstance) {
        const xPtr = emscriptenInstance._malloc!(count * 4);
        const yPtr = emscriptenInstance._malloc!(count * 4);
        const outPtr = emscriptenInstance._malloc!(count * 4);
        
        if (!xPtr || !yPtr || !outPtr) return output;
        
        emscriptenInstance.HEAPF32!.set(x, xPtr >> 2);
        emscriptenInstance.HEAPF32!.set(y, yPtr >> 2);
        
        cppValueNoise2DSimd4(xPtr, yPtr, outPtr);
        
        output.set(emscriptenInstance.HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        emscriptenInstance._free!(xPtr);
        emscriptenInstance._free!(yPtr);
        emscriptenInstance._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        output[i] = valueNoise2DJS(x[i], y[i]);
    }
    return output;
}

/**
 * JS fallback for fbm2D
 */
function fbm2DJS(x: number, y: number, octaves: number): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    
    for (let i = 0; i < octaves; i++) {
        value += valueNoise2DJS(x * frequency, y * frequency) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    
    return value;
}

/**
 * Batch FBM calculation using SIMD4 C++ function
 * @param x - Float32Array of X coordinates
 * @param y - Float32Array of Y coordinates
 * @param octaves - Number of octaves
 * @returns Float32Array of FBM values
 */
export function batchFbmSimd4(x: Float32Array, y: Float32Array, octaves: number): Float32Array {
    const count = x.length;
    const output = new Float32Array(count);
    
    if (cppFbm2DSimd4 && emscriptenInstance) {
        const xPtr = emscriptenInstance._malloc!(count * 4);
        const yPtr = emscriptenInstance._malloc!(count * 4);
        const outPtr = emscriptenInstance._malloc!(count * 4);
        
        if (!xPtr || !yPtr || !outPtr) return output;
        
        emscriptenInstance.HEAPF32!.set(x, xPtr >> 2);
        emscriptenInstance.HEAPF32!.set(y, yPtr >> 2);
        
        cppFbm2DSimd4(xPtr, yPtr, octaves, outPtr);
        
        output.set(emscriptenInstance.HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        emscriptenInstance._free!(xPtr);
        emscriptenInstance._free!(yPtr);
        emscriptenInstance._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        output[i] = fbm2DJS(x[i], y[i], octaves);
    }
    return output;
}

/**
 * Batch ground height calculation using SIMD C++ function
 * @param positions - Float32Array of positions [x0, z0, x1, z1, ...]
 * @returns Float32Array of heights
 */
export function batchGroundHeightSimd(positions: Float32Array): Float32Array {
    const count = positions.length / 2;
    const output = new Float32Array(count);
    
    if (cppBatchGroundHeightSimd && emscriptenInstance) {
        const posPtr = emscriptenInstance._malloc!(positions.length * 4);
        const outPtr = emscriptenInstance._malloc!(count * 4);
        
        if (!posPtr || !outPtr) return output;
        
        emscriptenInstance.HEAPF32!.set(positions, posPtr >> 2);
        
        cppBatchGroundHeightSimd(posPtr, count, outPtr);
        
        output.set(emscriptenInstance.HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        emscriptenInstance._free!(posPtr);
        emscriptenInstance._free!(outPtr);
        
        return output;
    }
    
    // JS fallback using FBM
    for (let i = 0; i < count; i++) {
        output[i] = fbm2DJS(positions[i * 2], positions[i * 2 + 1], 4);
    }
    return output;
}

/**
 * Batch value noise using OpenMP C++ function
 * @param x - Float32Array of X coordinates
 * @param y - Float32Array of Y coordinates
 * @returns Float32Array of noise values
 */
export function batchValueNoiseOmp(x: Float32Array, y: Float32Array): Float32Array {
    const count = x.length;
    const output = new Float32Array(count);
    
    if (cppBatchValueNoiseOmp && emscriptenInstance) {
        const xPtr = emscriptenInstance._malloc!(count * 4);
        const yPtr = emscriptenInstance._malloc!(count * 4);
        const outPtr = emscriptenInstance._malloc!(count * 4);
        
        if (!xPtr || !yPtr || !outPtr) return output;
        
        emscriptenInstance.HEAPF32!.set(x, xPtr >> 2);
        emscriptenInstance.HEAPF32!.set(y, yPtr >> 2);
        
        cppBatchValueNoiseOmp(xPtr, yPtr, count, outPtr);
        
        output.set(emscriptenInstance.HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        emscriptenInstance._free!(xPtr);
        emscriptenInstance._free!(yPtr);
        emscriptenInstance._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        output[i] = valueNoise2DJS(x[i], y[i]);
    }
    return output;
}

/**
 * Batch FBM using OpenMP C++ function
 * @param x - Float32Array of X coordinates
 * @param y - Float32Array of Y coordinates
 * @param octaves - Number of octaves
 * @returns Float32Array of FBM values
 */
export function batchFbmOmp(x: Float32Array, y: Float32Array, octaves: number): Float32Array {
    const count = x.length;
    const output = new Float32Array(count);
    
    if (cppBatchFbmOmp && emscriptenInstance) {
        const xPtr = emscriptenInstance._malloc!(count * 4);
        const yPtr = emscriptenInstance._malloc!(count * 4);
        const outPtr = emscriptenInstance._malloc!(count * 4);
        
        if (!xPtr || !yPtr || !outPtr) return output;
        
        emscriptenInstance.HEAPF32!.set(x, xPtr >> 2);
        emscriptenInstance.HEAPF32!.set(y, yPtr >> 2);
        
        cppBatchFbmOmp(xPtr, yPtr, count, octaves, outPtr);
        
        output.set(emscriptenInstance.HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        emscriptenInstance._free!(xPtr);
        emscriptenInstance._free!(yPtr);
        emscriptenInstance._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        output[i] = fbm2DJS(x[i], y[i], octaves);
    }
    return output;
}

/**
 * Batch distance squared calculation using OpenMP C++ function
 * @param ax - Float32Array of A X coordinates
 * @param ay - Float32Array of A Y coordinates
 * @param az - Float32Array of A Z coordinates
 * @param bx - B X coordinate
 * @param by - B Y coordinate
 * @param bz - B Z coordinate
 * @returns Float32Array of distances squared
 */
export function batchDistSq3DOmp(
    ax: Float32Array,
    ay: Float32Array,
    az: Float32Array,
    bx: number,
    by: number,
    bz: number
): Float32Array {
    const count = ax.length;
    const output = new Float32Array(count);
    
    if (cppBatchDistSq3DOmp && emscriptenInstance) {
        const axPtr = emscriptenInstance._malloc!(count * 4);
        const ayPtr = emscriptenInstance._malloc!(count * 4);
        const azPtr = emscriptenInstance._malloc!(count * 4);
        const outPtr = emscriptenInstance._malloc!(count * 4);
        
        if (!axPtr || !ayPtr || !azPtr || !outPtr) return output;
        
        emscriptenInstance.HEAPF32!.set(ax, axPtr >> 2);
        emscriptenInstance.HEAPF32!.set(ay, ayPtr >> 2);
        emscriptenInstance.HEAPF32!.set(az, azPtr >> 2);
        
        cppBatchDistSq3DOmp(axPtr, ayPtr, azPtr, bx, by, bz, count, outPtr);
        
        output.set(emscriptenInstance.HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        emscriptenInstance._free!(axPtr);
        emscriptenInstance._free!(ayPtr);
        emscriptenInstance._free!(azPtr);
        emscriptenInstance._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        const dx = ax[i] - bx;
        const dy = ay[i] - by;
        const dz = az[i] - bz;
        output[i] = dx * dx + dy * dy + dz * dz;
    }
    return output;
}

/**
 * Fast sine approximation using C++ function
 * @param x - Angle in radians
 * @returns Sine value
 */
export function fastSin(x: number): number {
    if (cppFastSin && emscriptenInstance) {
        return cppFastSin(x);
    }
    return Math.sin(x);
}

/**
 * Fast cosine approximation using C++ function
 * @param x - Angle in radians
 * @returns Cosine value
 */
export function fastCos(x: number): number {
    if (cppFastCos && emscriptenInstance) {
        return cppFastCos(x);
    }
    return Math.cos(x);
}

/**
 * Fast 2^x approximation using C++ function
 * @param x - Exponent
 * @returns 2^x value
 */
export function fastPow2(x: number): number {
    if (cppFastPow2 && emscriptenInstance) {
        return cppFastPow2(x);
    }
    return Math.pow(2, x);
}

// =============================================================================
// C++ EMSCRIPTEN ANIMATION BATCH WRAPPERS
// =============================================================================

/**
 * Input stride for animation batch functions (6 floats per entry)
 * [offset, x, y, z, intensity, unused]
 */
const ANIM_ENTRY_STRIDE = 6;

/**
 * Output stride for animation batch functions (4 floats per entry)
 * [rotX, rotY, rotZ, scale]
 */
const ANIM_RESULT_STRIDE = 4;

/**
 * JS fallback for batch shiver animation
 */
function batchShiverJS(offsets: Float32Array, time: number, intensity: number): Float32Array {
    const count = offsets.length;
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        const shiver = Math.sin(time * 20 + offsets[i]) * 0.05 * intensity;
        output[i * 4] = shiver * 0.5;     // rotX
        output[i * 4 + 1] = 0;             // rotY
        output[i * 4 + 2] = shiver;        // rotZ
        output[i * 4 + 3] = 1;             // scale
    }
    
    return output;
}

/**
 * Batch shiver animation using SIMD C++ function
 * @param input - Input array [offset, x, y, z, intensity, unused] per entry
 * @param count - Number of entries
 * @param time - Current time
 * @param intensity - Animation intensity
 * @param output - Output array [rotX, rotY, rotZ, scale] per entry
 * @returns True if successful
 */
export function batchShiverSimd(
    input: Float32Array,
    count: number,
    time: number,
    intensity: number,
    output: Float32Array
): boolean {
    if (!cppBatchShiverSimd || !emscriptenInstance) return false;
    
    const inputPtr = emscriptenInstance._malloc!(input.length * 4);
    const outputPtr = emscriptenInstance._malloc!(output.length * 4);
    
    if (!inputPtr || !outputPtr) return false;
    
    emscriptenInstance.HEAPF32!.set(input, inputPtr >> 2);
    
    cppBatchShiverSimd(inputPtr, count, time, intensity, outputPtr);
    
    output.set(emscriptenInstance.HEAPF32!.subarray(outputPtr >> 2, (outputPtr >> 2) + output.length));
    
    emscriptenInstance._free!(inputPtr);
    emscriptenInstance._free!(outputPtr);
    
    return true;
}

/**
 * High-level wrapper for batch shiver animation
 * @param offsets - Float32Array of offsets per object
 * @param time - Current time
 * @param intensity - Animation intensity
 * @returns Float32Array of animation results [rotX, rotY, rotZ, scale] per object
 */
export function batchShiverHighLevel(
    offsets: Float32Array,
    time: number,
    intensity: number
): Float32Array {
    const count = offsets.length;
    const input = new Float32Array(count * ANIM_ENTRY_STRIDE);
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    // Fill input array
    for (let i = 0; i < count; i++) {
        input[i * ANIM_ENTRY_STRIDE] = offsets[i];
        input[i * ANIM_ENTRY_STRIDE + 4] = intensity;
    }
    
    if (batchShiverSimd(input, count, time, intensity, output)) {
        return output;
    }
    
    // JS fallback
    return batchShiverJS(offsets, time, intensity);
}

/**
 * JS fallback for batch spring animation
 */
function batchSpringJS(offsets: Float32Array, time: number, intensity: number): Float32Array {
    const count = offsets.length;
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        const spring = Math.sin(time * 5 + offsets[i]) * 0.1 * intensity;
        output[i * 4] = spring * 0.3;     // rotX
        output[i * 4 + 1] = 0;             // rotY
        output[i * 4 + 2] = spring;        // rotZ
        output[i * 4 + 3] = 1 + spring * 0.1; // scale
    }
    
    return output;
}

/**
 * Batch spring animation using SIMD C++ function
 * @param input - Input array [offset, x, y, z, intensity, unused] per entry
 * @param count - Number of entries
 * @param time - Current time
 * @param intensity - Animation intensity
 * @param output - Output array [rotX, rotY, rotZ, scale] per entry
 * @returns True if successful
 */
export function batchSpringSimd(
    input: Float32Array,
    count: number,
    time: number,
    intensity: number,
    output: Float32Array
): boolean {
    if (!cppBatchSpringSimd || !emscriptenInstance) return false;
    
    const inputPtr = emscriptenInstance._malloc!(input.length * 4);
    const outputPtr = emscriptenInstance._malloc!(output.length * 4);
    
    if (!inputPtr || !outputPtr) return false;
    
    emscriptenInstance.HEAPF32!.set(input, inputPtr >> 2);
    
    cppBatchSpringSimd(inputPtr, count, time, intensity, outputPtr);
    
    output.set(emscriptenInstance.HEAPF32!.subarray(outputPtr >> 2, (outputPtr >> 2) + output.length));
    
    emscriptenInstance._free!(inputPtr);
    emscriptenInstance._free!(outputPtr);
    
    return true;
}

/**
 * High-level wrapper for batch spring animation
 * @param offsets - Float32Array of offsets per object
 * @param time - Current time
 * @param intensity - Animation intensity
 * @returns Float32Array of animation results
 */
export function batchSpringHighLevel(
    offsets: Float32Array,
    time: number,
    intensity: number
): Float32Array {
    const count = offsets.length;
    const input = new Float32Array(count * ANIM_ENTRY_STRIDE);
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        input[i * ANIM_ENTRY_STRIDE] = offsets[i];
        input[i * ANIM_ENTRY_STRIDE + 4] = intensity;
    }
    
    if (batchSpringSimd(input, count, time, intensity, output)) {
        return output;
    }
    
    return batchSpringJS(offsets, time, intensity);
}

/**
 * JS fallback for batch float animation
 */
function batchFloatJS(offsets: Float32Array, time: number, intensity: number): Float32Array {
    const count = offsets.length;
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        const bob = Math.sin(time * 2 + offsets[i]) * 0.5 * intensity;
        output[i * 4] = 0;                 // rotX
        output[i * 4 + 1] = 0;             // rotY
        output[i * 4 + 2] = 0;             // rotZ
        output[i * 4 + 3] = 1 + bob * 0.1; // scale
    }
    
    return output;
}

/**
 * Batch float animation using SIMD C++ function
 * @param input - Input array [offset, x, y, z, intensity, unused] per entry
 * @param count - Number of entries
 * @param time - Current time
 * @param intensity - Animation intensity
 * @param output - Output array [rotX, rotY, rotZ, scale] per entry
 * @returns True if successful
 */
export function batchFloatSimd(
    input: Float32Array,
    count: number,
    time: number,
    intensity: number,
    output: Float32Array
): boolean {
    if (!cppBatchFloatSimd || !emscriptenInstance) return false;
    
    const inputPtr = emscriptenInstance._malloc!(input.length * 4);
    const outputPtr = emscriptenInstance._malloc!(output.length * 4);
    
    if (!inputPtr || !outputPtr) return false;
    
    emscriptenInstance.HEAPF32!.set(input, inputPtr >> 2);
    
    cppBatchFloatSimd(inputPtr, count, time, intensity, outputPtr);
    
    output.set(emscriptenInstance.HEAPF32!.subarray(outputPtr >> 2, (outputPtr >> 2) + output.length));
    
    emscriptenInstance._free!(inputPtr);
    emscriptenInstance._free!(outputPtr);
    
    return true;
}

/**
 * High-level wrapper for batch float animation
 * @param offsets - Float32Array of offsets per object
 * @param time - Current time
 * @param intensity - Animation intensity
 * @returns Float32Array of animation results
 */
export function batchFloatHighLevel(
    offsets: Float32Array,
    time: number,
    intensity: number
): Float32Array {
    const count = offsets.length;
    const input = new Float32Array(count * ANIM_ENTRY_STRIDE);
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        input[i * ANIM_ENTRY_STRIDE] = offsets[i];
        input[i * ANIM_ENTRY_STRIDE + 4] = intensity;
    }
    
    if (batchFloatSimd(input, count, time, intensity, output)) {
        return output;
    }
    
    return batchFloatJS(offsets, time, intensity);
}

/**
 * JS fallback for batch cloud bob animation
 */
function batchCloudBobJS(offsets: Float32Array, time: number, intensity: number): Float32Array {
    const count = offsets.length;
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        const bob = Math.sin(time * 1.5 + offsets[i]) * 0.3 * intensity;
        output[i * 4] = 0;                 // rotX
        output[i * 4 + 1] = bob * 0.5;     // rotY (sway)
        output[i * 4 + 2] = 0;             // rotZ
        output[i * 4 + 3] = 1 + bob * 0.05; // scale
    }
    
    return output;
}

/**
 * Batch cloud bob animation using SIMD C++ function
 * @param input - Input array [offset, x, y, z, intensity, unused] per entry
 * @param count - Number of entries
 * @param time - Current time
 * @param intensity - Animation intensity
 * @param output - Output array [rotX, rotY, rotZ, scale] per entry
 * @returns True if successful
 */
export function batchCloudBobSimd(
    input: Float32Array,
    count: number,
    time: number,
    intensity: number,
    output: Float32Array
): boolean {
    if (!cppBatchCloudBobSimd || !emscriptenInstance) return false;
    
    const inputPtr = emscriptenInstance._malloc!(input.length * 4);
    const outputPtr = emscriptenInstance._malloc!(output.length * 4);
    
    if (!inputPtr || !outputPtr) return false;
    
    emscriptenInstance.HEAPF32!.set(input, inputPtr >> 2);
    
    cppBatchCloudBobSimd(inputPtr, count, time, intensity, outputPtr);
    
    output.set(emscriptenInstance.HEAPF32!.subarray(outputPtr >> 2, (outputPtr >> 2) + output.length));
    
    emscriptenInstance._free!(inputPtr);
    emscriptenInstance._free!(outputPtr);
    
    return true;
}

/**
 * High-level wrapper for batch cloud bob animation
 * @param offsets - Float32Array of offsets per object
 * @param time - Current time
 * @param intensity - Animation intensity
 * @returns Float32Array of animation results
 */
export function batchCloudBobHighLevel(
    offsets: Float32Array,
    time: number,
    intensity: number
): Float32Array {
    const count = offsets.length;
    const input = new Float32Array(count * ANIM_ENTRY_STRIDE);
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        input[i * ANIM_ENTRY_STRIDE] = offsets[i];
        input[i * ANIM_ENTRY_STRIDE + 4] = intensity;
    }
    
    if (batchCloudBobSimd(input, count, time, intensity, output)) {
        return output;
    }
    
    return batchCloudBobJS(offsets, time, intensity);
}

/**
 * JS fallback for batch vine sway animation
 */
function batchVineSwayJS(offsets: Float32Array, time: number, intensity: number): Float32Array {
    const count = offsets.length;
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        const sway = Math.sin(time * 3 + offsets[i]) * 0.2 * intensity;
        output[i * 4] = sway;              // rotX
        output[i * 4 + 1] = sway * 0.5;    // rotY
        output[i * 4 + 2] = sway * 0.3;    // rotZ
        output[i * 4 + 3] = 1;             // scale
    }
    
    return output;
}

/**
 * Batch vine sway animation using SIMD C++ function
 * @param input - Input array [offset, x, y, z, intensity, unused] per entry
 * @param count - Number of entries
 * @param time - Current time
 * @param intensity - Animation intensity
 * @param output - Output array [rotX, rotY, rotZ, scale] per entry
 * @returns True if successful
 */
export function batchVineSwaySimd(
    input: Float32Array,
    count: number,
    time: number,
    intensity: number,
    output: Float32Array
): boolean {
    if (!cppBatchVineSwaySimd || !emscriptenInstance) return false;
    
    const inputPtr = emscriptenInstance._malloc!(input.length * 4);
    const outputPtr = emscriptenInstance._malloc!(output.length * 4);
    
    if (!inputPtr || !outputPtr) return false;
    
    emscriptenInstance.HEAPF32!.set(input, inputPtr >> 2);
    
    cppBatchVineSwaySimd(inputPtr, count, time, intensity, outputPtr);
    
    output.set(emscriptenInstance.HEAPF32!.subarray(outputPtr >> 2, (outputPtr >> 2) + output.length));
    
    emscriptenInstance._free!(inputPtr);
    emscriptenInstance._free!(outputPtr);
    
    return true;
}

/**
 * High-level wrapper for batch vine sway animation
 * @param offsets - Float32Array of offsets per object
 * @param time - Current time
 * @param intensity - Animation intensity
 * @returns Float32Array of animation results
 */
export function batchVineSwayHighLevel(
    offsets: Float32Array,
    time: number,
    intensity: number
): Float32Array {
    const count = offsets.length;
    const input = new Float32Array(count * ANIM_ENTRY_STRIDE);
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        input[i * ANIM_ENTRY_STRIDE] = offsets[i];
        input[i * ANIM_ENTRY_STRIDE + 4] = intensity;
    }
    
    if (batchVineSwaySimd(input, count, time, intensity, output)) {
        return output;
    }
    
    return batchVineSwayJS(offsets, time, intensity);
}

/**
 * JS fallback for batch geyser erupt animation
 */
function batchGeyserEruptJS(particles: Float32Array, time: number, kick: number): Float32Array {
    const count = particles.length / 3; // particles are [x, y, z] triplets
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        const erupt = Math.max(0, Math.sin(time * 10 + particles[i * 3])) * kick;
        output[i * 4] = 0;                 // rotX
        output[i * 4 + 1] = erupt;         // rotY (used as upward velocity)
        output[i * 4 + 2] = 0;             // rotZ
        output[i * 4 + 3] = 1 + erupt * 0.5; // scale
    }
    
    return output;
}

/**
 * Batch geyser erupt animation using C function
 * @param particles - Particle positions [x, y, z] triplets
 * @param count - Number of particles
 * @param time - Current time
 * @param kick - Kick intensity
 * @param output - Output array [rotX, rotY, rotZ, scale] per entry
 * @returns True if successful
 */
export function batchGeyserEruptC(
    particles: Float32Array,
    count: number,
    time: number,
    kick: number,
    output: Float32Array
): boolean {
    if (!cppBatchGeyserEruptC || !emscriptenInstance) return false;
    
    const particlesPtr = emscriptenInstance._malloc!(particles.length * 4);
    const outputPtr = emscriptenInstance._malloc!(output.length * 4);
    
    if (!particlesPtr || !outputPtr) return false;
    
    emscriptenInstance.HEAPF32!.set(particles, particlesPtr >> 2);
    
    cppBatchGeyserEruptC(particlesPtr, count, time, kick, outputPtr);
    
    output.set(emscriptenInstance.HEAPF32!.subarray(outputPtr >> 2, (outputPtr >> 2) + output.length));
    
    emscriptenInstance._free!(particlesPtr);
    emscriptenInstance._free!(outputPtr);
    
    return true;
}

/**
 * High-level wrapper for batch geyser erupt animation
 * @param particles - Float32Array of particle positions [x, y, z] triplets
 * @param time - Current time
 * @param kick - Kick intensity
 * @returns Float32Array of animation results
 */
export function batchGeyserEruptHighLevel(
    particles: Float32Array,
    time: number,
    kick: number
): Float32Array {
    const count = particles.length / 3;
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    if (batchGeyserEruptC(particles, count, time, kick, output)) {
        return output;
    }
    
    return batchGeyserEruptJS(particles, time, kick);
}

/**
 * JS fallback for batch retrigger animation
 */
function batchRetriggerJS(offsets: Float32Array, time: number, retriggerSpeed: number, intensity: number): Float32Array {
    const count = offsets.length;
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        const cycle = (time * retriggerSpeed + offsets[i]) % 1;
        const pulse = Math.sin(cycle * Math.PI * 2) * intensity;
        output[i * 4] = pulse * 0.3;       // rotX
        output[i * 4 + 1] = 0;             // rotY
        output[i * 4 + 2] = pulse * 0.5;   // rotZ
        output[i * 4 + 3] = 1 + pulse * 0.2; // scale
    }
    
    return output;
}

/**
 * Batch retrigger animation using SIMD C++ function
 * @param input - Input array [offset, x, y, z, intensity, unused] per entry
 * @param count - Number of entries
 * @param time - Current time
 * @param retriggerSpeed - Speed of retrigger cycle
 * @param intensity - Animation intensity
 * @param output - Output array [rotX, rotY, rotZ, scale] per entry
 * @returns True if successful
 */
export function batchRetriggerSimd(
    input: Float32Array,
    count: number,
    time: number,
    retriggerSpeed: number,
    intensity: number,
    output: Float32Array
): boolean {
    if (!cppBatchRetriggerSimd || !emscriptenInstance) return false;
    
    const inputPtr = emscriptenInstance._malloc!(input.length * 4);
    const outputPtr = emscriptenInstance._malloc!(output.length * 4);
    
    if (!inputPtr || !outputPtr) return false;
    
    emscriptenInstance.HEAPF32!.set(input, inputPtr >> 2);
    
    cppBatchRetriggerSimd(inputPtr, count, time, retriggerSpeed, intensity, outputPtr);
    
    output.set(emscriptenInstance.HEAPF32!.subarray(outputPtr >> 2, (outputPtr >> 2) + output.length));
    
    emscriptenInstance._free!(inputPtr);
    emscriptenInstance._free!(outputPtr);
    
    return true;
}

/**
 * High-level wrapper for batch retrigger animation
 * @param offsets - Float32Array of offsets per object
 * @param time - Current time
 * @param retriggerSpeed - Speed of retrigger cycle
 * @param intensity - Animation intensity
 * @returns Float32Array of animation results
 */
export function batchRetriggerHighLevel(
    offsets: Float32Array,
    time: number,
    retriggerSpeed: number,
    intensity: number
): Float32Array {
    const count = offsets.length;
    const input = new Float32Array(count * ANIM_ENTRY_STRIDE);
    const output = new Float32Array(count * ANIM_RESULT_STRIDE);
    
    for (let i = 0; i < count; i++) {
        input[i * ANIM_ENTRY_STRIDE] = offsets[i];
        input[i * ANIM_ENTRY_STRIDE + 4] = intensity;
    }
    
    if (batchRetriggerSimd(input, count, time, retriggerSpeed, intensity, output)) {
        return output;
    }
    
    return batchRetriggerJS(offsets, time, retriggerSpeed, intensity);
}

// =============================================================================
// NEW PARTICLE FUNCTIONS FROM ASSEMBLY/PARTICLES.TS
// =============================================================================

/**
 * Update particles with physics
 * @param positions - Float32Array of particle positions [x0, y0, z0, x1, y1, z1, ...] or pointer offset
 * @param count - Number of particles
 * @param dt - Delta time
 * @param gravity - Gravity value
 */
export function updateParticles(
    positions: Float32Array | number,
    count: number,
    dt: number,
    gravity: number
): void {
    if (wasmUpdateParticles && typeof positions === 'number') {
        wasmUpdateParticles(positions, count, dt, gravity);
        return;
    }
    
    // JS fallback: Simple gravity update
    if (positions instanceof Float32Array) {
        for (let i = 0; i < count; i++) {
            const idx = i * 3 + 1; // Y component
            positions[idx] += gravity * dt;
        }
    }
}

/**
 * Spawn a burst of particles from a center point
 * @param output - Float32Array to write positions/velocities [x0, y0, z0, vx0, vy0, vz0, ...] or pointer offset
 * @param count - Number of particles to spawn
 * @param centerX - Center X position
 * @param centerY - Center Y position
 * @param centerZ - Center Z position
 * @param speed - Initial speed
 * @param time - Time value for randomization
 */
export function spawnBurst(
    output: Float32Array | number,
    count: number,
    centerX: number,
    centerY: number,
    centerZ: number,
    speed: number,
    time: number
): void {
    if (wasmSpawnBurst && typeof output === 'number') {
        wasmSpawnBurst(output, count, centerX, centerY, centerZ, speed, time);
        return;
    }
    
    // JS fallback: Random burst pattern
    if (output instanceof Float32Array) {
        for (let i = 0; i < count; i++) {
            const idx = i * 6;
            // Random direction on sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const vx = Math.sin(phi) * Math.cos(theta) * speed;
            const vy = Math.sin(phi) * Math.sin(theta) * speed;
            const vz = Math.cos(phi) * speed;
            
            output[idx] = centerX;
            output[idx + 1] = centerY;
            output[idx + 2] = centerZ;
            output[idx + 3] = vx;
            output[idx + 4] = vy;
            output[idx + 5] = vz;
        }
    }
}
