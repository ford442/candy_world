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


static float smoothstep_local(float t) {
    float x = t < 0.0f ? 0.0f : (t > 1.0f ? 1.0f : t);
    return x * x * (3.0f - 2.0f * x);
}

// Note: This function uses OpenMP for parallelization but is scalar, not SIMD vectorized.
EMSCRIPTEN_KEEPALIVE
void batchUpdateLodFactors_c(
    float* matrices,
    float* smoothed,
    int count,
    float cameraX,
    float cameraY,
    float cameraZ,
    float heroMax,
    float midMax,
    float blendWidth,
    float farCullSq,
    float blendT,
    int* statsOut // Array of 6 ints: [hero, mid, far, culled, blendBand, total]
) {
    float bw = blendWidth < 1.0f ? 1.0f : blendWidth;
    float heroMin = heroMax - bw;
    float heroMaxRange = heroMax + bw;
    float heroMinSq = heroMin * heroMin;
    float heroMaxRangeSq = heroMaxRange * heroMaxRange;

    float midMin = midMax - bw;
    float midMaxRange = midMax + bw;
    float midMinSq = midMin * midMin;
    float midMaxRangeSq = midMaxRange * midMaxRange;

    int hero = 0;
    int mid = 0;
    int far = 0;
    int culled = 0;
    int blendBand = 0;
    int total = count;

    #pragma omp parallel for schedule(static) if(count > 100) reduction(+:hero, mid, far, culled, blendBand)
    for (int i = 0; i < count; i++) {
        int matOffset = i * 16;
        float posX = matrices[matOffset + 12];
        float posY = matrices[matOffset + 13];
        float posZ = matrices[matOffset + 14];

        float dx = posX - cameraX;
        float dy = posY - cameraY;
        float dz = posZ - cameraZ;
        float distSq = dx * dx + dy * dy + dz * dz;

        float target = 3.0f; // Default culled

        if (distSq < farCullSq) {
            if (heroMin >= 0.0f && distSq <= heroMinSq) {
                target = 0.0f;
            } else if (distSq <= heroMaxRangeSq) {
                float dist = std::sqrt(distSq);
                float t = (dist - heroMin) / (2.0f * bw);
                target = smoothstep_local(t);
            } else if (midMin >= 0.0f && distSq <= midMinSq) {
                target = 1.0f;
            } else if (distSq <= midMaxRangeSq) {
                float dist = std::sqrt(distSq);
                float t = (dist - midMin) / (2.0f * bw);
                target = 1.0f + smoothstep_local(t);
            } else {
                target = 2.0f;
            }
        }

        float current = smoothed[i];
        float diff = std::abs(target - current);

        if (diff > 1e-3f) {
            smoothed[i] = current + (target - current) * blendT;
        } else if (current != target) {
            smoothed[i] = target;
        }

        float factor = smoothed[i];

        // Accumulate stats
        if (factor >= 3.0f) {
            culled++;
        } else if (factor > 0.75f && factor < 1.15f) {
             blendBand++;
             mid++;
        } else if (factor > 1.45f && factor < 2.15f) {
             blendBand++;
             far++;
        } else if (factor >= 1.55f) {
            far++;
        } else if (factor >= 0.85f) {
            mid++;
        } else {
            hero++;
        }
    }

    if (statsOut) {
        statsOut[0] = hero;
        statsOut[1] = mid;
        statsOut[2] = far;
        statsOut[3] = culled;
        statsOut[4] = blendBand;
        statsOut[5] = total;
    }
}

// =============================================================================
// MATRIX COMPOSITION
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void batchComposeMatrices_c(
    float* positions,   // [x, y, z, ...]
    float* quaternions, // [x, y, z, w, ...]
    float* scales,      // [x, y, z, ...] (or scalar if size is 1 per instance, but let's assume vec3 for generality)
    float* matrices,    // [m00...m33, ...] (16 floats per instance)
    int count
) {
    #pragma omp parallel for schedule(static) if(count > 100)
    for (int i = 0; i < count; i++) {
        int v3_idx = i * 3;
        int q_idx = i * 4;
        int m_idx = i * 16;

        float px = positions[v3_idx];
        float py = positions[v3_idx + 1];
        float pz = positions[v3_idx + 2];

        float qx = quaternions[q_idx];
        float qy = quaternions[q_idx + 1];
        float qz = quaternions[q_idx + 2];
        float qw = quaternions[q_idx + 3];

        float sx = scales[v3_idx];
        float sy = scales[v3_idx + 1];
        float sz = scales[v3_idx + 2];

        float x2 = qx + qx;
        float y2 = qy + qy;
        float z2 = qz + qz;
        float xx = qx * x2;
        float xy = qx * y2;
        float xz = qx * z2;
        float yy = qy * y2;
        float yz = qy * z2;
        float zz = qz * z2;
        float wx = qw * x2;
        float wy = qw * y2;
        float wz = qw * z2;

        matrices[m_idx + 0] = (1.0f - (yy + zz)) * sx;
        matrices[m_idx + 1] = (xy + wz) * sx;
        matrices[m_idx + 2] = (xz - wy) * sx;
        matrices[m_idx + 3] = 0.0f;

        matrices[m_idx + 4] = (xy - wz) * sy;
        matrices[m_idx + 5] = (1.0f - (xx + zz)) * sy;
        matrices[m_idx + 6] = (yz + wx) * sy;
        matrices[m_idx + 7] = 0.0f;

        matrices[m_idx + 8] = (xz + wy) * sz;
        matrices[m_idx + 9] = (yz - wx) * sz;
        matrices[m_idx + 10] = (1.0f - (xx + yy)) * sz;
        matrices[m_idx + 11] = 0.0f;

        matrices[m_idx + 12] = px;
        matrices[m_idx + 13] = py;
        matrices[m_idx + 14] = pz;
        matrices[m_idx + 15] = 1.0f;
    }
}

} // extern "C"
