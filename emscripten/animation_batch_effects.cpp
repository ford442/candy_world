/**
 * @file animation_batch_effects.cpp
 * @brief Special effects animation batch processing
 * @details Contains SIMD-optimized batch animations for:
 *          batchSpiritFade_c, processBatchUniversal_c
 */

#include <emscripten.h>
#include <cmath>
#include <wasm_simd128.h>
#include "animation_batch_utils.h"

extern "C" {

// Forward declarations for functions defined in animation_batch_simd.cpp
void batchShiver_simd(float* input, int count, float time, float intensity, float* output);
void batchSpring_simd(float* input, int count, float time, float intensity, float* output);
void batchFloat_simd(float* input, int count, float time, float intensity, float* output);
void batchCloudBob_simd(float* input, int count, float time, float intensity, float* output);
void batchVineSway_simd(float* input, int count, float time, float intensity, float* output);
void batchRetrigger_simd(float* input, int count, float time, float retriggerSpeed, float intensity, float* output);

EMSCRIPTEN_KEEPALIVE
void batchSpiritFade_c(float* input, int count, float time, float volume, float delta, float* output) {
    constexpr float threshold = 0.1f;
    
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_zero = wasm_f32x4_splat(0.0f);
    v128_t v_lerp = wasm_f32x4_splat(0.05f);
    v128_t v_time_mult = wasm_f32x4_splat(1.5f);
    v128_t v_sin_mult = wasm_f32x4_splat(0.2f);
    v128_t v_delta_speed = wasm_f32x4_splat(0.01f);
    v128_t v_max_speed = wasm_f32x4_splat(0.2f);
    v128_t v_min_opacity = wasm_f32x4_splat(0.1f);

    bool isLoud = volume >= threshold;

    for (; i < count4; i += 4) {
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        float y0 = input[(i+0) * ENTRY_STRIDE + 2];
        float y1 = input[(i+1) * ENTRY_STRIDE + 2];
        float y2 = input[(i+2) * ENTRY_STRIDE + 2];
        float y3 = input[(i+3) * ENTRY_STRIDE + 2];
        v128_t v_originalY = wasm_f32x4_make(y0, y1, y2, y3);

        float op0 = input[(i+0) * ENTRY_STRIDE + 4];
        float op1 = input[(i+1) * ENTRY_STRIDE + 4];
        float op2 = input[(i+2) * ENTRY_STRIDE + 4];
        float op3 = input[(i+3) * ENTRY_STRIDE + 4];
        v128_t v_currentOpacity = wasm_f32x4_make(op0, op1, op2, op3);

        float sp0 = input[(i+0) * ENTRY_STRIDE + 5];
        float sp1 = input[(i+1) * ENTRY_STRIDE + 5];
        float sp2 = input[(i+2) * ENTRY_STRIDE + 5];
        float sp3 = input[(i+3) * ENTRY_STRIDE + 5];
        v128_t v_fleeSpeed = wasm_f32x4_make(sp0, sp1, sp2, sp3);

        v128_t v_targetOpacity;
        if (!isLoud) {
            v_targetOpacity = wasm_f32x4_splat(0.8f);
            v_fleeSpeed = wasm_f32x4_max(v_zero, wasm_f32x4_sub(v_fleeSpeed, v_delta_speed));
        } else {
            v_targetOpacity = v_zero;
            v128_t v_cmp = wasm_f32x4_gt(v_currentOpacity, v_min_opacity);
            v128_t v_inc_speed = wasm_f32x4_min(v_max_speed, wasm_f32x4_add(v_fleeSpeed, v_delta_speed));
            v_fleeSpeed = wasm_v128_bitselect(v_inc_speed, v_fleeSpeed, v_cmp);
        }

        v_currentOpacity = wasm_f32x4_add(v_currentOpacity, wasm_f32x4_mul(wasm_f32x4_sub(v_targetOpacity, v_currentOpacity), v_lerp));

        input[(i+0) * ENTRY_STRIDE + 4] = wasm_f32x4_extract_lane(v_currentOpacity, 0);
        input[(i+1) * ENTRY_STRIDE + 4] = wasm_f32x4_extract_lane(v_currentOpacity, 1);
        input[(i+2) * ENTRY_STRIDE + 4] = wasm_f32x4_extract_lane(v_currentOpacity, 2);
        input[(i+3) * ENTRY_STRIDE + 4] = wasm_f32x4_extract_lane(v_currentOpacity, 3);

        input[(i+0) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_fleeSpeed, 0);
        input[(i+1) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_fleeSpeed, 1);
        input[(i+2) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_fleeSpeed, 2);
        input[(i+3) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_fleeSpeed, 3);

        v128_t v_sinArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_time_mult), v_off);
        v128_t v_posY = wasm_f32x4_add(v_originalY, wasm_f32x4_mul(fast_sin_simd(v_sinArg), v_sin_mult));

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_currentOpacity, 0);
        output[(i+0) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_posY, 0);
        output[(i+0) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_fleeSpeed, 0);
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_currentOpacity, 1);
        output[(i+1) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_posY, 1);
        output[(i+1) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_fleeSpeed, 1);
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_currentOpacity, 2);
        output[(i+2) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_posY, 2);
        output[(i+2) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_fleeSpeed, 2);
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_currentOpacity, 3);
        output[(i+3) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_posY, 3);
        output[(i+3) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_fleeSpeed, 3);
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
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
        // Agent 1: Simple animation types migrated from TS
        case 22:
            batchShiver_c(input, count, time, intensity, output);
            break;
        case 23:
            batchSpring_c(input, count, time, intensity, output);
            break;
        case 24:
            batchFloat_c(input, count, time, intensity, output);
            break;
        case 25:
            batchCloudBob_c(input, count, time, intensity, output);
            break;
        // Agent 2: SIMD-optimized animation extensions
        case 26:
            batchShiver_simd(input, count, time, intensity, output);
            break;
        case 27:
            batchSpring_simd(input, count, time, intensity, output);
            break;
        case 28:
            batchFloat_simd(input, count, time, intensity, output);
            break;
        case 29:
            batchCloudBob_simd(input, count, time, intensity, output);
            break;
        case 30:
            batchVineSway_simd(input, count, time, intensity, output);
            break;
        case 31:
            batchGeyserErupt_c(input, count, time, audioParam, output);
            break;
        case 32:
            batchRetrigger_simd(input, count, time, beatPhase, intensity, output);
            break;
    }
}

}
