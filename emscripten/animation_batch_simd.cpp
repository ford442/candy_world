/**
 * @file animation_batch_simd.cpp
 * @brief SIMD-accelerated animation batch processing
 * @details Contains SIMD-optimized batch animations for:
 *          batchShiver_simd, batchSpring_simd, batchFloat_simd, batchCloudBob_simd, batchRetrigger_simd
 */

#include <emscripten.h>
#include <cmath>
#include <wasm_simd128.h>
#include "animation_batch_utils.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE
void batchShiver_simd(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;  // Process 4 at a time

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity);
    v128_t v_speed = wasm_f32x4_splat(20.0f);
    v128_t v_amp = wasm_f32x4_splat(0.05f);
    v128_t v_half = wasm_f32x4_splat(0.5f);

    for (; i < count4; i += 4) {
        // Load offsets from input
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        // Calculate: shiver = sin(time * 20 + offset) * 0.05 * intensity
        v128_t v_animTime = wasm_f32x4_mul(v_time, v_speed);
        v128_t v_arg = wasm_f32x4_add(v_animTime, v_off);
        v128_t v_sin = fast_sin_simd(v_arg);
        v128_t v_shiver = wasm_f32x4_mul(v_sin, wasm_f32x4_mul(v_amp, v_intensity));

        // Extract shiver values
        float s0 = wasm_f32x4_extract_lane(v_shiver, 0);
        float s1 = wasm_f32x4_extract_lane(v_shiver, 1);
        float s2 = wasm_f32x4_extract_lane(v_shiver, 2);
        float s3 = wasm_f32x4_extract_lane(v_shiver, 3);

        // Store results: rotZ = shiver, rotX = shiver * 0.5, rotY = 0, scale = 0
        output[(i+0) * RESULT_STRIDE + 0] = s0 * 0.5f;  // rotX
        output[(i+0) * RESULT_STRIDE + 1] = 0.0f;        // rotY
        output[(i+0) * RESULT_STRIDE + 2] = s0;          // rotZ
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;        // scale

        output[(i+1) * RESULT_STRIDE + 0] = s1 * 0.5f;
        output[(i+1) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 2] = s1;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = s2 * 0.5f;
        output[(i+2) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 2] = s2;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = s3 * 0.5f;
        output[(i+3) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 2] = s3;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop for remaining elements
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float shiver = sinf(time * 20.0f + offset) * 0.05f * intensity;
        
        output[outBase] = shiver * 0.5f;  // rotX
        output[outBase + 1] = 0.0f;        // rotY
        output[outBase + 2] = shiver;      // rotZ
        output[outBase + 3] = 0.0f;        // scale
    }
}

/**
 * @brief Batch Spring Animation (SIMD)
 * 
 * Spring/bounce animation with volume-preserving scale deformation.
 * Math: scaleY = 1 + sin(time * 5 + offset) * 0.1 * intensity
 *       scaleXZ = 1 - sin(time * 5 + offset) * 0.05 * intensity
 * 
 * When object stretches vertically, it compresses horizontally to preserve volume.
 */
EMSCRIPTEN_KEEPALIVE

EMSCRIPTEN_KEEPALIVE
void batchSpring_simd(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity);
    v128_t v_speed = wasm_f32x4_splat(5.0f);
    v128_t v_one = wasm_f32x4_splat(1.0f);
    v128_t v_stretch_mult = wasm_f32x4_splat(0.1f);
    v128_t v_width_mult = wasm_f32x4_splat(0.05f);

    for (; i < count4; i += 4) {
        // Load offsets
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        // Calculate spring bounce
        v128_t v_springTime = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_speed), v_off);
        v128_t v_sin = fast_sin_simd(v_springTime);

        // scaleY = 1 + sin * 0.1 * intensity
        v128_t v_scaleY = wasm_f32x4_add(v_one, wasm_f32x4_mul(v_sin, wasm_f32x4_mul(v_stretch_mult, v_intensity)));
        // scaleXZ = 1 - sin * 0.05 * intensity (inverse for volume preservation)
        v128_t v_scaleXZ = wasm_f32x4_sub(v_one, wasm_f32x4_mul(v_sin, wasm_f32x4_mul(v_width_mult, v_intensity)));

        float sy0 = wasm_f32x4_extract_lane(v_scaleY, 0);
        float sy1 = wasm_f32x4_extract_lane(v_scaleY, 1);
        float sy2 = wasm_f32x4_extract_lane(v_scaleY, 2);
        float sy3 = wasm_f32x4_extract_lane(v_scaleY, 3);

        float sxz0 = wasm_f32x4_extract_lane(v_scaleXZ, 0);
        float sxz1 = wasm_f32x4_extract_lane(v_scaleXZ, 1);
        float sxz2 = wasm_f32x4_extract_lane(v_scaleXZ, 2);
        float sxz3 = wasm_f32x4_extract_lane(v_scaleXZ, 3);

        // Store: [scaleY, scaleXZ, scaleXZ, 0] - volume-preserving deformation
        output[(i+0) * RESULT_STRIDE + 0] = sy0;
        output[(i+0) * RESULT_STRIDE + 1] = sxz0;
        output[(i+0) * RESULT_STRIDE + 2] = sxz0;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = sy1;
        output[(i+1) * RESULT_STRIDE + 1] = sxz1;
        output[(i+1) * RESULT_STRIDE + 2] = sxz1;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = sy2;
        output[(i+2) * RESULT_STRIDE + 1] = sxz2;
        output[(i+2) * RESULT_STRIDE + 2] = sxz2;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = sy3;
        output[(i+3) * RESULT_STRIDE + 1] = sxz3;
        output[(i+3) * RESULT_STRIDE + 2] = sxz3;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float springTime = time * 5.0f + offset;
        float sinVal = sinf(springTime);
        
        float scaleY = 1.0f + sinVal * 0.1f * intensity;
        float scaleXZ = 1.0f - sinVal * 0.05f * intensity;
        
        output[outBase] = scaleY;
        output[outBase + 1] = scaleXZ;
        output[outBase + 2] = scaleXZ;
        output[outBase + 3] = 0.0f;
    }
}

/**
 * @brief Batch Float Animation (SIMD)
 * 
 * Floating/bobbing animation for hovering objects.
 * Math: posY = originalY + sin(time * 2 + offset) * 0.5 * intensity
 * 
 * Uses the original Y position from input and applies a gentle sine wave offset.
 */
EMSCRIPTEN_KEEPALIVE

EMSCRIPTEN_KEEPALIVE
void batchFloat_simd(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity * 0.5f);
    v128_t v_speed = wasm_f32x4_splat(2.0f);

    for (; i < count4; i += 4) {
        // Load offsets
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        // Load original Y positions
        float y0 = input[(i+0) * ENTRY_STRIDE + 2];
        float y1 = input[(i+1) * ENTRY_STRIDE + 2];
        float y2 = input[(i+2) * ENTRY_STRIDE + 2];
        float y3 = input[(i+3) * ENTRY_STRIDE + 2];
        v128_t v_originalY = wasm_f32x4_make(y0, y1, y2, y3);

        // Calculate float offset
        v128_t v_arg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_speed), v_off);
        v128_t v_offset = wasm_f32x4_mul(fast_sin_simd(v_arg), v_intensity);
        v128_t v_posY = wasm_f32x4_add(v_originalY, v_offset);

        float py0 = wasm_f32x4_extract_lane(v_posY, 0);
        float py1 = wasm_f32x4_extract_lane(v_posY, 1);
        float py2 = wasm_f32x4_extract_lane(v_posY, 2);
        float py3 = wasm_f32x4_extract_lane(v_posY, 3);

        // Store: [posY, 0, 0, 0] - only vertical position changes
        output[(i+0) * RESULT_STRIDE + 0] = py0;
        output[(i+0) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = py1;
        output[(i+1) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = py2;
        output[(i+2) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = py3;
        output[(i+3) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float originalY = input[inBase + 2];
        
        float posY = originalY + sinf(time * 2.0f + offset) * 0.5f * intensity;
        
        output[outBase] = posY;
        output[outBase + 1] = 0.0f;
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

/**
 * @brief Batch Cloud Bob (SIMD)
 * 
 * Cloud-specific bobbing with gentle rotation for fluffy cloud movement.
 * Math: posY = originalY + sin(time * 0.5 + offset) * 0.3 * intensity
 *       rotY = sin(time * 0.2 + offset * 0.5) * 0.05
 * 
 * Slower, more gentle movement suitable for atmospheric clouds.
 */
EMSCRIPTEN_KEEPALIVE

EMSCRIPTEN_KEEPALIVE
void batchCloudBob_simd(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity * 0.3f);
    v128_t v_bob_speed = wasm_f32x4_splat(0.5f);
    v128_t v_rot_speed = wasm_f32x4_splat(0.2f);
    v128_t v_rot_mult = wasm_f32x4_splat(0.05f);
    v128_t v_half = wasm_f32x4_splat(0.5f);

    for (; i < count4; i += 4) {
        // Load offsets
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        // Load original Y positions
        float y0 = input[(i+0) * ENTRY_STRIDE + 2];
        float y1 = input[(i+1) * ENTRY_STRIDE + 2];
        float y2 = input[(i+2) * ENTRY_STRIDE + 2];
        float y3 = input[(i+3) * ENTRY_STRIDE + 2];
        v128_t v_originalY = wasm_f32x4_make(y0, y1, y2, y3);

        // Bobbing calculation - slower for clouds
        v128_t v_bobArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_bob_speed), v_off);
        v128_t v_posY = wasm_f32x4_add(v_originalY, wasm_f32x4_mul(fast_sin_simd(v_bobArg), v_intensity));

        // Gentle rotation
        v128_t v_rotArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_rot_speed), wasm_f32x4_mul(v_off, v_half));
        v128_t v_rotY = wasm_f32x4_mul(fast_sin_simd(v_rotArg), v_rot_mult);

        float py0 = wasm_f32x4_extract_lane(v_posY, 0);
        float py1 = wasm_f32x4_extract_lane(v_posY, 1);
        float py2 = wasm_f32x4_extract_lane(v_posY, 2);
        float py3 = wasm_f32x4_extract_lane(v_posY, 3);

        float ry0 = wasm_f32x4_extract_lane(v_rotY, 0);
        float ry1 = wasm_f32x4_extract_lane(v_rotY, 1);
        float ry2 = wasm_f32x4_extract_lane(v_rotY, 2);
        float ry3 = wasm_f32x4_extract_lane(v_rotY, 3);

        // Store: [posY, rotY, 0, 0]
        output[(i+0) * RESULT_STRIDE + 0] = py0;
        output[(i+0) * RESULT_STRIDE + 1] = ry0;
        output[(i+0) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = py1;
        output[(i+1) * RESULT_STRIDE + 1] = ry1;
        output[(i+1) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = py2;
        output[(i+2) * RESULT_STRIDE + 1] = ry2;
        output[(i+2) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = py3;
        output[(i+3) * RESULT_STRIDE + 1] = ry3;
        output[(i+3) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float originalY = input[inBase + 2];
        
        float posY = originalY + sinf(time * 0.5f + offset) * 0.3f * intensity;
        float rotY = sinf(time * 0.2f + offset * 0.5f) * 0.05f;
        
        output[outBase] = posY;
        output[outBase + 1] = rotY;
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

/**
 * @brief Batch Vine Sway (SIMD)
 * 
 * Vine-like swaying animation with cascading motion from top to bottom.
 * Math: rotZ = sin(time * 3 + offset + branchIndex * 0.3) * (0.1 + intensity * 0.2)
 *       rotX = sin(time * 2.5 + offset) * 0.05 * intensity
 * 
 * The swaying amplitude increases with intensity for wind effects.
 */
EMSCRIPTEN_KEEPALIVE

EMSCRIPTEN_KEEPALIVE
void batchRetrigger_simd(float* input, int count, float time, float retriggerSpeed, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_speed = wasm_f32x4_splat(retriggerSpeed);
    v128_t v_intensity = wasm_f32x4_splat(intensity);
    v128_t v_one = wasm_f32x4_splat(1.0f);
    v128_t v_two_pi = wasm_f32x4_splat(6.28318530717958647692f);
    v128_t v_scale_mult = wasm_f32x4_splat(0.5f);

    for (; i < count4; i += 4) {
        // Load offsets for phase variation
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        // Calculate retrigger phase: frac((time + offset * 0.1) * speed)
        v128_t v_phaseInput = wasm_f32x4_add(v_time, wasm_f32x4_mul(v_off, wasm_f32x4_splat(0.1f)));
        v128_t v_phase = wasm_f32x4_mul(v_phaseInput, v_speed);
        
        // Get fractional part using floor approximation
        // frac(x) = x - floor(x)
        v128_t v_floor = wasm_f32x4_trunc(wasm_f32x4_sub(v_phase, wasm_f32x4_splat(0.5f)));
        v_floor = wasm_f32x4_add(v_floor, wasm_f32x4_splat(0.5f));
        v_phase = wasm_f32x4_sub(v_phase, v_floor);

        // Calculate jump: sin(phase * 2PI) * intensity * (1 - phase)
        v128_t v_sinArg = wasm_f32x4_mul(v_phase, v_two_pi);
        v128_t v_sin = fast_sin_simd(v_sinArg);
        v128_t v_decay = wasm_f32x4_sub(v_one, v_phase);
        v128_t v_jump = wasm_f32x4_mul(wasm_f32x4_mul(v_sin, v_intensity), v_decay);

        // Calculate scale: 1.0 + jump * 0.5
        v128_t v_scale = wasm_f32x4_add(v_one, wasm_f32x4_mul(v_jump, v_scale_mult));

        // Load original positions for position offset
        float y0 = input[(i+0) * ENTRY_STRIDE + 2];
        float y1 = input[(i+1) * ENTRY_STRIDE + 2];
        float y2 = input[(i+2) * ENTRY_STRIDE + 2];
        float y3 = input[(i+3) * ENTRY_STRIDE + 2];
        v128_t v_origY = wasm_f32x4_make(y0, y1, y2, y3);

        v128_t v_posY = wasm_f32x4_add(v_origY, v_jump);

        float py0 = wasm_f32x4_extract_lane(v_posY, 0);
        float py1 = wasm_f32x4_extract_lane(v_posY, 1);
        float py2 = wasm_f32x4_extract_lane(v_posY, 2);
        float py3 = wasm_f32x4_extract_lane(v_posY, 3);

        float sc0 = wasm_f32x4_extract_lane(v_scale, 0);
        float sc1 = wasm_f32x4_extract_lane(v_scale, 1);
        float sc2 = wasm_f32x4_extract_lane(v_scale, 2);
        float sc3 = wasm_f32x4_extract_lane(v_scale, 3);

        // Store: [posY, scale, 0, 0]
        output[(i+0) * RESULT_STRIDE + 0] = py0;
        output[(i+0) * RESULT_STRIDE + 1] = sc0;
        output[(i+0) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = py1;
        output[(i+1) * RESULT_STRIDE + 1] = sc1;
        output[(i+1) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = py2;
        output[(i+2) * RESULT_STRIDE + 1] = sc2;
        output[(i+2) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = py3;
        output[(i+3) * RESULT_STRIDE + 1] = sc3;
        output[(i+3) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float origY = input[inBase + 2];
        
        // Calculate retrigger phase with fractional part
        float phaseInput = (time + offset * 0.1f) * retriggerSpeed;
        float phase = phaseInput - floorf(phaseInput);
        
        // Decaying jump
        float jump = sinf(phase * 6.28318530717958647692f) * intensity * (1.0f - phase);
        float scale = 1.0f + jump * 0.5f;
        float posY = origY + jump;
        
        output[outBase] = posY;
        output[outBase + 1] = scale;
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchVineSway_simd(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity);
    v128_t v_base_amp = wasm_f32x4_splat(0.1f);
    v128_t v_amp_mult = wasm_f32x4_splat(0.2f);
    v128_t v_z_speed = wasm_f32x4_splat(3.0f);
    v128_t v_x_speed = wasm_f32x4_splat(2.5f);
    v128_t v_x_amp = wasm_f32x4_splat(0.05f);
    v128_t v_branch_mult = wasm_f32x4_splat(0.3f);
    v128_t v_amp = wasm_f32x4_add(v_base_amp, wasm_f32x4_mul(v_intensity, v_amp_mult));

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
        v128_t v_branchIdx = wasm_f32x4_make(bi0, bi1, bi2, bi3);

        v128_t v_cascade = wasm_f32x4_mul(v_branchIdx, v_branch_mult);
        v128_t v_zArg = wasm_f32x4_add(wasm_f32x4_add(wasm_f32x4_mul(v_time, v_z_speed), v_off), v_cascade);
        v128_t v_rotZ = wasm_f32x4_mul(fast_sin_simd(v_zArg), v_amp);

        v128_t v_xArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_x_speed), v_off);
        v128_t v_rotX = wasm_f32x4_mul(fast_sin_simd(v_xArg), wasm_f32x4_mul(v_x_amp, v_intensity));

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotX, 0);
        output[(i+0) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_rotZ, 0);
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotX, 1);
        output[(i+1) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_rotZ, 1);
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotX, 2);
        output[(i+2) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_rotZ, 2);
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotX, 3);
        output[(i+3) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_rotZ, 3);
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        float offset = input[inBase];
        float branchIdx = input[inBase + 4];
        float amp = 0.1f + intensity * 0.2f;
        float rotZ = sinf(time * 3.0f + offset + branchIdx * 0.3f) * amp;
        float rotX = sinf(time * 2.5f + offset) * 0.05f * intensity;
        output[outBase]     = rotX;
        output[outBase + 1] = 0.0f;
        output[outBase + 2] = rotZ;
        output[outBase + 3] = 0.0f;
    }
}

}
