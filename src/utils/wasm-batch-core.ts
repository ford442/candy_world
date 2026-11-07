/**
 * @file wasm-batch-core.ts
 * @brief Core batch operations: uploads, culling and spawning
 *
 * Handles:
 * - Batch uploads: uploadPositionsFlat, uploadMushroomSpecs
 * - Culling: batchDistanceCull
 * - Spawning: batchMushroomSpawnCandidates, readSpawnCandidates
 */

import { SpawnCandidate, DistanceCullResult } from './wasm-batch-types.ts';
import {
    wasmInstance,
    positionView,
    animationView,
    outputView,
    wasmBatchMushroomSpawnCandidates,
    refreshWasmViews,
    OUTPUT_OFFSET,
    type WasmExports,
    type Mushroom,
} from './wasm-loader-core.ts';
import { MAX_POSITION_OBJECTS } from './native-memory-layout.ts';

// =============================================================================
// BATCH UPLOAD FUNCTIONS
// =============================================================================

/** Max objects the AssemblyScript position buffer can hold (4096 bytes / 16). */
export const WASM_POSITION_OBJECT_CAPACITY = MAX_POSITION_OBJECTS;

/**
 * Upload packed Float32Array positions to WASM
 * @param buf - Flat Float32Array with stride 4 (x, y, z, radius)
 * @param count - Number of items
 */
export function uploadPositionsFlat(buf: Float32Array, count: number): void {
    refreshWasmViews();
    if (!positionView) return;
    const capacity = Math.floor(positionView.length / 4);
    const limit = Math.min(count, capacity, WASM_POSITION_OBJECT_CAPACITY);
    if (limit <= 0) return;
    positionView.set(buf.subarray(0, limit * 4));
}

/**
 * Upload mushroom specs to WASM
 * @param mushrooms - Array of mushroom objects
 */
export function uploadMushroomSpecs(mushrooms: Mushroom[]): void {
    refreshWasmViews();
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
export function batchDistanceCull(
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    maxDistance: number,
    objectCount: number
): DistanceCullResult {
    const maxDistSq = maxDistance * maxDistance;
    if (!wasmInstance) return { visibleCount: objectCount, flags: null };
    refreshWasmViews();
    const wasmCapacity = positionView
        ? Math.min(Math.floor(positionView.length / 4), WASM_POSITION_OBJECT_CAPACITY)
        : WASM_POSITION_OBJECT_CAPACITY;
    const cappedCount = Math.min(objectCount, wasmCapacity);
    if (cappedCount <= 0) return { visibleCount: objectCount, flags: null };

    const exports = wasmInstance.exports as WasmExports;
    const visibleCount = exports.batchDistanceCull!(
        cameraX,
        cameraY,
        cameraZ,
        maxDistSq,
        cappedCount,
        OUTPUT_OFFSET
    );
    refreshWasmViews();

    return { visibleCount, flags: outputView!.subarray(0, cappedCount) };
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
        return wasmBatchMushroomSpawnCandidates(
            time,
            windX,
            windZ,
            windSpeed,
            objectCount,
            spawnThreshold,
            minDistance,
            maxDistance
        );
    }
    return 0;
}

/**
 * Read spawn candidates from output view
 * @param candidateCount - Number of candidates to read
 * @returns Array of spawn candidates
 */
export function readSpawnCandidates(candidateCount: number): SpawnCandidate[] {
    refreshWasmViews();
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
