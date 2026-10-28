/**
 * @file wasm-batch-animation.ts
 * @brief C++ batch wrappers: LOD factors, distance culling, fluid simulation
 *
 * The animation, mesh-deformation, matrix and frustum wrappers that used to
 * live here had no caller and were deleted with their C++ exports (#2026).
 */

import { getEmscriptenInstance, emscriptenMemory, getNativeFunc } from './wasm-loader-core.ts';

// =============================================================================
// LOD BATCH FUNCTIONS
// =============================================================================

let _lodFactorsCapacity = 0;
let _lodFactorsPtrPos = 0;
let _lodFactorsPtrSmoothed = 0;
let _lodFactorsPtrStats = 0;

export function batchUpdateLodFactors_c(
    matrices: Float32Array,
    smoothed: Float32Array,
    count: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    heroMax: number,
    midMax: number,
    blendWidth: number,
    farCullSq: number,
    blendT: number,
    statsOut: Int32Array
): void {
    const f = getNativeFunc('batchUpdateLodFactors_c');
    const emsc = getEmscriptenInstance();
    if (!f || !emscriptenMemory || !emsc || !emsc._malloc || !emsc._free) {
        return;
    }

    if (count > _lodFactorsCapacity) {
        if (_lodFactorsPtrPos) emsc._free(_lodFactorsPtrPos);
        if (_lodFactorsPtrSmoothed) emsc._free(_lodFactorsPtrSmoothed);
        if (_lodFactorsPtrStats) emsc._free(_lodFactorsPtrStats);

        _lodFactorsCapacity = Math.max(count * 2, 256);
        _lodFactorsPtrPos = emsc._malloc(_lodFactorsCapacity * 16 * 4);
        _lodFactorsPtrSmoothed = emsc._malloc(_lodFactorsCapacity * 4);
        _lodFactorsPtrStats = emsc._malloc(6 * 4);
    }

    if (!_lodFactorsPtrPos || !_lodFactorsPtrSmoothed || !_lodFactorsPtrStats) return;

    const memoryBuffer = (emscriptenMemory as any).buffer || emscriptenMemory;
    let heapF32 = _cachedHeapF32;
    if (!heapF32 || heapF32.buffer !== memoryBuffer || heapF32.length === 0) {
        heapF32 = _cachedHeapF32 = new Float32Array(memoryBuffer);
    }

    const heapI32 = new Int32Array(memoryBuffer);

    heapF32.set(matrices.subarray(0, count * 16), _lodFactorsPtrPos >> 2);
    heapF32.set(smoothed.subarray(0, count), _lodFactorsPtrSmoothed >> 2);

    f(
        _lodFactorsPtrPos,
        _lodFactorsPtrSmoothed,
        count,
        cameraX,
        cameraY,
        cameraZ,
        heroMax,
        midMax,
        blendWidth,
        farCullSq,
        blendT,
        _lodFactorsPtrStats
    );

    smoothed.set(heapF32.subarray(_lodFactorsPtrSmoothed >> 2, (_lodFactorsPtrSmoothed >> 2) + count));
    statsOut.set(heapI32.subarray(_lodFactorsPtrStats >> 2, (_lodFactorsPtrStats >> 2) + 6));
}

// =============================================================================
// DISTANCE CULLING
// =============================================================================

let _distanceCullCapacity = 0;
let _distanceCullPtrPos = 0;
let _distanceCullPtrFlags = 0;
let _cachedHeapF32: Float32Array | null = null;

/**
 * Batch distance cull (SIMD/WASM) for flat positions
 * @param positions - Float32Array of positions [x, y, z, ...]
 * @param count - Number of positions
 * @param camX - Reference X
 * @param camY - Reference Y
 * @param camZ - Reference Z
 * @param maxDistSq - Max distance squared
 * @param results - Float32Array to receive flags (1.0 = visible, 0.0 = culled)
 * @returns visibleCount
 */
export function batchDistanceCull_c(
    positions: Float32Array,
    count: number,
    camX: number,
    camY: number,
    camZ: number,
    maxDistSq: number,
    results: Float32Array
): number {
    const f = getNativeFunc('batchDistanceCull_c');
    const emsc = getEmscriptenInstance();
    if (!f || !emscriptenMemory || !emsc || !emsc._malloc || !emsc._free) {
        // TypeScript Fallback
        let visibleCount = 0;
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const dx = positions[idx] - camX;
            const dy = positions[idx + 1] - camY;
            const dz = positions[idx + 2] - camZ;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq <= maxDistSq) {
                results[i] = 1.0;
                visibleCount++;
            } else {
                results[i] = 0.0;
            }
        }
        return visibleCount;
    }

    // ⚡ OPTIMIZATION: Zero-allocation persistent pointers
    if (count > _distanceCullCapacity) {
        if (_distanceCullPtrPos) emsc._free(_distanceCullPtrPos);
        if (_distanceCullPtrFlags) emsc._free(_distanceCullPtrFlags);

        _distanceCullCapacity = Math.max(count * 2, 256);
        _distanceCullPtrPos = emsc._malloc(_distanceCullCapacity * 3 * 4);
        _distanceCullPtrFlags = emsc._malloc(_distanceCullCapacity * 4);
    }

    if (!_distanceCullPtrPos || !_distanceCullPtrFlags) return 0;

    const memoryBuffer = (emscriptenMemory as any).buffer || emscriptenMemory;
    // ⚡ OPTIMIZATION: Use a cached view instead of new Float32Array every frame to eliminate GC spikes
    let heapF32 = _cachedHeapF32;
    if (!heapF32 || heapF32.buffer !== memoryBuffer || heapF32.length === 0) {
        heapF32 = _cachedHeapF32 = new Float32Array(memoryBuffer);
    }

    // Copy positions to WASM memory
    heapF32.set(positions.subarray(0, count * 3), _distanceCullPtrPos >> 2);

    // Run C++ function
    const visibleCount = f(_distanceCullPtrPos, _distanceCullPtrFlags, count, camX, camY, camZ, maxDistSq);

    // Copy results back
    results.set(heapF32.subarray(_distanceCullPtrFlags >> 2, (_distanceCullPtrFlags >> 2) + count));

    return visibleCount;
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
