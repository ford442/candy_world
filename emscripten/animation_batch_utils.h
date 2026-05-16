/**
 * @file animation_batch_utils.h
 * @brief Shared utilities, constants, and SIMD helpers for batch animation processing
 * @details Contains SIMD math functions, memory layout constants, and inline helpers
 */

#pragma once

#include <wasm_simd128.h>
#include <cmath>

/* Memory layout constants */
constexpr int BATCH_SIZE = 4000;
constexpr int ENTRY_STRIDE = 6;      // Input stride per entry
constexpr int RESULT_STRIDE = 4;     // Output stride per entry

/* SIMD math constants */
constexpr float PI = 3.14159265358979323846f;
constexpr float TWO_PI = 6.28318530717958647692f;
constexpr float INV_TWO_PI = 0.15915494309189533576f;

/**
 * Fast approximate sine using Taylor series with range reduction for SIMD
 * @param x SIMD vector of 4 float values in radians
 * @return v128_t SIMD vector of approximate sine values
 * @details Uses 5th order Taylor series: x - x^3/6 + x^5/120 - x^7/5040
 */
inline v128_t fast_sin_simd(v128_t x) {
    v128_t pi = wasm_f32x4_splat(PI);
    v128_t inv_two_pi = wasm_f32x4_splat(INV_TWO_PI);
    v128_t two_pi = wasm_f32x4_splat(TWO_PI);

    // Range reduction to [-pi, pi]
    v128_t y = wasm_f32x4_mul(x, inv_two_pi);
    v128_t z = wasm_f32x4_nearest(y);
    x = wasm_f32x4_sub(x, wasm_f32x4_mul(z, two_pi));

    // Check if x > pi, then x -= 2pi
    v128_t cmp_pi = wasm_f32x4_gt(x, pi);
    x = wasm_v128_bitselect(wasm_f32x4_sub(x, two_pi), x, cmp_pi);

    // Check if x < -pi, then x += 2pi
    v128_t neg_pi = wasm_f32x4_splat(-PI);
    v128_t cmp_neg_pi = wasm_f32x4_lt(x, neg_pi);
    x = wasm_v128_bitselect(wasm_f32x4_add(x, two_pi), x, cmp_neg_pi);

    // Taylor series coefficients
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

/**
 * Fast approximate square root for SIMD
 * @param x SIMD vector of 4 float values
 * @return v128_t SIMD vector of approximate square root values
 */
inline v128_t fast_sqrt_simd(v128_t x) {
    return wasm_f32x4_sqrt(x);
}

/**
 * Extract sine value from a single float angle
 * @param angle Angle in radians
 * @return float Approximate sine value
 */
inline float scalar_sin_approx(float angle) {
    // Reduce to [-2π, 2π]
    while (angle > TWO_PI) angle -= TWO_PI;
    while (angle < -TWO_PI) angle += TWO_PI;
    
    // Reduce to [-π, π]
    if (angle > PI) angle -= TWO_PI;
    if (angle < -PI) angle += TWO_PI;
    
    // Taylor series approximation
    float x2 = angle * angle;
    float x3 = x2 * angle;
    float x5 = x3 * x2;
    float x7 = x5 * x2;
    
    return angle - (x3 * 0.16666666666666666667f) + 
           (x5 * 0.00833333333333333333f) - 
           (x7 * 0.00019841269841269841f);
}
