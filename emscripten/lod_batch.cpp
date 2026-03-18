/**
 * @file lod_batch.cpp
 * @brief LOD (Level of Detail) batch matrix updates - C++/Emscripten
 * 
 * SIMD-optimized batch processing for InstancedMesh matrix updates.
 * Migrated from lod.ts lines 612-629.
 * 
 * @perf-migrate {target: "cpp", reason: "hot-loop", threshold: "2-3ms"}
 */

#include <emscripten.h>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include "omp.h"
#include <wasm_simd128.h>

extern "C" {

// =============================================================================
// BATCH LOD MATRIX UPDATE
// =============================================================================
// Input:  flat arrays of matrix data (16 floats per matrix)
// Output: optimized for InstancedMesh.setMatrixAt() pattern
// 
// Memory layout:
// - matrices: [m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33, ...]
// - colors:   [r, g, b, r, g, b, ...]
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void batchUpdateLODMatrices_c(
    float* matrices,
    float* colors,
    int count,
    float cameraX,
    float cameraY,
    float cameraZ,
    float lod1Dist,
    float lod2Dist,
    float cullDist,
    int* results
) {
    const float lod1DistSq = lod1Dist * lod1Dist;
    const float lod2DistSq = lod2Dist * lod2Dist;
    const float cullDistSq = cullDist * cullDist;
    
    // Position is in matrix[12], matrix[13], matrix[14] (translation component)
    #pragma omp parallel for schedule(static) if(count > 100)
    for (int i = 0; i < count; i++) {
        int matOffset = i * 16;
        
        float posX = matrices[matOffset + 12];
        float posY = matrices[matOffset + 13];
        float posZ = matrices[matOffset + 14];
        
        // Calculate distance squared to camera
        float dx = posX - cameraX;
        float dy = posY - cameraY;
        float dz = posZ - cameraZ;
        float distSq = dx * dx + dy * dy + dz * dz;
        
        // Determine LOD level
        int lodLevel;
        if (distSq >= cullDistSq) {
            lodLevel = 3; // Culled
        } else if (distSq >= lod2DistSq) {
            lodLevel = 2; // LOD2
        } else if (distSq >= lod1DistSq) {
            lodLevel = 1; // LOD1
        } else {
            lodLevel = 0; // LOD0
        }
        
        results[i] = lodLevel;
        
        // Optional: Scale matrices based on LOD for billboarding effect
        if (lodLevel == 2) {
            // LOD2: Reduce scale slightly for billboarding
            float scale = 0.9f;
            matrices[matOffset + 0] *= scale;
            matrices[matOffset + 5] *= scale;
            matrices[matOffset + 10] *= scale;
        }
    }
}

// =============================================================================
// SIMD-OPTIMIZED DISTANCE CALCULATION
// =============================================================================
// Process 4 objects at once for distance calculation

EMSCRIPTEN_KEEPALIVE
void batchDistanceCullLOD_c(
    float* positions,  // [x, y, z, radius, x, y, z, radius, ...]
    int count,
    float cameraX,
    float cameraY,
    float cameraZ,
    float maxDistSq,
    int* results       // 0 = culled, 1 = visible
) {
    int i = 0;
    int count4 = count & ~3;
    
    v128_t v_camX = wasm_f32x4_splat(cameraX);
    v128_t v_camY = wasm_f32x4_splat(cameraY);
    v128_t v_camZ = wasm_f32x4_splat(cameraZ);
    v128_t v_maxDistSq = wasm_f32x4_splat(maxDistSq);
    
    for (; i < count4; i += 4) {
        // Load 4 positions
        v128_t v_x = wasm_f32x4_make(
            positions[i * 4],
            positions[(i+1) * 4],
            positions[(i+2) * 4],
            positions[(i+3) * 4]
        );
        v128_t v_y = wasm_f32x4_make(
            positions[i * 4 + 1],
            positions[(i+1) * 4 + 1],
            positions[(i+2) * 4 + 1],
            positions[(i+3) * 4 + 1]
        );
        v128_t v_z = wasm_f32x4_make(
            positions[i * 4 + 2],
            positions[(i+1) * 4 + 2],
            positions[(i+2) * 4 + 2],
            positions[(i+3) * 4 + 2]
        );
        
        // Calculate distance squared
        v128_t v_dx = wasm_f32x4_sub(v_x, v_camX);
        v128_t v_dy = wasm_f32x4_sub(v_y, v_camY);
        v128_t v_dz = wasm_f32x4_sub(v_z, v_camZ);
        
        v128_t v_distSq = wasm_f32x4_add(
            wasm_f32x4_add(
                wasm_f32x4_mul(v_dx, v_dx),
                wasm_f32x4_mul(v_dy, v_dy)
            ),
            wasm_f32x4_mul(v_dz, v_dz)
        );
        
        // Compare with max distance
        v128_t v_visible = wasm_f32x4_lt(v_distSq, v_maxDistSq);
        
        // Store results
        results[i] = wasm_f32x4_extract_lane(v_visible, 0) ? 1 : 0;
        results[i+1] = wasm_f32x4_extract_lane(v_visible, 1) ? 1 : 0;
        results[i+2] = wasm_f32x4_extract_lane(v_visible, 2) ? 1 : 0;
        results[i+3] = wasm_f32x4_extract_lane(v_visible, 3) ? 1 : 0;
    }
    
    // Tail loop
    for (; i < count; i++) {
        float dx = positions[i * 4] - cameraX;
        float dy = positions[i * 4 + 1] - cameraY;
        float dz = positions[i * 4 + 2] - cameraZ;
        float distSq = dx * dx + dy * dy + dz * dz;
        
        results[i] = distSq < maxDistSq ? 1 : 0;
    }
}

// =============================================================================
// MATRIX TRANSFORMATION HELPERS
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void batchScaleMatrices_c(
    float* matrices,
    int count,
    float scaleX,
    float scaleY,
    float scaleZ
) {
    #pragma omp parallel for schedule(static) if(count > 100)
    for (int i = 0; i < count; i++) {
        int offset = i * 16;
        matrices[offset + 0] *= scaleX;   // m00
        matrices[offset + 5] *= scaleY;   // m11
        matrices[offset + 10] *= scaleZ;  // m22
    }
}

EMSCRIPTEN_KEEPALIVE
void batchTranslateMatrices_c(
    float* matrices,
    int count,
    float tx,
    float ty,
    float tz
) {
    #pragma omp parallel for schedule(static) if(count > 100)
    for (int i = 0; i < count; i++) {
        int offset = i * 16;
        matrices[offset + 12] += tx;
        matrices[offset + 13] += ty;
        matrices[offset + 14] += tz;
    }
}

// =============================================================================
// COLOR PROCESSING
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void batchFadeColors_c(
    float* colors,  // [r, g, b, r, g, b, ...]
    int count,
    float fadeAmount  // 0.0 = fully faded, 1.0 = original
) {
    int i = 0;
    int count4 = count & ~3;
    
    v128_t v_fade = wasm_f32x4_splat(fadeAmount);
    
    // Process 4 colors (12 floats) at a time
    for (; i < count4; i += 4) {
        v128_t v_r = wasm_f32x4_make(
            colors[i * 3],
            colors[(i+1) * 3],
            colors[(i+2) * 3],
            colors[(i+3) * 3]
        );
        v128_t v_g = wasm_f32x4_make(
            colors[i * 3 + 1],
            colors[(i+1) * 3 + 1],
            colors[(i+2) * 3 + 1],
            colors[(i+3) * 3 + 1]
        );
        v128_t v_b = wasm_f32x4_make(
            colors[i * 3 + 2],
            colors[(i+1) * 3 + 2],
            colors[(i+2) * 3 + 2],
            colors[(i+3) * 3 + 2]
        );
        
        v_r = wasm_f32x4_mul(v_r, v_fade);
        v_g = wasm_f32x4_mul(v_g, v_fade);
        v_b = wasm_f32x4_mul(v_b, v_fade);
        
        colors[i * 3] = wasm_f32x4_extract_lane(v_r, 0);
        colors[(i+1) * 3] = wasm_f32x4_extract_lane(v_r, 1);
        colors[(i+2) * 3] = wasm_f32x4_extract_lane(v_r, 2);
        colors[(i+3) * 3] = wasm_f32x4_extract_lane(v_r, 3);
        
        colors[i * 3 + 1] = wasm_f32x4_extract_lane(v_g, 0);
        colors[(i+1) * 3 + 1] = wasm_f32x4_extract_lane(v_g, 1);
        colors[(i+2) * 3 + 1] = wasm_f32x4_extract_lane(v_g, 2);
        colors[(i+3) * 3 + 1] = wasm_f32x4_extract_lane(v_g, 3);
        
        colors[i * 3 + 2] = wasm_f32x4_extract_lane(v_b, 0);
        colors[(i+1) * 3 + 2] = wasm_f32x4_extract_lane(v_b, 1);
        colors[(i+2) * 3 + 2] = wasm_f32x4_extract_lane(v_b, 2);
        colors[(i+3) * 3 + 2] = wasm_f32x4_extract_lane(v_b, 3);
    }
    
    // Tail loop
    for (; i < count; i++) {
        colors[i * 3] *= fadeAmount;
        colors[i * 3 + 1] *= fadeAmount;
        colors[i * 3 + 2] *= fadeAmount;
    }
}

} // extern "C"
