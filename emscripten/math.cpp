#include <emscripten.h>
#include <cmath>
#include <cstdlib>

// Static helper functions do not need to be exported, so they can stay as C++
static float lerp(float a, float b, float t) {
    return a + (b - a) * t;
}

static float smoothstep(float t) {
    return t * t * (3.0f - 2.0f * t);
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
float hash(float x, float y) {
    int ix = (int)(x * 1000);
    int iy = (int)(y * 1000);
    int n = ix + iy * 57;
    n = (n << 13) ^ n;
    return (1.0f - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0f);
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

EMSCRIPTEN_KEEPALIVE
float fastInvSqrt(float x) {
    float xhalf = 0.5f * x;
    int i = *(int*)&x;
    i = 0x5f3759df - (i >> 1);
    x = *(float*)&i;
    x = x * (1.5f - xhalf * x * x);
    return x;
}

}
