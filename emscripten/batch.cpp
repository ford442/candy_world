#include <emscripten.h>
#include <cmath>
#include "omp.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE
int batchDistanceCull_c(float* positions, float* flags, int count, float refX, float refY, float refZ, float maxDistSq) {
    int visibleCount = 0;
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int idx = i * 3;
        float dx = positions[idx] - refX;
        float dy = positions[idx + 1] - refY;
        float dz = positions[idx + 2] - refZ;
        float distSq = dx * dx + dy * dy + dz * dz;
        if (distSq <= maxDistSq) {
            flags[i] = 1.0f;
        } else {
            flags[i] = 0.0f;
        }
    }
    // Count visible in a separate pass to avoid reduction
    for (int i = 0; i < count; i++) {
        if (flags[i] > 0.5f) visibleCount++;
    }
    return visibleCount;
}

} // extern "C"
