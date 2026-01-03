#include <emscripten.h>
#include <cmath>
#include <cstdlib>
#include "./omp.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE
void batchDistances(float* positions, float* results, int count, float refX, float refY, float refZ) {
    #pragma omp parallel for simd if(count > 1000)
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
    #pragma omp parallel for simd reduction(+:visibleCount) if(count > 1000)
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
    #pragma omp parallel for simd if(count > 1000)
    for (int i = 0; i < count; i++) {
        float offset = (float)i * 0.1f;
        yPositions[i] = baseY[i] + sinf((time + offset) * frequency) * amplitude;
    }
}

}
