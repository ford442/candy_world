/**
 * @file batcher_instance.cpp
 * @brief Focused C++ export for instanced-batcher pose → matrix/color writes (#1358)
 *
 * 15% slice: one kernel that composes column-major instance matrices from packed
 * TRS pose SoA and optionally writes instance RGB colors. PlantPoseMachine stays
 * in TypeScript; this only covers the array-write hot path after pose update.
 *
 * ABI (all float32, little-endian):
 *   positions:    [x,y,z, ...]           stride 3, length count*3
 *   quaternions:  [x,y,z,w, ...]         stride 4, length count*4
 *   scales:       [sx,sy,sz, ...]        stride 3, length count*3
 *   colorsIn:     [r,g,b, ...]           stride 3, length count*3 (nullable)
 *   matricesOut:  column-major 4x4       stride 16, length count*16
 *   colorsOut:    [r,g,b, ...]           stride 3 (nullable; skipped if null)
 *   colorIntensity: uniform scale applied to each RGB channel
 *
 * Matrix math matches lod_batch.cpp batchComposeMatrices_c and the arpeggio
 * TypeScript fallback (Three.js column-major layout).
 */

#include <emscripten.h>
#include <cmath>

extern "C" {

/**
 * Compose TRS → instance matrices and optionally write instance colors in-place.
 * When colorsIn or colorsOut is null, color writes are skipped (matrix-only).
 */
EMSCRIPTEN_KEEPALIVE
void batchWriteInstancePose_c(
    const float* positions,
    const float* quaternions,
    const float* scales,
    const float* colorsIn,
    float* matricesOut,
    float* colorsOut,
    float colorIntensity,
    int count
) {
    if (count <= 0 || !positions || !quaternions || !scales || !matricesOut) {
        return;
    }

    const bool writeColors = (colorsIn != nullptr && colorsOut != nullptr);

    #pragma omp parallel for schedule(static) if(count > 100)
    for (int i = 0; i < count; i++) {
        const int v3 = i * 3;
        const int q = i * 4;
        const int m = i * 16;

        const float px = positions[v3];
        const float py = positions[v3 + 1];
        const float pz = positions[v3 + 2];

        const float qx = quaternions[q];
        const float qy = quaternions[q + 1];
        const float qz = quaternions[q + 2];
        const float qw = quaternions[q + 3];

        const float sx = scales[v3];
        const float sy = scales[v3 + 1];
        const float sz = scales[v3 + 2];

        const float x2 = qx + qx;
        const float y2 = qy + qy;
        const float z2 = qz + qz;
        const float xx = qx * x2;
        const float xy = qx * y2;
        const float xz = qx * z2;
        const float yy = qy * y2;
        const float yz = qy * z2;
        const float zz = qz * z2;
        const float wx = qw * x2;
        const float wy = qw * y2;
        const float wz = qw * z2;

        matricesOut[m + 0]  = (1.0f - (yy + zz)) * sx;
        matricesOut[m + 1]  = (xy + wz) * sx;
        matricesOut[m + 2]  = (xz - wy) * sx;
        matricesOut[m + 3]  = 0.0f;

        matricesOut[m + 4]  = (xy - wz) * sy;
        matricesOut[m + 5]  = (1.0f - (xx + zz)) * sy;
        matricesOut[m + 6]  = (yz + wx) * sy;
        matricesOut[m + 7]  = 0.0f;

        matricesOut[m + 8]  = (xz + wy) * sz;
        matricesOut[m + 9]  = (yz - wx) * sz;
        matricesOut[m + 10] = (1.0f - (xx + yy)) * sz;
        matricesOut[m + 11] = 0.0f;

        matricesOut[m + 12] = px;
        matricesOut[m + 13] = py;
        matricesOut[m + 14] = pz;
        matricesOut[m + 15] = 1.0f;

        if (writeColors) {
            colorsOut[v3]     = colorsIn[v3] * colorIntensity;
            colorsOut[v3 + 1] = colorsIn[v3 + 1] * colorIntensity;
            colorsOut[v3 + 2] = colorsIn[v3 + 2] * colorIntensity;
        }
    }
}

} // extern "C"
