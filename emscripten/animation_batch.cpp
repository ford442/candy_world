/**
 * @file animation_batch.cpp
 * @brief SIMD-optimized batch animation processing - C++/Emscripten
 */

#include <emscripten.h>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include "omp.h"
#include <wasm_simd128.h>

extern "C" {

constexpr int BATCH_SIZE = 4000;
constexpr int ENTRY_STRIDE = 6;
constexpr int RESULT_STRIDE = 4;

// Fast approximate sine for SIMD (Taylor series approximation)
inline v128_t fast_sin_simd(v128_t x) {
    // Range reduction to [-pi, pi]
    v128_t pi = wasm_f32x4_splat(3.14159265358979323846f);
    v128_t inv_two_pi = wasm_f32x4_splat(0.15915494309189533576f);
    v128_t two_pi = wasm_f32x4_splat(6.28318530717958647692f);

    // y = x * (1 / 2pi)
    v128_t y = wasm_f32x4_mul(x, inv_two_pi);
    // z = round(y)
    v128_t z = wasm_f32x4_nearest(y);
    // x = x - z * 2pi
    x = wasm_f32x4_sub(x, wasm_f32x4_mul(z, two_pi));

    // Check if x > pi, then x -= 2pi
    v128_t cmp_pi = wasm_f32x4_gt(x, pi);
    x = wasm_v128_bitselect(wasm_f32x4_sub(x, two_pi), x, cmp_pi);

    // Check if x < -pi, then x += 2pi
    v128_t neg_pi = wasm_f32x4_splat(-3.14159265358979323846f);
    v128_t cmp_neg_pi = wasm_f32x4_lt(x, neg_pi);
    x = wasm_v128_bitselect(wasm_f32x4_add(x, two_pi), x, cmp_neg_pi);

    // Taylor series: x - x^3/6 + x^5/120 - x^7/5040
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

// Fast approximate sqrt for SIMD
inline v128_t fast_sqrt_simd(v128_t x) {
    // using intrinsic approximation
    v128_t inv_sqrt = wasm_f32x4_sqrt(x);
    return inv_sqrt;
}

EMSCRIPTEN_KEEPALIVE
void batchSnareSnap_c(float* input, int count, float time, float snareTrigger, float* output) {
    // Ensure loop iterates over multiples of 4
    int i = 0;
    int count4 = count & ~3;

    v128_t v_snareTrigger = wasm_f32x4_splat(snareTrigger);
    v128_t v_threshold = wasm_f32x4_splat(0.2f);
    v128_t v_one = wasm_f32x4_splat(1.0f);
    v128_t v_zero = wasm_f32x4_splat(0.0f);
    v128_t v_decay = wasm_f32x4_splat(0.1f);

    bool isTriggered = snareTrigger > 0.2f;

    for (; i < count4; i += 4) {
        // Load 4 instances from non-contiguous memory using scalar loads because of stride
        float snap0 = input[(i+0) * ENTRY_STRIDE + 4];
        float snap1 = input[(i+1) * ENTRY_STRIDE + 4];
        float snap2 = input[(i+2) * ENTRY_STRIDE + 4];
        float snap3 = input[(i+3) * ENTRY_STRIDE + 4];

        v128_t v_snap = wasm_f32x4_make(snap0, snap1, snap2, snap3);

        if (isTriggered) {
            // if snapState < 0.2, snapState = 1.0
            v128_t cmp = wasm_f32x4_lt(v_snap, v_threshold);
            v_snap = wasm_v128_bitselect(v_one, v_snap, cmp);
        } else {
            // snapState = max(0, snapState - 0.1)
            v_snap = wasm_f32x4_max(v_zero, wasm_f32x4_sub(v_snap, v_decay));
        }

        // Extract and store back
        snap0 = wasm_f32x4_extract_lane(v_snap, 0);
        snap1 = wasm_f32x4_extract_lane(v_snap, 1);
        snap2 = wasm_f32x4_extract_lane(v_snap, 2);
        snap3 = wasm_f32x4_extract_lane(v_snap, 3);

        input[(i+0) * ENTRY_STRIDE + 4] = snap0;
        input[(i+1) * ENTRY_STRIDE + 4] = snap1;
        input[(i+2) * ENTRY_STRIDE + 4] = snap2;
        input[(i+3) * ENTRY_STRIDE + 4] = snap3;

        output[(i+0) * RESULT_STRIDE + 0] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 1] = snap0;
        output[(i+0) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 1] = snap1;
        output[(i+1) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 1] = snap2;
        output[(i+2) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 1] = snap3;
        output[(i+3) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float snapState = input[inBase + 4];
        
        if (snareTrigger > 0.2f) {
            if (snapState < 0.2f) snapState = 1.0f;
        } else {
            snapState = fmaxf(0.0f, snapState - 0.1f);
        }
        
        input[inBase + 4] = snapState;
        
        output[outBase] = 0.0f;
        output[outBase + 1] = snapState;
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchAccordion_c(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity);
    v128_t v_ten = wasm_f32x4_splat(10.0f);
    v128_t v_zero = wasm_f32x4_splat(0.0f);
    v128_t v_one = wasm_f32x4_splat(1.0f);
    v128_t v_mult = wasm_f32x4_splat(0.31f);

    for (; i < count4; i += 4) {
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];

        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        v128_t v_animTime = wasm_f32x4_add(v_time, v_off);
        v128_t v_arg = wasm_f32x4_mul(v_animTime, v_ten);

        v128_t v_rawStretch = fast_sin_simd(v_arg);
        v_rawStretch = wasm_f32x4_max(v_zero, v_rawStretch);

        v128_t v_stretchY = wasm_f32x4_add(v_one, wasm_f32x4_mul(v_rawStretch, wasm_f32x4_mul(v_mult, v_intensity)));
        v128_t v_sqrt = fast_sqrt_simd(v_stretchY);
        v128_t v_widthXZ = wasm_f32x4_div(v_one, v_sqrt);

        float sy0 = wasm_f32x4_extract_lane(v_stretchY, 0);
        float sy1 = wasm_f32x4_extract_lane(v_stretchY, 1);
        float sy2 = wasm_f32x4_extract_lane(v_stretchY, 2);
        float sy3 = wasm_f32x4_extract_lane(v_stretchY, 3);

        float w0 = wasm_f32x4_extract_lane(v_widthXZ, 0);
        float w1 = wasm_f32x4_extract_lane(v_widthXZ, 1);
        float w2 = wasm_f32x4_extract_lane(v_widthXZ, 2);
        float w3 = wasm_f32x4_extract_lane(v_widthXZ, 3);

        output[(i+0) * RESULT_STRIDE + 0] = sy0;
        output[(i+0) * RESULT_STRIDE + 1] = w0;
        output[(i+0) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = sy1;
        output[(i+1) * RESULT_STRIDE + 1] = w1;
        output[(i+1) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = sy2;
        output[(i+2) * RESULT_STRIDE + 1] = w2;
        output[(i+2) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = sy3;
        output[(i+3) * RESULT_STRIDE + 1] = w3;
        output[(i+3) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float animTime = time + offset;
        float rawStretch = sinf(animTime * 10.0f);
        float stretchY = 1.0f + fmaxf(0.0f, rawStretch) * 0.31f * intensity;
        float widthXZ = 1.0f / sqrtf(stretchY);
        
        output[outBase] = stretchY;
        output[outBase + 1] = widthXZ;
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchFiberWhip_c(float* input, int count, float time, float leadVol, int isActive, float* output) {
    float whip = leadVol * 2.0f;
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float branchIndex = input[inBase + 4];
        
        float baseRotY = sinf(time * 0.5f + offset) * 0.1f;
        float childOffset = branchIndex * 0.5f;
        float branchRotZ = 0.785398f + sinf(time * 2.0f + childOffset) * 0.1f;
        
        if (isActive) {
            branchRotZ += sinf(time * 10.0f + childOffset) * whip;
        }
        
        output[outBase] = baseRotY;
        output[outBase + 1] = branchRotZ;
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchSpiralWave_c(float* input, int count, float time, float intensity, float groove, float* output) {
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float childIndex = (float)i;
        
        float animTime = time + offset + childIndex * 0.5f;
        float rotY = sinf(animTime * 2.0f) * 0.2f * intensity;
        float yOffset = sinf(animTime * 3.0f) * 0.1f * (1.0f + groove);
        float scale = 1.0f + sinf(animTime * 4.0f) * 0.05f * intensity;
        
        output[outBase] = rotY;
        output[outBase + 1] = yOffset;
        output[outBase + 2] = scale;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchVibratoShake_c(float* input, int count, float time, float vibratoAmount, float intensity, float* output) {
    float shakeSpeed = 50.0f + vibratoAmount * 100.0f;
    float shakeAmount = 0.05f + vibratoAmount * 0.25f;
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float phase = (float)i * 0.5f;
        
        float rotX = -1.5708f + sinf(time * shakeSpeed + phase) * shakeAmount;
        float rotY = cosf(time * shakeSpeed * 1.3f + phase) * shakeAmount * 0.8f;
        
        output[outBase] = rotX;
        output[outBase + 1] = rotY;
        output[outBase + 2] = shakeSpeed;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchTremoloPulse_c(float* input, int count, float time, float tremoloAmount, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_tremoloAmount = wasm_f32x4_splat(tremoloAmount);
    v128_t v_intensity = wasm_f32x4_splat(intensity);
    v128_t v_one = wasm_f32x4_splat(1.0f);
    v128_t v_zero = wasm_f32x4_splat(0.0f);

    float pulseSpeed = 8.0f + tremoloAmount * 15.0f;
    v128_t v_pulseSpeed = wasm_f32x4_splat(pulseSpeed);

    float pulseAmount = 0.1f + tremoloAmount * 0.3f;
    v128_t v_pulseAmount = wasm_f32x4_splat(pulseAmount);

    v128_t v_time_x_speed = wasm_f32x4_mul(v_time, v_pulseSpeed);

    float emission_f = 0.3f + tremoloAmount * 0.7f;

    for (; i < count4; i += 4) {
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];

        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        v128_t v_arg = wasm_f32x4_add(v_time_x_speed, v_off);
        v128_t v_sin = fast_sin_simd(v_arg);

        v128_t v_pulse = wasm_f32x4_add(v_one, wasm_f32x4_mul(v_sin, v_pulseAmount));

        v128_t v_opacity = wasm_f32x4_add(wasm_f32x4_splat(0.7f), wasm_f32x4_mul(v_sin, wasm_f32x4_mul(wasm_f32x4_splat(0.2f), v_intensity)));

        float p0 = wasm_f32x4_extract_lane(v_pulse, 0);
        float p1 = wasm_f32x4_extract_lane(v_pulse, 1);
        float p2 = wasm_f32x4_extract_lane(v_pulse, 2);
        float p3 = wasm_f32x4_extract_lane(v_pulse, 3);

        float op0 = wasm_f32x4_extract_lane(v_opacity, 0);
        float op1 = wasm_f32x4_extract_lane(v_opacity, 1);
        float op2 = wasm_f32x4_extract_lane(v_opacity, 2);
        float op3 = wasm_f32x4_extract_lane(v_opacity, 3);

        output[(i+0) * RESULT_STRIDE + 0] = p0;
        output[(i+0) * RESULT_STRIDE + 1] = op0;
        output[(i+0) * RESULT_STRIDE + 2] = emission_f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = p1;
        output[(i+1) * RESULT_STRIDE + 1] = op1;
        output[(i+1) * RESULT_STRIDE + 2] = emission_f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = p2;
        output[(i+2) * RESULT_STRIDE + 1] = op2;
        output[(i+2) * RESULT_STRIDE + 2] = emission_f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = p3;
        output[(i+3) * RESULT_STRIDE + 1] = op3;
        output[(i+3) * RESULT_STRIDE + 2] = emission_f;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        
        float pulseSpeed = 8.0f + tremoloAmount * 15.0f;
        float pulseAmount = 0.1f + tremoloAmount * 0.3f;
        float pulse = 1.0f + sinf(time * pulseSpeed + offset) * pulseAmount;
        
        float opacity = 0.7f + sinf(time * pulseSpeed + offset) * 0.2f * intensity;
        float emission = 0.3f + tremoloAmount * 0.7f;
        
        output[outBase] = pulse;
        output[outBase + 1] = opacity;
        output[outBase + 2] = emission;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchCymbalShake_c(float* input, int count, float time, float highFreq, float intensity, float* output) {
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float rotZ = input[inBase + 4];
        float rotX = input[inBase + 5];
        
        if (highFreq > 0.05f) {
            float twitch = highFreq * 0.2f;
            float jitterSeed = time * 10.0f + (float)i;
            float jitterZ = sinf(jitterSeed) * twitch;
            float jitterX = cosf(jitterSeed * 1.3f) * twitch;
            rotZ = jitterZ;
            rotX = jitterX;
        } else {
            rotZ *= 0.9f;
            rotX *= 0.9f;
        }
        
        input[inBase + 4] = rotZ;
        input[inBase + 5] = rotX;
        
        float scale = 1.0f;
        if (highFreq > 0.4f) {
            scale = 1.0f + (highFreq - 0.4f) * 0.5f;
        }
        
        output[outBase] = rotZ;
        output[outBase + 1] = rotX;
        output[outBase + 2] = scale;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchPanningBob_c(float* input, int count, float time, float panActivity, float intensity, float* output) {
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float panBias = input[inBase + 4];
        
        float currentBob = input[inBase + 5];
        float nextBob = currentBob + (panActivity - currentBob) * 0.1f;
        input[inBase + 5] = nextBob;
        
        float bobHeight = nextBob * 1.5f * intensity;
        float posY = sinf(time * 2.0f + offset) * 0.1f + bobHeight;
        float rotZ = panBias * bobHeight * 0.2f;
        float glowIntensity = 0.6f + bobHeight * 0.8f;
        
        output[outBase] = posY;
        output[outBase + 1] = rotZ;
        output[outBase + 2] = glowIntensity;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchSpiritFade_c(float* input, int count, float time, float volume, float delta, float* output) {
    constexpr float threshold = 0.1f;
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float originalY = input[inBase + 2];
        
        float currentOpacity = input[inBase + 4];
        float fleeSpeed = input[inBase + 5];
        
        float targetOpacity = 0.0f;
        if (volume < threshold) {
            targetOpacity = 0.8f;
            fleeSpeed = fmaxf(0.0f, fleeSpeed - 0.01f);
        } else {
            targetOpacity = 0.0f;
            if (currentOpacity > 0.1f) {
                fleeSpeed = fminf(0.2f, fleeSpeed + 0.01f);
            }
        }
        
        currentOpacity = currentOpacity + (targetOpacity - currentOpacity) * 0.05f;
        
        input[inBase + 4] = currentOpacity;
        input[inBase + 5] = fleeSpeed;
        
        float posY = originalY + sinf(time * 1.5f + offset) * 0.2f;
        
        output[outBase] = currentOpacity;
        output[outBase + 1] = posY;
        output[outBase + 2] = fleeSpeed;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void processBatchUniversal_c(
    int animType,
    float* input,
    int count,
    float time,
    float beatPhase,
    float kick,
    float groove,
    float audioParam,
    float* output
) {
    float animTime = time + beatPhase;
    float intensity = 1.0f + groove * 5.0f;
    
    switch (animType) {
        case 13:
            batchSnareSnap_c(input, count, time, audioParam, output);
            break;
        case 14:
            batchAccordion_c(input, count, time, intensity, output);
            break;
        case 15:
            batchFiberWhip_c(input, count, time, audioParam, 1, output);
            break;
        case 16:
            batchSpiralWave_c(input, count, time, intensity, groove, output);
            break;
        case 17:
            batchVibratoShake_c(input, count, time, audioParam, intensity, output);
            break;
        case 18:
            batchTremoloPulse_c(input, count, time, audioParam, intensity, output);
            break;
        case 19:
            batchCymbalShake_c(input, count, time, audioParam, intensity, output);
            break;
        case 20:
            batchPanningBob_c(input, count, time, audioParam, intensity, output);
            break;
        case 21:
            batchSpiritFade_c(input, count, time, audioParam, 0.016f, output);
            break;
    }
}

}
