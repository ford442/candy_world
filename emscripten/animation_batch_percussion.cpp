/**
 * @file animation_batch_percussion.cpp
 * @brief Percussion instrument animation batch processing
 * @details Contains SIMD-optimized batch animations for:
 *          batchSnareSnap_c, batchAccordion_c, batchCymbalShake_c, batchGeyserErupt_c
 */

#include <emscripten.h>
#include <cmath>
#include <wasm_simd128.h>
#include "animation_batch_utils.h"

extern "C" {

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
void batchCymbalShake_c(float* input, int count, float time, float highFreq, float intensity, float* output) {
    int i = 0;
    int count4 = count & ~3;

    v128_t v_highFreq = wasm_f32x4_splat(highFreq);
    v128_t v_thresh = wasm_f32x4_splat(0.05f);
    v128_t v_scale_thresh = wasm_f32x4_splat(0.4f);
    v128_t v_twitch = wasm_f32x4_mul(v_highFreq, wasm_f32x4_splat(0.2f));
    v128_t v_decay = wasm_f32x4_splat(0.9f);
    v128_t v_time = wasm_f32x4_splat(time);
    v128_t v_time_mult = wasm_f32x4_splat(10.0f);
    v128_t v_x_mult = wasm_f32x4_splat(1.3f);
    v128_t v_pi_half = wasm_f32x4_splat(1.57079632679f);
    v128_t v_one = wasm_f32x4_splat(1.0f);
    v128_t v_scale_mult = wasm_f32x4_splat(0.5f);

    bool isTriggered = highFreq > 0.05f;

    float scale = 1.0f;
    if (highFreq > 0.4f) {
        scale = 1.0f + (highFreq - 0.4f) * 0.5f;
    }
    v128_t v_scale = wasm_f32x4_splat(scale);

    for (; i < count4; i += 4) {
        float z0 = input[(i+0) * ENTRY_STRIDE + 4];
        float z1 = input[(i+1) * ENTRY_STRIDE + 4];
        float z2 = input[(i+2) * ENTRY_STRIDE + 4];
        float z3 = input[(i+3) * ENTRY_STRIDE + 4];
        v128_t v_rotZ = wasm_f32x4_make(z0, z1, z2, z3);

        float x0 = input[(i+0) * ENTRY_STRIDE + 5];
        float x1 = input[(i+1) * ENTRY_STRIDE + 5];
        float x2 = input[(i+2) * ENTRY_STRIDE + 5];
        float x3 = input[(i+3) * ENTRY_STRIDE + 5];
        v128_t v_rotX = wasm_f32x4_make(x0, x1, x2, x3);

        if (isTriggered) {
            v128_t v_i = wasm_f32x4_make((float)(i+0), (float)(i+1), (float)(i+2), (float)(i+3));
            v128_t v_jitterSeed = wasm_f32x4_add(wasm_f32x4_mul(v_time, v_time_mult), v_i);

            v_rotZ = wasm_f32x4_mul(fast_sin_simd(v_jitterSeed), v_twitch);

            v128_t v_jitterXSeed = wasm_f32x4_add(wasm_f32x4_mul(v_jitterSeed, v_x_mult), v_pi_half); // cos
            v_rotX = wasm_f32x4_mul(fast_sin_simd(v_jitterXSeed), v_twitch);
        } else {
            v_rotZ = wasm_f32x4_mul(v_rotZ, v_decay);
            v_rotX = wasm_f32x4_mul(v_rotX, v_decay);
        }

        input[(i+0) * ENTRY_STRIDE + 4] = wasm_f32x4_extract_lane(v_rotZ, 0);
        input[(i+1) * ENTRY_STRIDE + 4] = wasm_f32x4_extract_lane(v_rotZ, 1);
        input[(i+2) * ENTRY_STRIDE + 4] = wasm_f32x4_extract_lane(v_rotZ, 2);
        input[(i+3) * ENTRY_STRIDE + 4] = wasm_f32x4_extract_lane(v_rotZ, 3);

        input[(i+0) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_rotX, 0);
        input[(i+1) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_rotX, 1);
        input[(i+2) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_rotX, 2);
        input[(i+3) * ENTRY_STRIDE + 5] = wasm_f32x4_extract_lane(v_rotX, 3);

        output[(i+0) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotZ, 0);
        output[(i+0) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotX, 0);
        output[(i+0) * RESULT_STRIDE + 2] = scale;
        output[(i+0) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+1) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotZ, 1);
        output[(i+1) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotX, 1);
        output[(i+1) * RESULT_STRIDE + 2] = scale;
        output[(i+1) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+2) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotZ, 2);
        output[(i+2) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotX, 2);
        output[(i+2) * RESULT_STRIDE + 2] = scale;
        output[(i+2) * RESULT_STRIDE + 3] = 0.0f;

        output[(i+3) * RESULT_STRIDE + 0] = wasm_f32x4_extract_lane(v_rotZ, 3);
        output[(i+3) * RESULT_STRIDE + 1] = wasm_f32x4_extract_lane(v_rotX, 3);
        output[(i+3) * RESULT_STRIDE + 2] = scale;
        output[(i+3) * RESULT_STRIDE + 3] = 0.0f;
    }

    // Tail loop
    for (; i < count; i++) {
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
        
        output[outBase] = rotZ;
        output[outBase + 1] = rotX;
        output[outBase + 2] = scale;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE

EMSCRIPTEN_KEEPALIVE
void batchGeyserErupt_c(float* particles, int count, float time, float kick, float* output) {
    const float gravity = 9.8f;
    const float dt = 0.016f; // Assume 60fps
    const float decayRate = 0.5f;
    
    // Use OpenMP for parallel processing of many particles
    #pragma omp parallel for schedule(dynamic, 64)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        // Particle state: [offset/seed, x, y, z, velocityY, age]
        float seed = particles[inBase];
        float x = particles[inBase + 1];
        float y = particles[inBase + 2];
        float z = particles[inBase + 3];
        float velocityY = particles[inBase + 4];
        float age = particles[inBase + 5];
        
        // Initialize on kick
        if (kick > 0.1f && age <= 0.0f) {
            // Pseudo-random spread based on seed
            float spreadX = (seed * 1.234f - floorf(seed * 1.234f)) * 2.0f - 1.0f;
            float spreadZ = (seed * 2.456f - floorf(seed * 2.456f)) * 2.0f - 1.0f;
            
            velocityY = kick * (1.0f + (seed - floorf(seed)) * 0.5f);
            x += spreadX * kick * 0.5f;
            z += spreadZ * kick * 0.5f;
            age = 0.016f;
        }
        
        // Update physics if particle is active
        if (age > 0.0f) {
            // Update position
            y += velocityY * dt;
            // Apply gravity
            velocityY -= gravity * dt;
            // Age the particle
            age += dt;
        }
        
        // Reset if particle falls below origin
        if (y < particles[inBase + 2] && velocityY < 0.0f) {
            age = 0.0f;
            velocityY = 0.0f;
            y = particles[inBase + 2]; // Reset to original Y
        }
        
        // Calculate scale based on age (fade out over time)
        float scale = 1.0f;
        if (age > 0.0f) {
            scale = fmaxf(0.0f, 1.0f - age * decayRate);
        }
        
        // Store updated state back to input
        particles[inBase + 1] = x;
        particles[inBase + 2] = y;
        particles[inBase + 3] = z;
        particles[inBase + 4] = velocityY;
        particles[inBase + 5] = age;
        
        // Output: [posX, posY, posZ, scale]
        output[outBase] = x;
        output[outBase + 1] = y;
        output[outBase + 2] = z;
        output[outBase + 3] = scale;
    }
}

