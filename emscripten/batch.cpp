#include <emscripten.h>
#include <cmath>
#include <cstdlib>
#include "omp.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE
void batchDistances(float* positions, float* results, int count, float refX, float refY, float refZ) {
    #pragma omp parallel for if(count > 1000)
    for (int i = 0; i < count; i++) {
        int idx = i * 3;
        float dx = positions[idx] - refX;
        float dy = positions[idx + 1] - refY;
        float dz = positions[idx + 2] - refZ;
        results[i] = sqrtf(dx * dx + dy * dy + dz * dz);
    }
}

EMSCRIPTEN_KEEPALIVE
int batchDistanceCull_c(float* positions, float* flags, int count, float refX, float refY, float refZ, float maxDistSq) {
    int visibleCount = 0;
    #pragma omp parallel for reduction(+:visibleCount) if(count > 1000)
    for (int i = 0; i < count; i++) {
        int idx = i * 3;
        float dx = positions[idx] - refX;
        float dy = positions[idx + 1] - refY;
        float dz = positions[idx + 2] - refZ;
        float distSq = dx * dx + dy * dy + dz * dz;
        if (distSq <= maxDistSq) {
            flags[i] = 1.0f;
            visibleCount++;
        } else {
            flags[i] = 0.0f;
        }
    }
    return visibleCount;
}

EMSCRIPTEN_KEEPALIVE
void batchSinWave(float* yPositions, float* baseY, int count, float time, float frequency, float amplitude) {
    #pragma omp parallel for if(count > 1000)
    for (int i = 0; i < count; i++) {
        float offset = (float)i * 0.1f;
        yPositions[i] = baseY[i] + sinf((time + offset) * frequency) * amplitude;
    }
}

// =============================================================================
// NEW BATCH ANIMATION FUNCTIONS
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void batchCalcFiberWhip(float* baseRotY, float* branchRotZ, int count, float time, float* offsets, float leadVol, int* isActive, int* branchIndices) {
    #pragma omp parallel for if(count > 1000)
    for (int i = 0; i < count; i++) {
        baseRotY[i] = sinf(time * 0.5f + offsets[i]) * 0.1f;

        float whip = leadVol * 2.0f;
        float childOffset = (float)branchIndices[i] * 0.5f;

        float rotZ = 0.785f + sinf(time * 2.0f + childOffset) * 0.1f;

        if (isActive[i]) {
            rotZ += sinf(time * 10.0f + childOffset) * whip;
        }
        branchRotZ[i] = rotZ;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchCalcSpiralWave(float* rotY, float* yOffset, float* scale, int count, float time, float* offsets, float intensity, float groove) {
    #pragma omp parallel for if(count > 1000)
    for (int i = 0; i < count; i++) {
        float animTime = time + offsets[i];
        rotY[i] = sinf(animTime * 2.0f) * 0.2f * intensity;
        yOffset[i] = sinf(animTime * 3.0f) * 0.1f * (1.0f + groove);
        scale[i] = 1.0f + sinf(animTime * 4.0f) * 0.05f * intensity;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchCalcWobble(float* rotX, float* rotZ, int count, float time, float* offsets, float intensity) {
    #pragma omp parallel for if(count > 1000)
    for (int i = 0; i < count; i++) {
        float animTime = time + offsets[i];
        rotX[i] = sinf(animTime * 3.0f) * 0.15f * intensity;
        rotZ[i] = cosf(animTime * 3.0f) * 0.15f * intensity;
    }
}

}
