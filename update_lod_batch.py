import re

with open('emscripten/lod_batch.cpp', 'r') as f:
    content = f.read()

new_func = """
static float smoothstep_local(float t) {
    float x = t < 0.0f ? 0.0f : (t > 1.0f ? 1.0f : t);
    return x * x * (3.0f - 2.0f * x);
}

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
"""

with open('emscripten/lod_batch.cpp', 'w') as f:
    f.write(content.replace('extern "C" {\n', 'extern "C" {\n\n' + new_func))
