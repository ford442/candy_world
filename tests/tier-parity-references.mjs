/**
 * JS reference implementations for tier-parity tests.
 *
 * Two flavors:
 * - `shipped*`: mirrors production fallbacks in wasm-physics.ts / wasm-batch-math.ts
 * - `f32*`: f32-faithful mirrors of assembly/*.ts (canonical for AssemblyScript tier)
 *
 * See docs/TIER_PARITY.md for epsilon rationale and source-of-truth tier.
 */

export const ENTRY_STRIDE = 6;
export const RESULT_STRIDE = 4;
export const PARTICLE_FLOATS = 6;

const f = Math.fround;

// -----------------------------------------------------------------------------
// Shipped JS fallbacks (wasm-physics.ts / wasm-batch-math.ts)
// -----------------------------------------------------------------------------

/** Mirrors wasm-physics.ts getGroundHeight fallback */
export function shippedGetGroundHeight(x, z) {
    if (Number.isNaN(x) || Number.isNaN(z)) return 0;
    return (
        Math.sin(x * 0.05) * 2 +
        Math.cos(z * 0.05) * 2 +
        Math.sin(x * 0.2) * 0.3 +
        Math.cos(z * 0.15) * 0.3
    );
}

/** Mirrors wasm-batch-math.ts valueNoise2DJS */
export function shippedValueNoise2D(x, y) {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const u = x - fx;
    const v = y - fy;

    const hash = (hx, hy) => {
        const n = Math.sin(hx * 12.9898 + hy * 78.233) * 43758.5453;
        return n - Math.floor(n);
    };

    const n00 = hash(fx, fy);
    const n10 = hash(fx + 1, fy);
    const n01 = hash(fx, fy + 1);
    const n11 = hash(fx + 1, fy + 1);
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    return n00 * (1 - su) * (1 - sv) + n10 * su * (1 - sv) + n01 * (1 - su) * sv + n11 * su * sv;
}

/** Mirrors wasm-physics.ts fbm fallback (non-normalized; AS exports fbm2D normalized) */
export function shippedFbm(x, y, octaves = 4) {
    let value = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
        value += amp * shippedValueNoise2D(x * freq, y * freq);
        amp *= 0.5;
        freq *= 2;
    }
    return value;
}

// -----------------------------------------------------------------------------
// f32-faithful mirrors of assembly/math.ts (AssemblyScript canonical semantics)
// -----------------------------------------------------------------------------

export function f32Hash2D(x, y) {
    const sum = f(f(x) * f(12.9898) + f(y) * f(78.233));
    const n = f(Math.sin(sum) * f(43758.5453));
    return f(n - Math.floor(n));
}

function f32Lerp(a, b, t) {
    return f(a + f(b - a) * t);
}

/** assembly/math.ts valueNoise2D with f32 ops + Math.sin (see docs for NativeMathf.sin delta) */
export function f32ValueNoise2D(x, y) {
    x = f(x);
    y = f(y);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = f(x - ix);
    const fy = f(y - iy);
    const u = f(fx * fx * f(3 - 2 * fx));
    const v = f(fy * fy * f(3 - 2 * fy));
    return f32Lerp(
        f32Lerp(f32Hash2D(ix, iy), f32Hash2D(ix + 1, iy), u),
        f32Lerp(f32Hash2D(ix, iy + 1), f32Hash2D(ix + 1, iy + 1), u),
        v
    );
}

/** assembly/math.ts fbm2D */
export function f32Fbm2D(x, y, octaves) {
    x = f(x);
    y = f(y);
    let total = f(0);
    let amplitude = f(1);
    let frequency = f(1);
    let maxValue = f(0);
    const n = Math.trunc(Math.min(Math.max(octaves, 1), 8));
    for (let i = 0; i < n; i++) {
        total = f(total + f(f32ValueNoise2D(f(x * frequency), f(y * frequency)) * amplitude));
        maxValue = f(maxValue + amplitude);
        amplitude = f(amplitude * 0.5);
        frequency = f(frequency * 2);
    }
    return f(total / maxValue);
}

/** assembly/math.ts getGroundHeight */
export function f32GetGroundHeight(x, z) {
    if (Number.isNaN(x) || Number.isNaN(z)) return 0;
    return f(
        f(Math.sin(f(x * 0.05)) * 2) +
            f(Math.cos(f(z * 0.05)) * 2) +
            f(Math.sin(f(x * 0.2)) * 0.3) +
            f(Math.cos(f(z * 0.15)) * 0.3)
    );
}

/** assembly/particles.ts updateParticles — single step, in-place on byte-offset buffer */
export function f32UpdateParticlesStep(heapF32, bytePtr, count, dt, gravity) {
    const clampedDt = Math.max(0, dt);
    const baseIndex = bytePtr >> 2;
    for (let i = 0; i < count; i++) {
        const b = baseIndex + i * PARTICLE_FLOATS;
        let x = heapF32[b];
        let y = heapF32[b + 1];
        let z = heapF32[b + 2];
        let vx = heapF32[b + 3];
        let vy = heapF32[b + 4];
        let vz = heapF32[b + 5];

        vy = f(vy + f(gravity * clampedDt));
        x = f(x + f(vx * clampedDt));
        y = f(y + f(vy * clampedDt));
        z = f(z + f(vz * clampedDt));

        heapF32[b] = x;
        heapF32[b + 1] = y;
        heapF32[b + 2] = z;
        heapF32[b + 3] = vx;
        heapF32[b + 4] = vy;
        heapF32[b + 5] = vz;
    }
}

// -----------------------------------------------------------------------------
// Batch foliage animations — scalar tail paths from emscripten/animation_batch_foliage.cpp
// -----------------------------------------------------------------------------

export function refBatchShiver(input, count, time, intensity, output) {
    for (let i = 0; i < count; i++) {
        const inBase = i * ENTRY_STRIDE;
        const outBase = i * RESULT_STRIDE;
        const offset = input[inBase];
        const shiver = Math.sin(time * 20.0 + offset) * 0.05 * intensity;
        output[outBase] = shiver;
        output[outBase + 1] = shiver * 0.5;
        output[outBase + 2] = 0;
        output[outBase + 3] = 0;
    }
}

export function refBatchSpring(input, count, time, intensity, output) {
    for (let i = 0; i < count; i++) {
        const inBase = i * ENTRY_STRIDE;
        const outBase = i * RESULT_STRIDE;
        const offset = input[inBase];
        const sinVal = Math.sin(time * 5.0 + offset);
        output[outBase] = 1.0 + sinVal * 0.1 * intensity;
        output[outBase + 1] = 1.0 - sinVal * 0.05 * intensity;
        output[outBase + 2] = output[outBase + 1];
        output[outBase + 3] = 0;
    }
}

export function refBatchFloat(input, count, time, intensity, output) {
    for (let i = 0; i < count; i++) {
        const inBase = i * ENTRY_STRIDE;
        const outBase = i * RESULT_STRIDE;
        const offset = input[inBase];
        const originalY = input[inBase + 2];
        output[outBase] = originalY + Math.sin(time * 2.0 + offset) * 0.5 * intensity;
        output[outBase + 1] = 0;
        output[outBase + 2] = 0;
        output[outBase + 3] = 0;
    }
}

export function refBatchCloudBob(input, count, time, intensity, output) {
    for (let i = 0; i < count; i++) {
        const inBase = i * ENTRY_STRIDE;
        const outBase = i * RESULT_STRIDE;
        const offset = input[inBase];
        const originalY = input[inBase + 2];
        const bob = Math.sin(time * 0.5 + offset) * 0.3 * intensity;
        const rot = Math.sin(time * 0.2 + offset * 0.5) * 0.05;
        output[outBase] = originalY + bob;
        output[outBase + 1] = rot;
        output[outBase + 2] = 0;
        output[outBase + 3] = 0;
    }
}

/** Deterministic seeded inputs for batch tests */
export function makeBatchInputs(count, seed = 0xdecaf) {
    const input = new Float32Array(count * ENTRY_STRIDE);
    let s = seed >>> 0;
    for (let i = 0; i < count * ENTRY_STRIDE; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        input[i] = (s / 0xffffffff) * 4 - 2;
    }
    return input;
}

/** Golden sample coordinates for noise / ground tests */
export const GROUND_SAMPLES = [
    [0, 0],
    [1.5, -2.3],
    [50, 30],
    [-12.7, 8.25],
    [100, -100],
];

/** Fractional coords — f32 ref matches AS within ~1e-3 when NativeMathf.sin aligns */
export const NOISE_SAMPLES_F32_STABLE = [
    [1.2, 3.4],
    [0.1, 0.2],
    [10.5, -5.3],
];

/** Mixed coords — documents Math.sin vs NativeMathf.sin production drift */
export const NOISE_SAMPLES_SHIPPED = [
    [1.2, 3.4],
    [5, 6],
    [10, -5],
    [0.7, -1.2],
];

export const FBM_OCTAVES = [3, 4, 5];
