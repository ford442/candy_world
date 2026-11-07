#include <emscripten.h>
#include <cmath>
#include <wasm_simd128.h>
#include "omp.h"

#if defined(_OPENMP) && defined(CANDY_PTHREAD_POOL_SIZE)
// Cap the OpenMP team at the pre-spawned pthread pool (build.sh passes
// PTHREAD_POOL_SIZE). Every `#pragma omp parallel` in emscripten/*.cpp would
// otherwise ask for one thread per core and block waiting for workers the
// pool never created.
__attribute__((constructor)) static void candyConfigureOpenMP() {
    omp_set_num_threads(CANDY_PTHREAD_POOL_SIZE);
}
#endif

// SIMD helper: sin(x) for any finite x, |error| < 4e-6.
// Reduce to [-pi, pi], fold into [-pi/2, pi/2] with sin(pi - x) = sin(x), then
// a degree-9 Taylor polynomial. (The previous degree-5 series over the whole
// [-pi, pi] range was off by ~0.6 near +/-pi, which put batchGroundHeight_simd
// more than a unit away from getGroundHeight; tests/native-batch-parity.)
static inline v128_t simd_f32x4_sin(v128_t x) {
    const v128_t two_pi = wasm_f32x4_splat(6.28318530718f);
    const v128_t inv_two_pi = wasm_f32x4_splat(0.15915494309f);
    const v128_t pi = wasm_f32x4_splat(3.14159265359f);
    const v128_t half_pi = wasm_f32x4_splat(1.57079632679f);

    // x = x - round(x * inv_2pi) * 2pi  ->  [-pi, pi]
    v128_t k = wasm_f32x4_nearest(wasm_f32x4_mul(x, inv_two_pi));
    x = wasm_f32x4_sub(x, wasm_f32x4_mul(k, two_pi));

    // Fold into [-pi/2, pi/2]
    v128_t above = wasm_f32x4_gt(x, half_pi);
    x = wasm_v128_bitselect(wasm_f32x4_sub(pi, x), x, above);
    v128_t below = wasm_f32x4_lt(x, wasm_f32x4_neg(half_pi));
    x = wasm_v128_bitselect(wasm_f32x4_sub(wasm_f32x4_neg(pi), x), x, below);

    // x * (1 - x^2/(2*3) * (1 - x^2/(4*5) * (1 - x^2/(6*7) * (1 - x^2/(8*9)))))
    v128_t x2 = wasm_f32x4_mul(x, x);
    const v128_t one = wasm_f32x4_splat(1.0f);
    v128_t p = wasm_f32x4_sub(one, wasm_f32x4_mul(x2, wasm_f32x4_splat(1.0f / 72.0f)));
    p = wasm_f32x4_sub(one, wasm_f32x4_mul(wasm_f32x4_mul(x2, wasm_f32x4_splat(1.0f / 42.0f)), p));
    p = wasm_f32x4_sub(one, wasm_f32x4_mul(wasm_f32x4_mul(x2, wasm_f32x4_splat(1.0f / 20.0f)), p));
    p = wasm_f32x4_sub(one, wasm_f32x4_mul(wasm_f32x4_mul(x2, wasm_f32x4_splat(1.0f / 6.0f)), p));
    return wasm_f32x4_mul(x, p);
}

// SIMD helper: cos(x) = sin(x + pi/2), same accuracy as simd_f32x4_sin.
static inline v128_t simd_f32x4_cos(v128_t x) {
    return simd_f32x4_sin(wasm_f32x4_add(x, wasm_f32x4_splat(1.57079632679f)));
}

extern "C" {

// Ground height calculation matching AssemblyScript/JS implementation
// y = sin(x * 0.05) * 2.0 + cos(z * 0.05) * 2.0 + sin(x * 0.2) * 0.3 + cos(z * 0.15) * 0.3
EMSCRIPTEN_KEEPALIVE
float getGroundHeight(float x, float z) {
    if (std::isnan(x) || std::isnan(z)) return 0.0f;
    
    float hills = sinf(x * 0.05f) * 2.0f + cosf(z * 0.05f) * 2.0f;
    float detail = sinf(x * 0.2f) * 0.3f + cosf(z * 0.15f) * 0.3f;
    
    return hills + detail;
}

// ============================================================================
// SIMD-optimized functions (using wasm_simd128.h)
// ============================================================================

// Batch ground height calculation using SIMD
// Processes 4 positions at a time using vectorized sin/cos approximations
// Input: positions array of [x0, z0, x1, z1, x2, z2, ...] interleaved format
// Output: height values for each position
EMSCRIPTEN_KEEPALIVE
void batchGroundHeight_simd(float* positions, int count, float* output) {
    int i = 0;
    int count4 = count & ~3;  // Round down to multiple of 4
    
    // Constants for ground height calculation
    // hills = sin(x * 0.05) * 2 + cos(z * 0.05) * 2
    // detail = sin(x * 0.2) * 0.3 + cos(z * 0.15) * 0.3
    v128_t freq_hills = wasm_f32x4_splat(0.05f);
    v128_t amp_hills = wasm_f32x4_splat(2.0f);
    v128_t freq_detail_x = wasm_f32x4_splat(0.2f);
    v128_t freq_detail_z = wasm_f32x4_splat(0.15f);
    v128_t amp_detail = wasm_f32x4_splat(0.3f);
    
    for (; i < count4; i += 4) {
        // Load 4 positions (8 floats: x0,z0,x1,z1,x2,z2,x3,z3)
        // wasm_v128_load loads 16 bytes (4 floats)
        v128_t pos0 = wasm_v128_load(positions + i * 2);      // x0, z0, x1, z1
        v128_t pos1 = wasm_v128_load(positions + i * 2 + 4);  // x2, z2, x3, z3
        
        // Deinterleave to get x and z vectors
        // x = [x0, x1, x2, x3], z = [z0, z1, z2, z3]
        // wasm_i32x4_shuffle(a, b, c0, c1, c2, c3) selects lanes:
        // c0 < 4 ? a[c0] : b[c0-4]
        // For x: take a[0], a[2], b[0], b[2] -> indices 0, 2, 4, 6
        v128_t vx = wasm_i32x4_shuffle(pos0, pos1, 0, 2, 4, 6);
        v128_t vz = wasm_i32x4_shuffle(pos0, pos1, 1, 3, 5, 7);
        
        // Calculate hills component: sin(x * 0.05) * 2 + cos(z * 0.05) * 2
        v128_t x_hills = wasm_f32x4_mul(vx, freq_hills);
        v128_t z_hills = wasm_f32x4_mul(vz, freq_hills);
        
        v128_t sin_x = simd_f32x4_sin(x_hills);
        v128_t cos_z = simd_f32x4_cos(z_hills);
        
        v128_t hills = wasm_f32x4_mul(wasm_f32x4_add(sin_x, cos_z), amp_hills);
        
        // Calculate detail component: sin(x * 0.2) * 0.3 + cos(z * 0.15) * 0.3
        v128_t x_detail = wasm_f32x4_mul(vx, freq_detail_x);
        v128_t z_detail = wasm_f32x4_mul(vz, freq_detail_z);
        
        v128_t sin_x_detail = simd_f32x4_sin(x_detail);
        v128_t cos_z_detail = simd_f32x4_cos(z_detail);
        
        v128_t detail = wasm_f32x4_mul(wasm_f32x4_add(sin_x_detail, cos_z_detail), amp_detail);
        
        // Sum hills + detail
        v128_t result = wasm_f32x4_add(hills, detail);
        
        // Store results
        wasm_v128_store(output + i, result);
    }
    
    // Tail loop for remaining elements (0-3)
    for (; i < count; i++) {
        output[i] = getGroundHeight(positions[i * 2], positions[i * 2 + 1]);
    }
}

}  // extern "C"
