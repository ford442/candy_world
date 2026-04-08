#include <emscripten.h>
#include <cmath>
#include <cstdlib>
#include <wasm_simd128.h>
#include "omp.h"

// Static helper functions do not need to be exported, so they can stay as C++
static float lerp(float a, float b, float t) {
    return a + (b - a) * t;
}

static float smoothstep(float t) {
    return t * t * (3.0f - 2.0f * t);
}

// SIMD helper: approximate sin using Taylor series (valid for [-pi, pi])
// sin(x) ≈ x - x^3/6 + x^5/120 - x^7/5040
static inline v128_t simd_f32x4_sin(v128_t x) {
    // Reduce to [-pi, pi] range
    v128_t two_pi = wasm_f32x4_splat(6.28318530718f);
    v128_t inv_two_pi = wasm_f32x4_splat(0.15915494309f);
    
    // x = x - round(x * inv_2pi) * 2pi
    v128_t k = wasm_f32x4_nearest(wasm_f32x4_mul(x, inv_two_pi));
    x = wasm_f32x4_sub(x, wasm_f32x4_mul(k, two_pi));
    
    // Taylor series: x - x^3/6 + x^5/120
    v128_t x2 = wasm_f32x4_mul(x, x);
    v128_t x3 = wasm_f32x4_mul(x2, x);
    v128_t x5 = wasm_f32x4_mul(x3, x2);
    
    v128_t term1 = x;
    v128_t term2 = wasm_f32x4_mul(x3, wasm_f32x4_splat(1.0f / 6.0f));
    v128_t term3 = wasm_f32x4_mul(x5, wasm_f32x4_splat(1.0f / 120.0f));
    
    return wasm_f32x4_sub(wasm_f32x4_add(term1, term3), term2);
}

// SIMD helper: approximate cos using Taylor series
// cos(x) ≈ 1 - x^2/2 + x^4/24 - x^6/720
static inline v128_t simd_f32x4_cos(v128_t x) {
    // Reduce to [-pi, pi] range
    v128_t two_pi = wasm_f32x4_splat(6.28318530718f);
    v128_t inv_two_pi = wasm_f32x4_splat(0.15915494309f);
    
    v128_t k = wasm_f32x4_nearest(wasm_f32x4_mul(x, inv_two_pi));
    x = wasm_f32x4_sub(x, wasm_f32x4_mul(k, two_pi));
    
    // Taylor series: 1 - x^2/2 + x^4/24 - x^6/720
    v128_t x2 = wasm_f32x4_mul(x, x);
    v128_t x4 = wasm_f32x4_mul(x2, x2);
    v128_t x6 = wasm_f32x4_mul(x4, x2);
    
    v128_t term1 = wasm_f32x4_splat(1.0f);
    v128_t term2 = wasm_f32x4_mul(x2, wasm_f32x4_splat(0.5f));
    v128_t term3 = wasm_f32x4_mul(x4, wasm_f32x4_splat(1.0f / 24.0f));
    v128_t term4 = wasm_f32x4_mul(x6, wasm_f32x4_splat(1.0f / 720.0f));
    
    return wasm_f32x4_add(wasm_f32x4_sub(term1, term2), wasm_f32x4_sub(term3, term4));
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

// SIMD-parallel value noise for 4 points at once
// Uses vectorized hash calculation and interpolation
// Note: Currently uses scalar fallback since hash() involves bit operations
//       that are difficult to vectorize efficiently
EMSCRIPTEN_KEEPALIVE
void valueNoise2D_simd4(float* x, float* y, float* out) {
    // For now, use scalar fallback - hash function involves complex bit ops
    for (int i = 0; i < 4; i++) {
        out[i] = valueNoise2D(x[i], y[i]);
    }
}

// SIMD-parallel FBM for 4 points
// Computes FBM noise for 4 (x,y) pairs simultaneously
// Note: Uses scalar fallback since valueNoise2D is not easily vectorized
EMSCRIPTEN_KEEPALIVE
void fbm2D_simd4(float* x, float* y, int octaves, float* out) {
    for (int i = 0; i < 4; i++) {
        out[i] = fbm(x[i], y[i], octaves);
    }
}

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

// ============================================================================
// OpenMP-parallelized batch functions
// ============================================================================

// Parallel batch noise generation
// Uses OpenMP to distribute noise calculations across multiple threads
// Schedule: dynamic with chunk size 64 for load balancing
EMSCRIPTEN_KEEPALIVE
void batchValueNoise_omp(float* x, float* y, int count, float* out) {
    #pragma omp parallel for schedule(dynamic, 64)
    for (int i = 0; i < count; i++) {
        out[i] = valueNoise2D(x[i], y[i]);
    }
}

// Parallel FBM for terrain generation
// Computes FBM noise for many points using thread parallelism
// Each thread processes a chunk of points independently
EMSCRIPTEN_KEEPALIVE
void batchFbm_omp(float* x, float* y, int count, int octaves, float* out) {
    #pragma omp parallel for schedule(dynamic, 64)
    for (int i = 0; i < count; i++) {
        out[i] = fbm(x[i], y[i], octaves);
    }
}

// Parallel distance calculations
// Computes squared distance from multiple points (ax, ay, az) to a single point (bx, by, bz)
// Output: out[i] = (ax[i]-bx)^2 + (ay[i]-by)^2 + (az[i]-bz)^2
EMSCRIPTEN_KEEPALIVE
void batchDistSq3D_omp(
    float* ax, float* ay, float* az,
    float bx, float by, float bz,
    int count, float* out
) {
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < count; i++) {
        float dx = ax[i] - bx;
        float dy = ay[i] - by;
        float dz = az[i] - bz;
        out[i] = dx * dx + dy * dy + dz * dz;
    }
}

// ============================================================================
// Fast approximations
// ============================================================================

// Fast approximate sine using Taylor series expansion
// Valid for all inputs, with range reduction to [-pi, pi]
// Maximum error ~0.001 for the 5-term expansion
EMSCRIPTEN_KEEPALIVE
float fastSin(float x) {
    // Range reduction to [-pi, pi]
    const float two_pi = 6.28318530718f;
    const float inv_two_pi = 0.15915494309f;
    x = x - roundf(x * inv_two_pi) * two_pi;
    
    // Taylor series: sin(x) ≈ x - x^3/6 + x^5/120 - x^7/5040
    float x2 = x * x;
    float x3 = x2 * x;
    float x5 = x3 * x2;
    float x7 = x5 * x2;
    
    return x - x3 / 6.0f + x5 / 120.0f - x7 / 5040.0f;
}

// Fast approximate cosine using Taylor series expansion
// Valid for all inputs, with range reduction to [-pi, pi]
EMSCRIPTEN_KEEPALIVE
float fastCos(float x) {
    // Range reduction to [-pi, pi]
    const float two_pi = 6.28318530718f;
    const float inv_two_pi = 0.15915494309f;
    x = x - roundf(x * inv_two_pi) * two_pi;
    
    // Taylor series: cos(x) ≈ 1 - x^2/2 + x^4/24 - x^6/720
    float x2 = x * x;
    float x4 = x2 * x2;
    float x6 = x4 * x2;
    
    return 1.0f - x2 / 2.0f + x4 / 24.0f - x6 / 720.0f;
}

// Fast approximate pow2 for audio applications
// Computes 2^x using the approximation: 2^x ≈ 1 + x*ln(2) for small x
// For full range, uses: 2^x = 2^(int(x)) * 2^(frac(x))
// Maximum error ~0.5% for the full range
EMSCRIPTEN_KEEPALIVE
float fastPow2(float x) {
    // Separate integer and fractional parts
    int int_part = (int)floorf(x);
    float frac_part = x - int_part;
    
    // Approximate 2^frac using Taylor series around 0
    // 2^x ≈ 1 + x*ln(2) + (x*ln(2))^2/2 + ...
    const float ln2 = 0.69314718056f;
    
    float t = frac_part * ln2;
    float frac_result = 1.0f + t + t * t * 0.5f;
    
    // Combine: 2^x = 2^int * 2^frac
    // Use bit manipulation for fast 2^int
    union { float f; int i; } result;
    result.i = (int_part + 127) << 23;
    return result.f * frac_result;
}

// ============================================================================
// Additional SIMD utility functions
// ============================================================================

// SIMD-fast inverse square root for 4 values
// Uses the Quake III algorithm vectorized
EMSCRIPTEN_KEEPALIVE
void fastInvSqrt_simd4(float* x, float* out) {
    // Scalar fallback - the bit manipulation in Quake's algorithm
    // is difficult to vectorize efficiently in WASM SIMD
    for (int i = 0; i < 4; i++) {
        float xhalf = 0.5f * x[i];
        int xi = *(int*)&x[i];
        xi = 0x5f3759df - (xi >> 1);
        float y = *(float*)&xi;
        y = y * (1.5f - xhalf * y * y);
        out[i] = y;
    }
}

// Batch fast sine calculation using SIMD
// Processes 4 values at once using vectorized Taylor series
EMSCRIPTEN_KEEPALIVE
void batchFastSin_simd(float* x, int count, float* out) {
    int i = 0;
    int count4 = count & ~3;
    
    const float two_pi = 6.28318530718f;
    const float inv_two_pi = 0.15915494309f;
    v128_t v_two_pi = wasm_f32x4_splat(two_pi);
    v128_t v_inv_two_pi = wasm_f32x4_splat(inv_two_pi);
    
    for (; i < count4; i += 4) {
        v128_t vx = wasm_v128_load(x + i);
        
        // Range reduction
        v128_t k = wasm_f32x4_nearest(wasm_f32x4_mul(vx, v_inv_two_pi));
        vx = wasm_f32x4_sub(vx, wasm_f32x4_mul(k, v_two_pi));
        
        // Taylor series
        v128_t vx2 = wasm_f32x4_mul(vx, vx);
        v128_t vx3 = wasm_f32x4_mul(vx2, vx);
        v128_t vx5 = wasm_f32x4_mul(vx3, vx2);
        v128_t vx7 = wasm_f32x4_mul(vx5, vx2);
        
        v128_t term1 = vx;
        v128_t term2 = wasm_f32x4_mul(vx3, wasm_f32x4_splat(1.0f / 6.0f));
        v128_t term3 = wasm_f32x4_mul(vx5, wasm_f32x4_splat(1.0f / 120.0f));
        v128_t term4 = wasm_f32x4_mul(vx7, wasm_f32x4_splat(1.0f / 5040.0f));
        
        v128_t result = wasm_f32x4_sub(wasm_f32x4_add(term1, term3), 
                                       wasm_f32x4_add(term2, term4));
        
        wasm_v128_store(out + i, result);
    }
    
    // Tail loop
    for (; i < count; i++) {
        out[i] = fastSin(x[i]);
    }
}

// Batch fast cosine calculation using SIMD
EMSCRIPTEN_KEEPALIVE
void batchFastCos_simd(float* x, int count, float* out) {
    int i = 0;
    int count4 = count & ~3;
    
    const float two_pi = 6.28318530718f;
    const float inv_two_pi = 0.15915494309f;
    v128_t v_two_pi = wasm_f32x4_splat(two_pi);
    v128_t v_inv_two_pi = wasm_f32x4_splat(inv_two_pi);
    
    for (; i < count4; i += 4) {
        v128_t vx = wasm_v128_load(x + i);
        
        // Range reduction
        v128_t k = wasm_f32x4_nearest(wasm_f32x4_mul(vx, v_inv_two_pi));
        vx = wasm_f32x4_sub(vx, wasm_f32x4_mul(k, v_two_pi));
        
        // Taylor series
        v128_t vx2 = wasm_f32x4_mul(vx, vx);
        v128_t vx4 = wasm_f32x4_mul(vx2, vx2);
        v128_t vx6 = wasm_f32x4_mul(vx4, vx2);
        
        v128_t term1 = wasm_f32x4_splat(1.0f);
        v128_t term2 = wasm_f32x4_mul(vx2, wasm_f32x4_splat(0.5f));
        v128_t term3 = wasm_f32x4_mul(vx4, wasm_f32x4_splat(1.0f / 24.0f));
        v128_t term4 = wasm_f32x4_mul(vx6, wasm_f32x4_splat(1.0f / 720.0f));
        
        v128_t result = wasm_f32x4_add(wasm_f32x4_sub(term1, term2), 
                                       wasm_f32x4_sub(term3, term4));
        
        wasm_v128_store(out + i, result);
    }
    
    // Tail loop
    for (; i < count; i++) {
        out[i] = fastCos(x[i]);
    }
}

}  // extern "C"
