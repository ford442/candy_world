import { POSITION_OFFSET, ANIMATION_OFFSET, MATERIAL_DATA_OFFSET, OUTPUT_OFFSET } from "./constants";
import { getGroundHeight, } from "./math";

// Constants for batch operations
const STRIDE_F32 = 4;

// =============================================================================
// MATERIAL ANALYSIS CONSTANTS (Strategy 3: Shader Pre-Hashing)
// =============================================================================
const MAX_UNIQUE_SHADERS: i32 = 64;

// Cached shader hash map (simulated with linear storage)
let _uniqueShaderCount: i32 = 0;

/**
 * Analyze materials and return count of unique shader combinations
 * This pre-processes materials before GPU pipeline creation to identify
 * which shader modules need to be compiled.
 * 
 * Material data layout per material (16 bytes = 4 x i32):
 *   [0-3]   vertexShaderId: i32
 *   [4-7]   fragmentShaderId: i32  
 *   [8-11]  blendingMode: i32
 *   [12-15] flags: i32 (bit 0 = doubleSided, bit 1 = transparent, etc.)
 * 
 * @param materialPtr - Pointer to material data in WASM memory
 * @param count - Number of materials to analyze
 * @returns Number of unique shader combinations found
 */
export function analyzeMaterials(materialPtr: i32, count: i32): i32 {
    if (count <= 0) return 0;
    
    // Simple deduplication using a small hash table
    const hashTableSize: i32 = 128;
    const hashTable = new StaticArray<i32>(hashTableSize);
    
    // Initialize hash table
    for (let i = 0; i < hashTableSize; i++) {
        unchecked(hashTable[i] = -1);
    }
    
    let uniqueCount: i32 = 0;
    
    for (let i = 0; i < count; i++) {
        const ptr = materialPtr + i * 16;
        
        const vertexId = load<i32>(ptr);
        const fragmentId = load<i32>(ptr + 4);
        const blendMode = load<i32>(ptr + 8);
        const flags = load<i32>(ptr + 12);
        
        // Create a simple hash from shader configuration
        const hash = computeShaderHash(vertexId, fragmentId, blendMode, flags);
        const slot = hash % hashTableSize;
        
        // Linear probe for collision - look for empty slot or existing match
        for (let probe = 0; probe < hashTableSize; probe++) {
            const idx = (slot + probe) % hashTableSize;
            if (unchecked(hashTable[idx]) == -1) {
                // Empty slot - new unique shader
                unchecked(hashTable[idx] = hash);
                
                // Store shader info in output area for JS to read
                if (uniqueCount < MAX_UNIQUE_SHADERS) {
                    const outPtr = MATERIAL_DATA_OFFSET + uniqueCount * 16;
                    store<i32>(outPtr, vertexId);
                    store<i32>(outPtr + 4, fragmentId);
                    store<i32>(outPtr + 8, blendMode);
                    store<i32>(outPtr + 12, flags);
                }
                
                uniqueCount++;
                break;
            } else if (unchecked(hashTable[idx]) == hash) {
                // Found existing match - not unique, skip
                break;
            }
        }
    }
    
    _uniqueShaderCount = uniqueCount;
    return uniqueCount;
}

/**
 * Compute a hash for shader configuration
 * This creates a unique identifier for each shader variant
 */
function computeShaderHash(vertexId: i32, fragmentId: i32, blendMode: i32, flags: i32): i32 {
    // Simple hash combining function
    let hash: i32 = 17;
    hash = hash * 31 + vertexId;
    hash = hash * 31 + fragmentId;
    hash = hash * 31 + blendMode;
    hash = hash * 31 + (flags & 0xFF); // Only use low bits of flags
    return hash & 0x7FFFFFFF; // Keep positive
}

/**
 * Check distances for all objects and return visibility mask
 * Original logic:
 *  - Iterates objects
 *  - Checks distance sq < maxDistSq
 *  - Writes 1.0 (visible) or 0.0 (hidden) to output buffer (flags)
 *  - Returns visible count
 */
export function batchDistanceCull(cameraX: f32, cameraY: f32, cameraZ: f32, maxDistSq: f32, objectCount: i32, flagsPtr: i32): i32 {
  let visibleCount = 0;

  for (let i = 0; i < objectCount; i++) {
    const ptr = POSITION_OFFSET + i * 16;
    const objX = load<f32>(ptr);
    const objY = load<f32>(ptr + 4);
    const objZ = load<f32>(ptr + 8);

    const dx = cameraX - objX;
    const dy = cameraY - objY;
    const dz = cameraZ - objZ;

    const distSq = dx*dx + dy*dy + dz*dz;

    if (distSq < maxDistSq) {
      store<f32>(flagsPtr + i * 4, 1.0);
      visibleCount++;
    } else {
      store<f32>(flagsPtr + i * 4, 0.0);
    }
  }

  return visibleCount;
}

// Re-export mushroom spawn logic from original (simplified for batch)
export function batchMushroomSpawnCandidates(
    time: f32,
    playerX: f32,
    playerZ: f32,
    minDistance: f32,
    maxDistance: f32,
    windSpeed: f32,
    windX: f32,
    windZ: f32,
    objectCount: i32,
    candidateCount: i32,
    spawnThreshold: f32
): i32 {
    // Note: The caller passes 'candidateCount' as accumulator?
    // The original implementation returned the new total count.

    // Limits
    const MAX_CANDIDATES = 64;

    // Iterate a fixed number of attempts or based on something?
    // Original loop was objectCount based to try spawning near existing objects?
    // Or was it random?
    // Based on the restored file content:
    /*
      for (let i = 0; i < objectCount; i++) {
        // ... logic ...
      }
    */

    for (let i = 0; i < objectCount; i++) {
        if (candidateCount >= MAX_CANDIDATES) break;

        const ptr = POSITION_OFFSET + i * 16;
        const objX = load<f32>(ptr);
        const objZ = load<f32>(ptr + 8);
        const objR = load<f32>(ptr + 12);

        // Read colorIndex from animation data padding
        const animPtr = ANIMATION_OFFSET + i * 16;
        const colorIndex = <i32>load<f32>(animPtr + 12);

        // Pseudo-random values derived from time and index
        const seed = Mathf.abs(time * 1000.0 + <f32>i);
        const r1 = Mathf.sin(seed * 12.9898) * 43758.5453;
        const r2 = Mathf.sin((seed + 1.2345) * 78.233) * 43758.5453;
        const rand1 = r1 - Mathf.floor(r1);
        const rand2 = r2 - Mathf.floor(r2);

        // Weight selection
        let colorWeight: f32 = 0.005;
        if (colorIndex >= 0 && colorIndex <= 3) colorWeight = 0.02;
        else if (colorIndex == 4) colorWeight = 0.01;

        const spawnProb = windSpeed * colorWeight;
        if (rand1 > (spawnProb * spawnThreshold)) continue;

        // Distance and jitter
        const dist = minDistance + rand2 * (maxDistance - minDistance);
        const jitterX = (rand2 - 0.5) * 2.0;
        const jitterZ = (rand1 - 0.5) * 2.0;

        const nx = objX + windX * dist + jitterX;
        const nz = objZ + windZ * dist + jitterZ;

        // Get ground height
        const ny = getGroundHeight(nx, nz);
        if (ny < -0.5) continue;

        // Collision check
        let collides = false;
        for (let j = 0; j < objectCount; j++) {
            if (j == i) continue;
            const optr = POSITION_OFFSET + j * 16;
            const ox = load<f32>(optr);
            const oz = load<f32>(optr + 8);
            const orad = load<f32>(optr + 12);
            const dx = nx - ox;
            const dz = nz - oz;
            const distSq = dx * dx + dz * dz;
            if (distSq < (orad + objR) * (orad + objR)) { collides = true; break; }
        }
        if (collides) continue;

        // Write candidate
        const outPtr = OUTPUT_OFFSET + candidateCount * 16;
        store<f32>(outPtr, nx);
        store<f32>(outPtr + 4, ny);
        store<f32>(outPtr + 8, nz);
        store<f32>(outPtr + 12, <f32>colorIndex);
        candidateCount++;
    }

    return candidateCount;
}

// =============================================================================
// BATCH COLOR OPERATIONS (for reactive materials)
// =============================================================================

// =============================================================================
// BATCH CULLING OPERATIONS
// =============================================================================

// =============================================================================
// BATCH ANIMATION OPERATIONS
// =============================================================================

// =============================================================================
// MATRIX COMPOSITION (parity with emscripten/lod_batch.cpp batchComposeMatrices_c
// and the TS fallback in arpeggio-batcher / tree-batcher flushMatrices)
// =============================================================================

/**
 * Compose TRS instance matrices (column-major, Three.js layout).
 * positionsPtr:   f32[count*3]  [x,y,z,...]
 * quaternionsPtr: f32[count*4]  [x,y,z,w,...]
 * scalesPtr:      f32[count*3]  [sx,sy,sz,...]
 * matricesPtr:    f32[count*16] output (column-major 4x4)
 *
 * Test/parity export — hot-path math must stay identical to C++/TS reference.
 */
export function batchComposeMatrices(
  positionsPtr: usize,
  quaternionsPtr: usize,
  scalesPtr: usize,
  matricesPtr: usize,
  count: i32
): void {
  for (let i: i32 = 0; i < count; i++) {
    const v3: usize = <usize>(i * 3) * 4;
    const qOff: usize = <usize>(i * 4) * 4;
    const mOff: usize = <usize>(i * 16) * 4;

    const px = load<f32>(positionsPtr + v3);
    const py = load<f32>(positionsPtr + v3 + 4);
    const pz = load<f32>(positionsPtr + v3 + 8);

    const qx = load<f32>(quaternionsPtr + qOff);
    const qy = load<f32>(quaternionsPtr + qOff + 4);
    const qz = load<f32>(quaternionsPtr + qOff + 8);
    const qw = load<f32>(quaternionsPtr + qOff + 12);

    const sx = load<f32>(scalesPtr + v3);
    const sy = load<f32>(scalesPtr + v3 + 4);
    const sz = load<f32>(scalesPtr + v3 + 8);

    const x2: f32 = qx + qx;
    const y2: f32 = qy + qy;
    const z2: f32 = qz + qz;
    const xx: f32 = qx * x2;
    const xy: f32 = qx * y2;
    const xz: f32 = qx * z2;
    const yy: f32 = qy * y2;
    const yz: f32 = qy * z2;
    const zz: f32 = qz * z2;
    const wx: f32 = qw * x2;
    const wy: f32 = qw * y2;
    const wz: f32 = qw * z2;

    const m: usize = matricesPtr + mOff;
    store<f32>(m + 0,  (1.0 - (yy + zz)) * sx);
    store<f32>(m + 4,  (xy + wz) * sx);
    store<f32>(m + 8,  (xz - wy) * sx);
    store<f32>(m + 12, 0.0);

    store<f32>(m + 16, (xy - wz) * sy);
    store<f32>(m + 20, (1.0 - (xx + zz)) * sy);
    store<f32>(m + 24, (yz + wx) * sy);
    store<f32>(m + 28, 0.0);

    store<f32>(m + 32, (xz + wy) * sz);
    store<f32>(m + 36, (yz - wx) * sz);
    store<f32>(m + 40, (1.0 - (xx + yy)) * sz);
    store<f32>(m + 44, 0.0);

    store<f32>(m + 48, px);
    store<f32>(m + 52, py);
    store<f32>(m + 56, pz);
    store<f32>(m + 60, 1.0);
  }
}

/**
 * Write instance RGB colors (parity with batcher instanceColor array writes).
 * colorsInPtr:  f32[count*3] source RGB
 * colorsOutPtr: f32[count*3] destination (may alias colorsInPtr)
 * intensity:    uniform scale applied to each channel
 */
export function batchWriteInstanceColors(
  colorsInPtr: usize,
  colorsOutPtr: usize,
  count: i32,
  intensity: f32
): void {
  for (let i: i32 = 0; i < count; i++) {
    const off: usize = <usize>(i * 3) * 4;
    store<f32>(colorsOutPtr + off,     load<f32>(colorsInPtr + off) * intensity);
    store<f32>(colorsOutPtr + off + 4, load<f32>(colorsInPtr + off + 4) * intensity);
    store<f32>(colorsOutPtr + off + 8, load<f32>(colorsInPtr + off + 8) * intensity);
  }
}

/**
 * Combined pose → matrix + color write (#1358 / batcher_instance.cpp parity).
 * colorsInPtr/colorsOutPtr may be 0 to skip color writes.
 */
export function batchWriteInstancePose(
  positionsPtr: usize,
  quaternionsPtr: usize,
  scalesPtr: usize,
  colorsInPtr: usize,
  matricesPtr: usize,
  colorsOutPtr: usize,
  colorIntensity: f32,
  count: i32
): void {
  batchComposeMatrices(positionsPtr, quaternionsPtr, scalesPtr, matricesPtr, count);
  if (colorsInPtr != 0 && colorsOutPtr != 0) {
    batchWriteInstanceColors(colorsInPtr, colorsOutPtr, count, colorIntensity);
  }
}
