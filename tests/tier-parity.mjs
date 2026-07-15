#!/usr/bin/env node
/**
 * Tier parity golden-vector harness — JS vs AssemblyScript vs C++ (optional).
 *
 * Run: node tests/tier-parity.mjs
 * Requires: pnpm run build:wasm (AssemblyScript module)
 * C++ tier: best-effort when public/candy_native_st.wasm exists (not required in CI).
 *
 * @see docs/TIER_PARITY.md
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    ENTRY_STRIDE,
    RESULT_STRIDE,
    PARTICLE_FLOATS,
    shippedGetGroundHeight,
    shippedValueNoise2D,
    shippedFbm,
    f32ValueNoise2D,
    f32Fbm2D,
    f32GetGroundHeight,
    f32UpdateParticlesStep,
    refBatchShiver,
    refBatchSpring,
    refBatchFloat,
    refBatchCloudBob,
    makeBatchInputs,
    GROUND_SAMPLES,
    NOISE_SAMPLES_F32_STABLE,
    NOISE_SAMPLES_SHIPPED,
    FBM_OCTAVES,
} from './tier-parity-references.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** Per-function tolerances — see docs/TIER_PARITY.md */
export const EPS = {
    GROUND: 1e-4,
    PARTICLE: 1e-4,
    NOISE_F32_STABLE: 1e-3,
    /** Shipped JS Math.sin vs AS NativeMathf.sin — known production drift band */
    NOISE_SHIPPED: 0.15,
    FBM_F32: 0.12,
    FBM_SHIPPED: 0.15,
    BATCH_SCALAR: 1e-4,
    BATCH_SIMD: 3e-2,
};

let passed = 0;
let failed = 0;
let skipped = 0;

function assertClose(a, b, eps, label) {
    const diff = Math.abs(a - b);
    if (!Number.isFinite(a) || !Number.isFinite(b) || diff > eps) {
        throw new Error(`${label}: |${a} - ${b}| = ${diff} > ${eps}`);
    }
}

function assertArraysClose(a, b, eps, label) {
    if (a.length !== b.length) {
        throw new Error(`${label}: length mismatch ${a.length} vs ${b.length}`);
    }
    for (let i = 0; i < a.length; i++) {
        assertClose(a[i], b[i], eps, `${label}[${i}]`);
    }
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`✅ PASS: ${name}`);
        passed++;
    } catch (err) {
        console.log(`❌ FAIL: ${name} — ${err.message}`);
        failed++;
    }
}

function skip(name, reason) {
    console.log(`⏭️  SKIP: ${name} — ${reason}`);
    skipped++;
}

async function loadAssemblyScript() {
    const wasmPath = join(ROOT, 'src', 'wasm', 'candy_physics.wasm');
    if (!existsSync(wasmPath)) {
        throw new Error(`Missing ${wasmPath} — run pnpm run build:wasm`);
    }
    const wasmBytes = readFileSync(wasmPath);
    const { instance } = await WebAssembly.instantiate(wasmBytes, {
        env: {
            abort: () => {
                throw new Error('AssemblyScript WASM abort');
            },
            seed: () => 0.5,
        },
    });
    return instance.exports;
}

async function loadCppOptional() {
    const wasmPath = join(ROOT, 'public', 'candy_native_st.wasm');
    const jsPath = join(ROOT, 'public', 'candy_native_st.js');
    if (!existsSync(wasmPath) || !existsSync(jsPath)) {
        return null;
    }
    try {
        const wasmBytes = readFileSync(wasmPath);
        const create = (await import(pathToFileURL(jsPath).href)).default;
        const mod = await create({
            noInitialRun: true,
            instantiateWasm: (info, receiveInstance) => {
                WebAssembly.instantiate(wasmBytes, info).then((r) => receiveInstance(r.instance));
                return {};
            },
        });
        return mod;
    } catch (err) {
        console.warn(`⚠️  C++ tier unavailable: ${err.message}`);
        return null;
    }
}

function runBatchCpp(cpp, fnName, input, count, time, intensity) {
    const malloc = cpp._malloc;
    const free = cpp._free;
    const fn = cpp[`_${fnName}`];
    if (!malloc || !free || !fn) {
        throw new Error(`C++ batch function unavailable: ${fnName}`);
    }
    const inBytes = input.byteLength;
    const outLen = count * RESULT_STRIDE;
    const outBytes = outLen * 4;
    const inPtr = malloc(inBytes);
    const outPtr = malloc(outBytes);
    if (!inPtr || !outPtr) {
        if (inPtr) free(inPtr);
        if (outPtr) free(outPtr);
        throw new Error('C++ malloc failed');
    }
    try {
        const heap = new Float32Array(cpp.wasmMemory.buffer);
        heap.set(input, inPtr >> 2);
        fn(inPtr, count, time, intensity, outPtr);
        return heap.slice(outPtr >> 2, (outPtr >> 2) + outLen);
    } finally {
        free(inPtr);
        free(outPtr);
    }
}

async function main() {
    console.log('🧪 Tier Parity Golden-Vector Tests');
    console.log('====================================\n');

    const asc = await loadAssemblyScript();
    const cpp = await loadCppOptional();

    if (cpp) {
        console.log('ℹ️  C++ tier loaded (candy_native_st)\n');
    } else {
        console.log('ℹ️  C++ tier unavailable — skipping Emscripten checks (expected in CI)\n');
    }

    // -------------------------------------------------------------------------
    // Ground height — JS shipped + f32 vs AS vs C++
    // -------------------------------------------------------------------------
    await test('getGroundHeight: shipped JS vs AssemblyScript', () => {
        for (const [x, z] of GROUND_SAMPLES) {
            assertClose(
                shippedGetGroundHeight(x, z),
                asc.getGroundHeight(x, z),
                EPS.GROUND,
                `(${x},${z})`
            );
        }
    });

    await test('getGroundHeight: f32 ref vs AssemblyScript', () => {
        for (const [x, z] of GROUND_SAMPLES) {
            assertClose(
                f32GetGroundHeight(x, z),
                asc.getGroundHeight(x, z),
                EPS.GROUND,
                `(${x},${z})`
            );
        }
    });

    if (cpp?._getGroundHeight) {
        await test('getGroundHeight: AssemblyScript vs C++', () => {
            for (const [x, z] of GROUND_SAMPLES) {
                assertClose(
                    asc.getGroundHeight(x, z),
                    cpp._getGroundHeight(x, z),
                    EPS.GROUND,
                    `(${x},${z})`
                );
            }
        });
    } else if (cpp) {
        skip('getGroundHeight: AssemblyScript vs C++', 'export missing');
    }

    // -------------------------------------------------------------------------
    // Value noise / FBM
    // -------------------------------------------------------------------------
    await test('valueNoise2D: f32-stable samples JS ref vs AssemblyScript', () => {
        for (const [x, y] of NOISE_SAMPLES_F32_STABLE) {
            assertClose(
                f32ValueNoise2D(x, y),
                asc.valueNoise2D(x, y),
                EPS.NOISE_F32_STABLE,
                `f32 (${x},${y})`
            );
        }
    });

    await test('valueNoise2D: shipped JS fallback vs AssemblyScript (known sin drift band)', () => {
        for (const [x, y] of NOISE_SAMPLES_SHIPPED) {
            assertClose(
                shippedValueNoise2D(x, y),
                asc.valueNoise2D(x, y),
                EPS.NOISE_SHIPPED,
                `shipped (${x},${y})`
            );
        }
    });

    await test('fbm2D: f32 ref vs AssemblyScript', () => {
        for (const [x, y] of NOISE_SAMPLES_F32_STABLE) {
            for (const oct of FBM_OCTAVES) {
                assertClose(
                    f32Fbm2D(x, y, oct),
                    asc.fbm2D(x, y, oct),
                    EPS.FBM_F32,
                    `(${x},${y}) o=${oct}`
                );
            }
        }
    });

    await test('fbm2D: shipped JS fallback vs AssemblyScript (non-normalized vs normalized)', () => {
        for (const [x, y] of NOISE_SAMPLES_SHIPPED) {
            for (const oct of FBM_OCTAVES) {
                assertClose(
                    shippedFbm(x, y, oct),
                    asc.fbm2D(x, y, oct),
                    EPS.FBM_SHIPPED,
                    `shipped (${x},${y}) o=${oct}`
                );
            }
        }
    });

    if (cpp?._valueNoise2D) {
        await test('valueNoise2D: C++ uses distinct hash — internal simd4 wrapper parity', () => {
            const xs = new Float32Array([1.2, 3.4, 0.1, 0.2]);
            const ys = new Float32Array([2.1, -1.5, 4.4, 0.8]);
            const scalar = xs.map((x, i) => cpp._valueNoise2D(x, ys[i]));
            const malloc = cpp._malloc;
            const free = cpp._free;
            const xPtr = malloc(16);
            const yPtr = malloc(16);
            const oPtr = malloc(16);
            const heap = new Float32Array(cpp.wasmMemory.buffer);
            heap.set(xs, xPtr >> 2);
            heap.set(ys, yPtr >> 2);
            cpp._valueNoise2D_simd4(xPtr, yPtr, oPtr);
            const simd = Array.from(heap.slice(oPtr >> 2, (oPtr >> 2) + 4));
            free(xPtr);
            free(yPtr);
            free(oPtr);
            for (let i = 0; i < 4; i++) {
                assertClose(scalar[i], simd[i], EPS.NOISE_F32_STABLE, `cpp simd4[${i}]`);
            }
        });
    } else if (cpp) {
        skip('valueNoise2D: C++ simd4 wrapper', 'export missing');
    }

    // -------------------------------------------------------------------------
    // Particle update — JS f32 ref vs AssemblyScript (C++ uses different API)
    // -------------------------------------------------------------------------
    await test('updateParticles: f32 JS ref vs AssemblyScript (10 steps)', () => {
        const count = 6;
        const ptr = 8192;
        const dt = 0.016;
        const gravity = -9.8;
        const ascMem = new Float32Array(asc.memory.buffer);
        const jsMem = new Float32Array(count * PARTICLE_FLOATS);

        for (let i = 0; i < count; i++) {
            const b = i * PARTICLE_FLOATS;
            jsMem[b] = (i - 2) * 3.5;
            jsMem[b + 1] = 12 + i;
            jsMem[b + 2] = (i - 3) * 2.0;
            jsMem[b + 3] = 1.5;
            jsMem[b + 4] = 8.0;
            jsMem[b + 5] = -0.5;
        }
        ascMem.set(jsMem, ptr >> 2);

        for (let step = 0; step < 10; step++) {
            f32UpdateParticlesStep(jsMem, 0, count, dt, gravity);
            asc.updateParticles(ptr, count, dt, gravity);
        }

        const ascAfter = ascMem.slice(ptr >> 2, (ptr >> 2) + count * PARTICLE_FLOATS);
        assertArraysClose(jsMem, ascAfter, EPS.PARTICLE, 'particle state');
    });

    // -------------------------------------------------------------------------
    // Batch foliage animations — JS scalar ref vs C++ (no AssemblyScript tier)
    // -------------------------------------------------------------------------
    const batchFns = [
        ['batchShiver_c', refBatchShiver],
        ['batchSpring_c', refBatchSpring],
        ['batchFloat_c', refBatchFloat],
        ['batchCloudBob_c', refBatchCloudBob],
    ];
    const time = 1.75;
    const intensity = 0.85;

    for (const [cppName, refFn] of batchFns) {
        if (!cpp) {
            skip(`${cppName}: scalar JS ref vs C++ (n=3)`, 'C++ tier unavailable');
            skip(`${cppName}: scalar JS ref vs C++ (n=8, SIMD path)`, 'C++ tier unavailable');
            continue;
        }

        await test(`${cppName}: scalar JS ref vs C++ (n=3, tail path)`, () => {
            const count = 3;
            const input = makeBatchInputs(count);
            const jsOut = new Float32Array(count * RESULT_STRIDE);
            refFn(input, count, time, intensity, jsOut);
            const cppOut = runBatchCpp(cpp, cppName, input, count, time, intensity);
            assertArraysClose(jsOut, cppOut, EPS.BATCH_SCALAR, cppName);
        });

        await test(`${cppName}: scalar JS ref vs C++ (n=8, SIMD path)`, () => {
            const count = 8;
            const input = makeBatchInputs(count);
            const jsOut = new Float32Array(count * RESULT_STRIDE);
            refFn(input, count, time, intensity, jsOut);
            const cppOut = runBatchCpp(cpp, cppName, input, count, time, intensity);
            assertArraysClose(jsOut, cppOut, EPS.BATCH_SIMD, `${cppName} simd`);
        });
    }

    console.log('\n====================================');
    console.log(`📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (failed > 0) {
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error('❌ Tier parity harness error:', err);
        process.exit(1);
    });
}

export default main;
