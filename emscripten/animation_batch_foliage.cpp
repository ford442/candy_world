/**
 * @file animation_batch_foliage.cpp
 * @brief Foliage (vegetation) animation batch processing
 * @details Contains SIMD-optimized batch animations for:
 *          batchShiver_c, batchSpring_c, batchFloat_c, batchCloudBob_c, batchVineSway_simd
 */

#include <emscripten.h>
#include <cmath>
#include <wasm_simd128.h>
#include "animation_batch_utils.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE
void batchShiver_c(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity * 0.05f);
    v128_t v_speed = wasm_f32x4_splat(20.0f);
    v128_t v_half = wasm_f32x4_splat(0.5f);

    for (; i < count4; i += 4) {
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        v128_t v_arg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_speed), v_off);
        v128_t v_shiver = wasm_f32x4_mul(fast_sin_simd(v_arg), v_intensity);

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_shiver, 0); // rotZ
        output[(i+0) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_shiver, 0) * 0.5f; // rotX
        output[(i+0) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_shiver, 1);
        output[(i+1) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_shiver, 1) * 0.5f;
        output[(i+1) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_shiver, 2);
        output[(i+2) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_shiver, 2) * 0.5f;
        output[(i+2) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_shiver, 3);
        output[(i+3) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_shiver, 3) * 0.5f;
        output[(i+3) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float shiver = sinf(time * 20.0f + offset) * 0.05f * intensity;
        
        output[outBase] = shiver;      // rotZ
        output[outBase + 1] = shiver * 0.5f; // rotX
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE

EMSCRIPTEN_KEEPALIVE
void batchSpring_c(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity);
    v128_t v_speed = wasm_f32x4_splat(5.0f);
    v128_t v_one = wasm_f32x4_splat(1.0f);
    v128_t v_stretch_mult = wasm_f32x4_splat(0.1f);
    v128_t v_width_mult = wasm_f32x4_splat(0.05f);

    for (; i < count4; i += 4) {
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        v128_t v_springTime = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_speed), v_off);
        v128_t v_sin = fast_sin_simd(v_springTime);

        v128_t v_scaleY = wasm_f32x4_add(v_one, wasm_f32x4_mul(v_sin, wasm_f32x4_mul(v_stretch_mult, v_intensity)));
        v128_t v_scaleXZ = wasm_f32x4_sub(v_one, wasm_f32x4_mul(v_sin, wasm_f32x4_mul(v_width_mult, v_intensity)));

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_scaleY, 0);
        output[(i+0) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_scaleXZ, 0);
        output[(i+0) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_scaleXZ, 0);
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_scaleY, 1);
        output[(i+1) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_scaleXZ, 1);
        output[(i+1) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_scaleXZ, 1);
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_scaleY, 2);
        output[(i+2) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_scaleXZ, 2);
        output[(i+2) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_scaleXZ, 2);
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_scaleY, 3);
        output[(i+3) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_scaleXZ, 3);
        output[(i+3) * RESULT_STRIDE + 2] = wasm_f32x4_extract_lane(v_scaleXZ, 3);
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float springTime = time * 5.0f + offset;
        float sinVal = sinf(springTime);
        
        output[outBase] = 1.0f + sinVal * 0.1f * intensity;      // scaleY
        output[outBase + 1] = 1.0f - sinVal * 0.05f * intensity; // scaleX
        output[outBase + 2] = 1.0f - sinVal * 0.05f * intensity; // scaleZ
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE

EMSCRIPTEN_KEEPALIVE
void batchFloat_c(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity * 0.5f);
    v128_t v_speed = wasm_f32x4_splat(2.0f);

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

        v128_t v_arg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_speed), v_off);
        v128_t v_offset = wasm_f32x4_mul(fast_sin_simd(v_arg), v_intensity);
        v128_t v_posY = wasm_f32x4_add(v_originalY, v_offset);

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 0);
        output[(i+0) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 1);
        output[(i+1) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 2);
        output[(i+2) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 3);
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

EMSCRIPTEN_KEEPALIVE

EMSCRIPTEN_KEEPALIVE
void batchCloudBob_c(float* input, int count, float time, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_intensity = wasm_f32x4_splat(intensity * 0.3f);
    v128_t v_bob_speed = wasm_f32x4_splat(0.5f);
    v128_t v_rot_speed = wasm_f32x4_splat(0.2f);
    v128_t v_rot_mult = wasm_f32x4_splat(0.05f);
    v128_t v_half = wasm_f32x4_splat(0.5f);

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

        v128_t v_bobArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_bob_speed), v_off);
        v128_t v_posY = wasm_f32x4_add(v_originalY, wasm_f32x4_mul(fast_sin_simd(v_bobArg), v_intensity));

        v128_t v_rotArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_rot_speed), wasm_f32x4_mul(v_off, v_half));
        v128_t v_rotY = wasm_f32x4_mul(fast_sin_simd(v_rotArg), v_rot_mult);

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 0);
        output[(i+0) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotY, 0);
        output[(i+0) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 1);
        output[(i+1) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotY, 1);
        output[(i+1) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 2);
        output[(i+2) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotY, 2);
        output[(i+2) * RESULT_STRIDE + 2] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_posY, 3);
        output[(i+3) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotY, 3);
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

// =============================================================================
// NEW: SIMD-optimized Batch Animation Functions (Agent 2 Extension)
// Extended animation library with advanced SIMD patterns
// =============================================================================

/**
 * @brief Batch Shiver Animation (SIMD)
 * 
 * Creates a rapid shaking/trembling effect using high-frequency sine waves.
 * Math: rotZ = sin(time * 20 + offset) * 0.05 * intensity
 *       rotX = rotZ * 0.5 (secondary axis shake for depth)
 * 
 * Input:  [offset, x, y, z, intensity, state] per entry (ENTRY_STRIDE = 6)
 * Output: [rotX, rotY, rotZ, scale] per entry (RESULT_STRIDE = 4)
 */
EMSCRIPTEN_KEEPALIVE

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
        // Load offsets
        float off0 = input[(i+0) * ENTRY_STRIDE];
        float off1 = input[(i+1) * ENTRY_STRIDE];
        float off2 = input[(i+2) * ENTRY_STRIDE];
        float off3 = input[(i+3) * ENTRY_STRIDE];
        v128_t v_off = wasm_f32x4_make(off0, off1, off2, off3);

        // Load branch indices for cascading effect
        float bi0 = input[(i+0) * ENTRY_STRIDE + 4];
        float bi1 = input[(i+1) * ENTRY_STRIDE + 4];
        float bi2 = input[(i+2) * ENTRY_STRIDE + 4];
        float bi3 = input[(i+3) * ENTRY_STRIDE + 4];
        v128_t v_branchIdx = wasm_f32x4_make(bi0, bi1, bi2, bi3);

        // Calculate rotZ with cascading offset
        v128_t v_cascade = wasm_f32x4_mul(v_branchIdx, v_branch_mult);
        v128_t v_zArg = wasm_f32x4_add(wasm_f32x4_add(wasm_f32x4_mul(v_time, v_z_speed), v_off), v_cascade);
        v128_t v_rotZ = wasm_f32x4_mul(fast_sin_simd(v_zArg), v_amp);

        // Calculate rotX (secondary sway)
        v128_t v_xArg = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_x_speed), v_off);
        v128_t v_rotX = wasm_f32x4_mul(fast_sin_simd(v_xArg), wasm_f32x4_mul(v_x_amp, v_intensity));

        float rz0 = wasm_f32x4_extract_lane(v_rotZ, 0);
        float rz1 = wasm_f32x4_extract_lane(v_rotZ, 1);
        float rz2 = wasm_f32x4_extract_lane(v_rotZ, 2);
        float rz3 = wasm_f32x4_extract_lane(v_rotZ, 3);

        float rx0 = wasm_f32x4_extract_lane(v_rotX, 0);
        float rx1 = wasm_f32x4_extract_lane(v_rotX, 1);
        float rx2 = wasm_f32x4_extract_lane(v_rotX, 2);
        float rx3 = wasm_f32x4_extract_lane(v_rotX, 3);

        // Store: [rotX, 0, rotZ, 0]
        output[(i+0) * RESULT_STRIDE + 0] = rx0;
        output[(i+0) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+0) * RESULT_STRIDE + 2] = rz0;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = rx1;
        output[(i+1) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+1) * RESULT_STRIDE + 2] = rz1;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = rx2;
        output[(i+2) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+2) * RESULT_STRIDE + 2] = rz2;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = rx3;
        output[(i+3) * RESULT_STRIDE + 1] = 0.0f;
        output[(i+3) * RESULT_STRIDE + 2] = rz3;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float branchIdx = input[inBase + 4];
        
        float amp = 0.1f + intensity * 0.2f;
        float rotZ = sinf(time * 3.0f + offset + branchIdx * 0.3f) * amp;
        float rotX = sinf(time * 2.5f + offset) * 0.05f * intensity;
        
        output[outBase] = rotX;
        output[outBase + 1] = 0.0f;
        output[outBase + 2] = rotZ;
        output[outBase + 3] = 0.0f;
    }
}

}
