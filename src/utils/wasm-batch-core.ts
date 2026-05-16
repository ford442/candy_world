/**
 * @file wasm-batch-core.ts
 * @brief Core batch operations: uploads, culling, spawning, and material analysis
 * 
 * Handles:
 * - Batch uploads: uploadPositions, uploadMushroomSpecs, copySharedPositions, uploadAnimationData
 * - Culling: batchDistanceCull
 * - Spawning: batchMushroomSpawnCandidates, readSpawnCandidates
 * - Materials: analyzeMaterials, getUniqueShaderCount
 */

import { 
    wasmInstance,
    wasmMemory,
    positionView,
    animationView,
    outputView,
    wasmBatchMushroomSpawnCandidates,
    type WasmExports,
    type Mushroom,
    type AnimationData,
    type PositionData
} from './wasm-loader-core.js';

import { 
    SpawnCandidate, 
    MaterialAnalysisResult, 
    DistanceCullResult,
    MaterialInfo 
} from './wasm-batch-types.js';

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
