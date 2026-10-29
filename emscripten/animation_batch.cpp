/**
 * @file animation_batch.cpp
 * @brief Foliage (vegetation) animation batch processing
 * @details SIMD batch animations the C++ ECS foliage bridge calls
 *          (src/systems/ecs/foliage-ecs-bridge.ts): batchShiver_c,
 *          batchSpring_c, batchFloat_c, batchCloudBob_c. The percussion,
 *          melodic, effects and *_simd batches and processBatchUniversal_c
 *          had no caller and were deleted (#2026).
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

} // extern "C"
