// candy_native.c
#include <emscripten.h>
#include <math.h>
#include <stdlib.h>

// =============================================================================
// NOISE FUNCTIONS
// =============================================================================

EMSCRIPTEN_KEEPALIVE
float hash(float x, float y) {
    int ix = (int)(x * 1000);
    int iy = (int)(y * 1000);
    int n = ix + iy * 57;
    n = (n << 13) ^ n;
    return (1.0f - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0f);
}

static float lerp(float a, float b, float t) {
    return a + (b - a) * t;
}

static float smoothstep(float t) {
    return t * t * (3.0f - 2.0f * t);
}

EMSCRIPTEN_KEEPALIVE
float valueNoise2D(float x, float y) {
    float ix = floorf(x);
    float iy = floorf(y);
    float fx = x - ix;
    float fy = y - iy;
    fx = smoothstep(fx);
    fy = smoothstep(fy);
    float v00 = hash(ix, iy);
    float v10 = hash(ix + 1, iy);
    float v01 = hash(ix, iy + 1);
    float v11 = hash(ix + 1, iy + 1);
    float v0 = lerp(v00, v10, fx);
    float v1 = lerp(v01, v11, fx);
    return lerp(v0, v1, fy);
}

EMSCRIPTEN_KEEPALIVE
float fbm(float x, float y, int octaves) {
    float value = 0.0f;
    float amplitude = 0.5f;
    float frequency = 1.0f;
    for (int i = 0; i < octaves; i++) {
        value += amplitude * valueNoise2D(x * frequency, y * frequency);
        amplitude *= 0.5f;
        frequency *= 2.0f;
    }
    return value;
}

// =============================================================================
// PHYSICS & MATH
// =============================================================================

EMSCRIPTEN_KEEPALIVE
float fastInvSqrt(float x) {
    float xhalf = 0.5f * x;
    int i = *(int*)&x;
    i = 0x5f3759df - (i >> 1);
    x = *(float*)&i;
    x = x * (1.5f - xhalf * x * x);
    return x;
}

EMSCRIPTEN_KEEPALIVE
float fastDistance(float x1, float y1, float z1, float x2, float y2, float z2) {
    float dx = x2 - x1;
    float dy = y2 - y1;
    float dz = z2 - z1;
    float distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < 0.0001f) return 0.0f;
    return distSq * fastInvSqrt(distSq);
}

EMSCRIPTEN_KEEPALIVE
float smoothDamp(float current, float target, float* velocity, float smoothTime, float deltaTime) {
    float omega = 2.0f / smoothTime;
    float x = omega * deltaTime;
    float exp = 1.0f / (1.0f + x + 0.48f * x * x + 0.235f * x * x * x);
    float change = current - target;
    float temp = (*velocity + omega * change) * deltaTime;
    *velocity = (*velocity - omega * temp) * exp;
    return target + (change + temp) * exp;
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void batchDistances(float* positions, float* results, int count, float refX, float refY, float refZ) {
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
    for (int i = 0; i < count; i++) {
        float offset = (float)i * 0.1f;
        yPositions[i] = baseY[i] + sinf((time + offset) * frequency) * amplitude;
    }
}
