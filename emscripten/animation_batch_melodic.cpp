/**
 * @file animation_batch_melodic.cpp
 * @brief Melodic instrument animation batch processing
 * @details Contains SIMD-optimized batch animations for:
 *          batchFiberWhip_c, batchSpiralWave_c, batchVibratoShake_c, batchTremoloPulse_c, batchPanningBob_c
 */

#include <emscripten.h>
#include <cmath>
#include <wasm_simd128.h>
#include "animation_batch_utils.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE
void batchFiberWhip_c(float* input, int count, float time, float leadVol, int isActive, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    float whip = leadVol * 2.0f;
    v128_t v_whip = wasm_f32x4_splat(whip);
    v128_t v_base_mult = wasm_f32x4_splat(0.5f);
    v128_t v_base_amp = wasm_f32x4_splat(0.1f);
    v128_t v_child_mult = wasm_f32x4_splat(2.0f);
    v128_t v_child_base = wasm_f32x4_splat(0.785398f);
    v128_t v_child_amp = wasm_f32x4_splat(0.1f);
    v128_t v_active_mult = wasm_f32x4_splat(10.0f);
    v128_t v_half = wasm_f32x4_splat(0.5f);

    for (; i < count4; i += 4) {
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        float bi0 = input[(i+0) * ENTRY_STRIDE + 4];
        float bi1 = input[(i+1) * ENTRY_STRIDE + 4];
        float bi2 = input[(i+2) * ENTRY_STRIDE + 4];
        float bi3 = input[(i+3) * ENTRY_STRIDE + 4];
        v128_t v_bi = wasm_f32x4_make(bi0, bi1, bi2, bi3);

        v128_t v_childOffset = wasm_f32x4_mul(v_bi, v_half);

        v128_t v_baseArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_base_mult), v_off);
        v128_t v_baseSin = fast_sin_simd(v_baseArg);
        v128_t v_baseRotY = wasm_f32x4_mul(v_baseSin, v_base_amp);

        v128_t v_childArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_child_mult), v_childOffset);
        v128_t v_childSin = fast_sin_simd(v_childArg);
        v128_t v_branchRotZ = wasm_f32x4_add(v_child_base, wasm_f32x4_mul(v_childSin, v_child_amp));

        if (isActive) {
            v128_t v_activeArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_active_mult), v_childOffset);
            v128_t v_activeSin = fast_sin_simd(v_activeArg);
            v_branchRotZ = wasm_f32x4_add(v_branchRotZ, wasm_f32x4_mul(v_activeSin, v_whip));
        }

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_baseRotY, 0);
        output[(i+0) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_branchRotZ, 0);
        output[(i+0) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_baseRotY, 1);
        output[(i+1) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_branchRotZ, 1);
        output[(i+1) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_baseRotY, 2);
        output[(i+2) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_branchRotZ, 2);
        output[(i+2) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_baseRotY, 3);
        output[(i+3) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_branchRotZ, 3);
        output[(i+3) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
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
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity);
    v128_t v_groove_mult = wasm_f32x4_splat(1.0f + groove);
    v128_t v_one = wasm_f32x4_splat(1.0f);
    v128_t v_half = wasm_f32x4_splat(0.5f);

    v128_t v_rotY_mult = wasm_f32x4_splat(2.0f);
    v128_t v_rotY_amp = wasm_f32x4_mul(wasm_f32x4_splat(0.2f), v_intensity);

    v128_t v_yOffset_mult = wasm_f32x4_splat(3.0f);
    v128_t v_yOffset_amp = wasm_f32x4_mul(wasm_f32x4_splat(0.1f), v_groove_mult);

    v128_t v_scale_mult = wasm_f32x4_splat(4.0f);
    v128_t v_scale_amp = wasm_f32x4_mul(wasm_f32x4_splat(0.05f), v_intensity);

    for (; i < count4; i += 4) {
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        v128_t v_childIndex = wasm_f32x4_make((float)(i+0), (float)(i+1), (float)(i+2), (float)(i+3));

        v128_t v_animTime = wasm_f32x4_add(v_time, wasm_f32x4_add(v_off, wasm_f32x4_mul(v_childIndex, v_half)));

        v128_t v_rotYArg = wasm_f32x4_mul(v_animTime, v_rotY_mult);
        v128_t v_rotY = wasm_f32x4_mul(fast_sin_simd(v_rotYArg), v_rotY_amp);

        v128_t v_yOffsetArg = wasm_f32x4_mul(v_animTime, v_yOffset_mult);
        v128_t v_yOffset = wasm_f32x4_mul(fast_sin_simd(v_yOffsetArg), v_yOffset_amp);

        v128_t v_scaleArg = wasm_f32x4_mul(v_animTime, v_scale_mult);
        v128_t v_scale = wasm_f32x4_add(v_one, wasm_f32x4_mul(fast_sin_simd(v_scaleArg), v_scale_amp));

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotY, 0);
        output[(i+0) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_yOffset, 0);
        output[(i+0) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_scale, 0);
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotY, 1);
        output[(i+1) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_yOffset, 1);
        output[(i+1) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_scale, 1);
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotY, 2);
        output[(i+2) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_yOffset, 2);
        output[(i+2) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_scale, 2);
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotY, 3);
        output[(i+3) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_yOffset, 3);
        output[(i+3) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_scale, 3);
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
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
    
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_shakeSpeed = wasm_f32x4_splat(shakeSpeed);
    v128_t v_shakeAmount = wasm_f32x4_splat(shakeAmount);
    v128_t v_half = wasm_f32x4_splat(0.5f);
    v128_t v_pi_half = wasm_f32x4_splat(-1.5708f);
    v128_t v_rotY_mult = wasm_f32x4_splat(1.3f);
    v128_t v_rotY_amp_mult = wasm_f32x4_splat(0.8f);

    for (; i < count4; i += 4) {
        v128_t v_i = wasm_f32x4_make((float)(i+0), (float)(i+1), (float)(i+2), (float)(i+3));
        v128_t v_phase = wasm_f32x4_mul(v_i, v_half);

        v128_t v_rotXArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_shakeSpeed), v_phase);
        v128_t v_rotX = wasm_f32x4_add(v_pi_half, wasm_f32x4_mul(fast_sin_simd(v_rotXArg), v_shakeAmount));

        // cos(x) = sin(x + pi/2)
        v128_t v_rotYArg = wasm_f32x4_add(wasm_f32x4_mul(wasm_f32x4_mul(v_time, v_shakeSpeed), v_rotY_mult), v_phase);
        v128_t v_rotYSinArg = wasm_f32x4_add(v_rotYArg, wasm_f32x4_splat(1.57079632679f)); // +pi/2
        v128_t v_rotY = wasm_f32x4_mul(fast_sin_simd(v_rotYSinArg), wasm_f32x4_mul(v_shakeAmount, v_rotY_amp_mult));

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotX, 0);
        output[(i+0) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotY, 0);
        output[(i+0) * RESULT_STRIDE + 2] = shakeSpeed;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotX, 1);
        output[(i+1) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotY, 1);
        output[(i+1) * RESULT_STRIDE + 2] = shakeSpeed;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotX, 2);
        output[(i+2) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotY, 2);
        output[(i+2) * RESULT_STRIDE + 2] = shakeSpeed;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotX, 3);
        output[(i+3) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotY, 3);
        output[(i+3) * RESULT_STRIDE + 2] = shakeSpeed;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
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
void batchPanningBob_c(float* input, int count, float time, float panActivity, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_panActivity = wasm_f32x4_splat(panActivity);
    v128_t v_intensity = wasm_f32x4_splat(intensity);
    v128_t v_lerp = wasm_f32x4_splat(0.1f);
    v128_t v_time_mult = wasm_f32x4_splat(2.0f);
    v128_t v_sin_mult = wasm_f32x4_splat(0.1f);
    v128_t v_bob_mult = wasm_f32x4_mul(wasm_f32x4_splat(1.5f), v_intensity);
    v128_t v_rot_mult = wasm_f32x4_splat(0.2f);
    v128_t v_glow_base = wasm_f32x4_splat(0.6f);
    v128_t v_glow_mult = wasm_f32x4_splat(0.8f);

    for (; i < count4; i += 4) {
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        float pb0 = input[(i+0) * ENTRY_STRIDE + 4];
        float pb1 = input[(i+1) * ENTRY_STRIDE + 4];
        float pb2 = input[(i+2) * ENTRY_STRIDE + 4];
        float pb3 = input[(i+3) * ENTRY_STRIDE + 4];
        v128_t v_panBias = wasm_f32x4_make(pb0, pb1, pb2, pb3);

        float cb0 = input[(i+0) * ENTRY_STRIDE + 5];
        float cb1 = input[(i+1) * ENTRY_STRIDE + 5];
        float cb2 = input[(i+2) * ENTRY_STRIDE + 5];
        float cb3 = input[(i+3) * ENTRY_STRIDE + 5];
        v128_t v_currentBob = wasm_f32x4_make(cb0, cb1, cb2, cb3);

        v128_t v_nextBob = wasm_f32x4_add(v_currentBob, wasm_f32x4_mul(wasm_f32x4_sub(v_panActivity, v_currentBob), v_lerp));

        input[(i+0) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_nextBob, 0);
        input[(i+1) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_nextBob, 1);
        input[(i+2) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_nextBob, 2);
        input[(i+3) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_nextBob, 3);

        v128_t v_bobHeight = wasm_f32x4_mul(v_nextBob, v_bob_mult);

        v128_t v_sinArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_time_mult), v_off);
        v128_t v_posY = wasm_f32x4_add(wasm_f32x4_mul(fast_sin_simd(v_sinArg), v_sin_mult), v_bobHeight);

        v128_t v_rotZ = wasm_f32x4_mul(v_panBias, wasm_f32x4_mul(v_bobHeight, v_rot_mult));
        v128_t v_glowIntensity = wasm_f32x4_add(v_glow_base, wasm_f32x4_mul(v_bobHeight, v_glow_mult));

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 0);
        output[(i+0) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotZ, 0);
        output[(i+0) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_glowIntensity, 0);
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 1);
        output[(i+1) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotZ, 1);
        output[(i+1) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_glowIntensity, 1);
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 2);
        output[(i+2) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotZ, 2);
        output[(i+2) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_glowIntensity, 2);
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 3);
        output[(i+3) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotZ, 3);
        output[(i+3) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_glowIntensity, 3);
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
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


}
