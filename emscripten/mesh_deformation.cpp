/**
 * @file mesh_deformation.cpp
 * @brief Mesh deformation for Candy World - C++/Emscripten
 * 
 * Provides vertex deformation functions for wave, jiggle, and wobble effects.
 * 
 * @perf-migrate {target: "cpp", reason: "vertex-processing", note: "2-3x speedup for deformable meshes"}
 */

#include <emscripten.h>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include "omp.h"

extern "C" {

// =============================================================================
// WAVE DEFORMATION
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void deformMeshWave(
    float* positions,
    const float* originalPositions,
    int count,
    float time,
    float frequency,
    float strength,
    float audioPulse
) {
    const float time2 = time * 2.0f;
    const float effectiveStrength = strength * (1.0f + audioPulse * 0.5f);
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        float x = originalPositions[i * 3];
        float z = originalPositions[i * 3 + 2];
        float y = originalPositions[i * 3 + 1];
        
        float wave = sinf(x * frequency + time2) * cosf(z * frequency + time2);
        positions[i * 3 + 1] = y + wave * effectiveStrength;
    }
}

// =============================================================================
// JIGGLE DEFORMATION (Good for mushrooms)
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void deformMeshJiggle(
    float* positions,
    const float* originalPositions,
    int count,
    float time,
    float strength,
    float audioPulse
) {
    const float time5 = time * 5.0f;
    const float effectiveStrength = strength * 0.1f * (1.0f + audioPulse);
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        float x = originalPositions[i * 3];
        float y = originalPositions[i * 3 + 1];
        float z = originalPositions[i * 3 + 2];
        
        float phase = time5 + y * 2.0f;
        float offset = sinf(phase) * effectiveStrength;
        
        positions[i * 3 + 0] = x + offset;
        positions[i * 3 + 2] = z + offset * cosf(phase);
    }
}

// =============================================================================
// WOBBLE DEFORMATION (Good for trees)
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void deformMeshWobble(
    float* positions,
    const float* originalPositions,
    int count,
    float time,
    float strength,
    float audioPulse
) {
    const float time2 = time * 2.0f;
    const float baseStrength = strength * 0.05f;
    const float audioScale = 1.0f + audioPulse * 0.3f;
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        float x = originalPositions[i * 3];
        float y = originalPositions[i * 3 + 1];
        float z = originalPositions[i * 3 + 2];
        
        float wobble = sinf(time2 + y * 0.5f) * baseStrength;
        float heightFactor = y / 5.0f;
        
        positions[i * 3 + 0] = x + wobble * heightFactor * audioScale;
    }
}

// =============================================================================
// NORMAL RECOMPUTATION
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void recomputeNormals(
    const float* positions,
    float* normals,
    const uint16_t* indices,
    int indexCount
) {
    int vertexCount = indexCount;
    
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < vertexCount * 3; i++) {
        normals[i] = 0.0f;
    }
    
    for (int i = 0; i < indexCount; i += 3) {
        uint16_t i0 = indices[i];
        uint16_t i1 = indices[i + 1];
        uint16_t i2 = indices[i + 2];
        
        float x0 = positions[i0 * 3];
        float y0 = positions[i0 * 3 + 1];
        float z0 = positions[i0 * 3 + 2];
        
        float x1 = positions[i1 * 3];
        float y1 = positions[i1 * 3 + 1];
        float z1 = positions[i1 * 3 + 2];
        
        float x2 = positions[i2 * 3];
        float y2 = positions[i2 * 3 + 1];
        float z2 = positions[i2 * 3 + 2];
        
        float ex1 = x1 - x0;
        float ey1 = y1 - y0;
        float ez1 = z1 - z0;
        
        float ex2 = x2 - x0;
        float ey2 = y2 - y0;
        float ez2 = z2 - z0;
        
        float nx = ey1 * ez2 - ez1 * ey2;
        float ny = ez1 * ex2 - ex1 * ez2;
        float nz = ex1 * ey2 - ey1 * ex2;
        
        normals[i0 * 3] += nx;
        normals[i0 * 3 + 1] += ny;
        normals[i0 * 3 + 2] += nz;
        
        normals[i1 * 3] += nx;
        normals[i1 * 3 + 1] += ny;
        normals[i1 * 3 + 2] += nz;
        
        normals[i2 * 3] += nx;
        normals[i2 * 3 + 1] += ny;
        normals[i2 * 3 + 2] += nz;
    }
    
    #pragma omp parallel for schedule(static) if(vertexCount > 500)
    for (int i = 0; i < vertexCount; i++) {
        float nx = normals[i * 3];
        float ny = normals[i * 3 + 1];
        float nz = normals[i * 3 + 2];
        
        float len = sqrtf(nx * nx + ny * ny + nz * nz);
        if (len > 0.0001f) {
            float invLen = 1.0f / len;
            normals[i * 3] *= invLen;
            normals[i * 3 + 1] *= invLen;
            normals[i * 3 + 2] *= invLen;
        }
    }
}

// =============================================================================
// BATCH DEFORMATION
// =============================================================================

struct MeshDeformData {
    float* positions;
    const float* originals;
    int vertexCount;
    float time;
    float strength;
    float audioPulse;
    int deformType;
    float param1;
};

EMSCRIPTEN_KEEPALIVE
void batchDeformMeshes(MeshDeformData* meshes, int meshCount) {
    #pragma omp parallel for schedule(dynamic, 1)
    for (int m = 0; m < meshCount; m++) {
        MeshDeformData& mesh = meshes[m];
        
        switch (mesh.deformType) {
            case 0:
                deformMeshWave(
                    mesh.positions, mesh.originals, mesh.vertexCount,
                    mesh.time, mesh.param1, mesh.strength, mesh.audioPulse
                );
                break;
            case 1:
                deformMeshJiggle(
                    mesh.positions, mesh.originals, mesh.vertexCount,
                    mesh.time, mesh.strength, mesh.audioPulse
                );
                break;
            case 2:
                deformMeshWobble(
                    mesh.positions, mesh.originals, mesh.vertexCount,
                    mesh.time, mesh.strength, mesh.audioPulse
                );
                break;
        }
    }
}

// =============================================================================
// SIMD-OPTIMIZED BATCH DEFORMATION FUNCTIONS (Agent 2)
// Migrated from mesh_deformation.ts for 4x vertex processing
// =============================================================================

#include <wasm_simd128.h>

// Fast approximate sine for SIMD (same as animation_batch.cpp)
inline v128_t fast_sin_simd(v128_t x) {
    v128_t pi = wasm_f32x4_splat(3.14159265358979323846f);
    v128_t inv_two_pi = wasm_f32x4_splat(0.15915494309189533576f);
    v128_t two_pi = wasm_f32x4_splat(6.28318530717958647692f);

    v128_t y = wasm_f32x4_mul(x, inv_two_pi);
    v128_t z = wasm_f32x4_nearest(y);
    x = wasm_f32x4_sub(x, wasm_f32x4_mul(z, two_pi));

    v128_t cmp_pi = wasm_f32x4_gt(x, pi);
    x = wasm_v128_bitselect(wasm_f32x4_sub(x, two_pi), x, cmp_pi);

    v128_t neg_pi = wasm_f32x4_splat(-3.14159265358979323846f);
    v128_t cmp_neg_pi = wasm_f32x4_lt(x, neg_pi);
    x = wasm_v128_bitselect(wasm_f32x4_add(x, two_pi), x, cmp_neg_pi);

    v128_t x2 = wasm_f32x4_mul(x, x);
    v128_t x3 = wasm_f32x4_mul(x2, x);
    v128_t x5 = wasm_f32x4_mul(x3, x2);
    v128_t x7 = wasm_f32x4_mul(x5, x2);

    v128_t c1 = x;
    v128_t c3 = wasm_f32x4_mul(x3, wasm_f32x4_splat(-0.16666666666666666667f));
    v128_t c5 = wasm_f32x4_mul(x5, wasm_f32x4_splat(0.00833333333333333333f));
    v128_t c7 = wasm_f32x4_mul(x7, wasm_f32x4_splat(-0.00019841269841269841f));

    v128_t res = wasm_f32x4_add(c1, c3);
    res = wasm_f32x4_add(res, c5);
    res = wasm_f32x4_add(res, c7);

    return res;
}

EMSCRIPTEN_KEEPALIVE
void deformWave_c(float* positions, int count, float time, float strength, float frequency) {
    int i = 0;
    int count4 = count & ~3;
    
    v128_t v_time2 = wasm_f32x4_splat(time * 2.0f);
    v128_t v_freq = wasm_f32x4_splat(frequency);
    v128_t v_strength = wasm_f32x4_splat(strength);
    
    for (; i < count4; i += 4) {
        // Load 4 x positions
        v128_t v_x = wasm_f32x4_make(
            positions[i * 3],
            positions[(i+1) * 3],
            positions[(i+2) * 3],
            positions[(i+3) * 3]
        );
        
        // Load 4 z positions
        v128_t v_z = wasm_f32x4_make(
            positions[i * 3 + 2],
            positions[(i+1) * 3 + 2],
            positions[(i+2) * 3 + 2],
            positions[(i+3) * 3 + 2]
        );
        
        // Load 4 y positions
        v128_t v_y = wasm_f32x4_make(
            positions[i * 3 + 1],
            positions[(i+1) * 3 + 1],
            positions[(i+2) * 3 + 1],
            positions[(i+3) * 3 + 1]
        );
        
        // wave = sin(x * freq + time2) * cos(z * freq + time2)
        v128_t v_xArg = wasm_f32x4_add(wasm_f32x4_mul(v_x, v_freq), v_time2);
        v128_t v_zArg = wasm_f32x4_add(wasm_f32x4_mul(v_z, v_freq), v_time2);
        
        v128_t v_sinX = fast_sin_simd(v_xArg);
        v128_t v_cosZ = fast_sin_simd(wasm_f32x4_add(v_zArg, wasm_f32x4_splat(1.57079632679f))); // cos = sin(x + pi/2)
        
        v128_t v_wave = wasm_f32x4_mul(v_sinX, v_cosZ);
        v128_t v_newY = wasm_f32x4_add(v_y, wasm_f32x4_mul(v_wave, v_strength));
        
        // Store results
        positions[i * 3 + 1] = wasm_f32x4_extract_lane(v_newY, 0);
        positions[(i+1) * 3 + 1] = wasm_f32x4_extract_lane(v_newY, 1);
        positions[(i+2) * 3 + 1] = wasm_f32x4_extract_lane(v_newY, 2);
        positions[(i+3) * 3 + 1] = wasm_f32x4_extract_lane(v_newY, 3);
    }
    
    // Tail loop
    for (; i < count; i++) {
        float x = positions[i * 3];
        float z = positions[i * 3 + 2];
        float y = positions[i * 3 + 1];
        
        float wave = sinf(x * frequency + time * 2.0f) * cosf(z * frequency + time * 2.0f);
        positions[i * 3 + 1] = y + wave * strength;
    }
}

EMSCRIPTEN_KEEPALIVE
void deformJiggle_c(float* positions, int count, float time, float strength, float audioPulse) {
    int i = 0;
    int count4 = count & ~3;
    
    v128_t v_time5 = wasm_f32x4_splat(time * 5.0f);
    v128_t v_strength = wasm_f32x4_splat(strength * 0.1f * (1.0f + audioPulse));
    v128_t v_y_mult = wasm_f32x4_splat(2.0f);
    
    for (; i < count4; i += 4) {
        // Load positions
        v128_t v_x = wasm_f32x4_make(
            positions[i * 3], positions[(i+1) * 3], positions[(i+2) * 3], positions[(i+3) * 3]
        );
        v128_t v_y = wasm_f32x4_make(
            positions[i * 3 + 1], positions[(i+1) * 3 + 1], positions[(i+2) * 3 + 1], positions[(i+3) * 3 + 1]
        );
        v128_t v_z = wasm_f32x4_make(
            positions[i * 3 + 2], positions[(i+1) * 3 + 2], positions[(i+2) * 3 + 2], positions[(i+3) * 3 + 2]
        );
        
        // offset = sin(time5 + y * 2) * strength
        v128_t v_phase = wasm_f32x4_add(v_time5, wasm_f32x4_mul(v_y, v_y_mult));
        v128_t v_offset = wasm_f32x4_mul(fast_sin_simd(v_phase), v_strength);
        
        // positions[i] = x + offset
        // positions[i+2] = z + offset * cos(phase)
        v128_t v_cosPhase = fast_sin_simd(wasm_f32x4_add(v_phase, wasm_f32x4_splat(1.57079632679f)));
        
        v128_t v_newX = wasm_f32x4_add(v_x, v_offset);
        v128_t v_newZ = wasm_f32x4_add(v_z, wasm_f32x4_mul(v_offset, v_cosPhase));
        
        // Store
        positions[i * 3] = wasm_f32x4_extract_lane(v_newX, 0);
        positions[(i+1) * 3] = wasm_f32x4_extract_lane(v_newX, 1);
        positions[(i+2) * 3] = wasm_f32x4_extract_lane(v_newX, 2);
        positions[(i+3) * 3] = wasm_f32x4_extract_lane(v_newX, 3);
        
        positions[i * 3 + 2] = wasm_f32x4_extract_lane(v_newZ, 0);
        positions[(i+1) * 3 + 2] = wasm_f32x4_extract_lane(v_newZ, 1);
        positions[(i+2) * 3 + 2] = wasm_f32x4_extract_lane(v_newZ, 2);
        positions[(i+3) * 3 + 2] = wasm_f32x4_extract_lane(v_newZ, 3);
    }
    
    // Tail loop
    for (; i < count; i++) {
        float x = positions[i * 3];
        float y = positions[i * 3 + 1];
        float z = positions[i * 3 + 2];
        
        float phase = time * 5.0f + y * 2.0f;
        float offset = sinf(phase) * strength * 0.1f * (1.0f + audioPulse);
        
        positions[i * 3] = x + offset;
        positions[i * 3 + 2] = z + offset * cosf(phase);
    }
}

EMSCRIPTEN_KEEPALIVE
void deformWobble_c(float* positions, int count, float time, float strength, float audioPulse) {
    int i = 0;
    int count4 = count & ~3;
    
    v128_t v_time2 = wasm_f32x4_splat(time * 2.0f);
    v128_t v_strength = wasm_f32x4_splat(strength * 0.05f);
    v128_t v_audioScale = wasm_f32x4_splat(1.0f + audioPulse * 0.3f);
    v128_t v_y_div = wasm_f32x4_splat(5.0f);
    v128_t v_y_mult = wasm_f32x4_splat(0.5f);
    
    for (; i < count4; i += 4) {
        // Load positions
        v128_t v_x = wasm_f32x4_make(
            positions[i * 3], positions[(i+1) * 3], positions[(i+2) * 3], positions[(i+3) * 3]
        );
        v128_t v_y = wasm_f32x4_make(
            positions[i * 3 + 1], positions[(i+1) * 3 + 1], positions[(i+2) * 3 + 1], positions[(i+3) * 3 + 1]
        );
        
        // wobble = sin(time2 + y * 0.5) * strength * (y / 5) * audioScale
        v128_t v_wobbleArg = wasm_f32x4_add(v_time2, wasm_f32x4_mul(v_y, v_y_mult));
        v128_t v_wobble = wasm_f32x4_mul(fast_sin_simd(v_wobbleArg), v_strength);
        v128_t v_heightFactor = wasm_f32x4_div(v_y, v_y_div);
        
        v_wobble = wasm_f32x4_mul(v_wobble, v_heightFactor);
        v_wobble = wasm_f32x4_mul(v_wobble, v_audioScale);
        
        v128_t v_newX = wasm_f32x4_add(v_x, v_wobble);
        
        // Store
        positions[i * 3] = wasm_f32x4_extract_lane(v_newX, 0);
        positions[(i+1) * 3] = wasm_f32x4_extract_lane(v_newX, 1);
        positions[(i+2) * 3] = wasm_f32x4_extract_lane(v_newX, 2);
        positions[(i+3) * 3] = wasm_f32x4_extract_lane(v_newX, 3);
    }
    
    // Tail loop
    for (; i < count; i++) {
        float x = positions[i * 3];
        float y = positions[i * 3 + 1];
        
        float wobble = sinf(time * 2.0f + y * 0.5f) * strength * 0.05f;
        float heightFactor = y / 5.0f;
        
        positions[i * 3] = x + wobble * heightFactor * (1.0f + audioPulse * 0.3f);
    }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int getDeformBatchSize() {
    return 1024;
}

EMSCRIPTEN_KEEPALIVE
int hasSIMDSupport() {
    return 1;
}

}
