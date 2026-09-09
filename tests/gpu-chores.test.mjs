#!/usr/bin/env node
/**
 * Shared GPU chores parity harness (#1597, Tier B).
 *
 * Drives the JS mirror of the chores WGSL (tests/parity/refs/gpu-chores.mjs)
 * against naive references for:
 *
 *   (1) prefix_sum  — inclusive scan of a flag array
 *   (2) compact     — dense visible-index / LOD lists + count + indirect args
 *   (3) reduce_f32  — sum of an f32 array
 *
 * The mirror reproduces the shaders' block structure, so the interesting cases
 * are the block boundaries: 256 is one workgroup, 512 is two (where a
 * previous-block-only add-back happens to be correct), 513+ is three or more
 * (where it is not), and 65 792 is more than 256 blocks, which exercises the
 * carry loop in the single-workgroup scan of the block totals.
 *
 * Tolerances:
 *   - prefix_sum / compact indices and counts: exact (u32).
 *   - reduce_f32: |Δ| ≤ 1e-3 relative to a naive f64 sum.
 *     WHY: the shader sums in a 256-wide tree in f32; a naive left-to-right f64
 *     sum differs by accumulated rounding that grows with n. 1e-3 at the scales
 *     tested here still catches a wrong stride, a dropped block, or a missing
 *     tail guard.
 *
 * Run: npm run test:chores
 */

import { compactChore, prefixSumChore, reduceF32Chore } from './parity/refs/gpu-chores.mjs';

let passes = 0;
let failures = 0;

function fail(message, hint = '') {
    console.error(`  ✗ ${message}`);
    if (hint) console.error(`    input: ${hint}`);
    failures++;
}

/** Naive inclusive prefix sum. */
function naivePrefixSum(flags, count) {
    const out = new Uint32Array(count);
    let running = 0;
    for (let i = 0; i < count; i++) {
        running += flags[i];
        out[i] = running;
    }
    return out;
}

/** Naive stream compaction. */
function naiveCompact(flags, lods, count) {
    const indices = [];
    const outLods = [];
    for (let i = 0; i < count; i++) {
        if (flags[i] === 1) {
            indices.push(i);
            outLods.push(lods[i]);
        }
    }
    return { indices, outLods };
}

const PATTERNS = [
    { name: 'all-zero', flag: () => 0 },
    { name: 'all-one', flag: () => 1 },
    { name: 'every-3rd', flag: (i) => (i % 3 === 0 ? 1 : 0) },
    { name: 'first-only', flag: (i) => (i === 0 ? 1 : 0) },
    { name: 'last-only', flag: (i, n) => (i === n - 1 ? 1 : 0) },
    { name: 'block-boundary', flag: (i) => (i % 256 === 255 ? 1 : 0) },
];

// Capacity is deliberately larger than count everywhere: the shaders read the
// live count from a uniform, and a padded buffer's stale tail must not leak in.
const COUNTS = [0, 1, 2, 255, 256, 257, 511, 512, 513, 1000, 4096, 65792];

function runPrefixSumAndCompact() {
    console.log('\n══ Path 1–2: prefix_sum + compact ══');

    for (const n of COUNTS) {
        for (const pattern of PATTERNS) {
            const hint = `n=${n} ${pattern.name}`;
            const capacity = n + 137; // padded, with stale data in the tail
            const flags = new Uint32Array(capacity).fill(0xdeadbeef);
            const lods = new Uint32Array(capacity).fill(0xdeadbeef);
            for (let i = 0; i < n; i++) {
                flags[i] = pattern.flag(i, n);
                lods[i] = i % 4;
            }

            const { offsets } = prefixSumChore(flags, n);
            const expectedOffsets = naivePrefixSum(flags, n);

            let ok = true;
            for (let i = 0; i < n; i++) {
                if (offsets[i] !== expectedOffsets[i]) {
                    fail(
                        `prefix_sum ${hint}: offsets[${i}] = ${offsets[i]}, expected ${expectedOffsets[i]}`,
                        hint
                    );
                    ok = false;
                    break;
                }
            }
            if (ok) passes++;

            const expected = naiveCompact(flags, lods, n);
            const result = compactChore(flags, lods, offsets, n, capacity);

            if (result.outCount !== expected.indices.length) {
                fail(
                    `compact ${hint}: count = ${result.outCount}, expected ${expected.indices.length}`,
                    hint
                );
                continue;
            }
            if (result.indirectArgs[1] !== expected.indices.length) {
                fail(
                    `compact ${hint}: indirect instanceCount = ${result.indirectArgs[1]}, ` +
                        `expected ${expected.indices.length}`,
                    hint
                );
                continue;
            }

            let compactOk = true;
            for (let j = 0; j < expected.indices.length; j++) {
                if (result.outIndices[j] !== expected.indices[j]) {
                    fail(
                        `compact ${hint}: outIndices[${j}] = ${result.outIndices[j]}, ` +
                            `expected ${expected.indices[j]}`,
                        hint
                    );
                    compactOk = false;
                    break;
                }
                if (result.outLods[j] !== expected.outLods[j]) {
                    fail(
                        `compact ${hint}: outLods[${j}] = ${result.outLods[j]}, ` +
                            `expected ${expected.outLods[j]}`,
                        hint
                    );
                    compactOk = false;
                    break;
                }
            }
            if (compactOk) passes++;
        }
    }

    console.log(`  ✓ ${COUNTS.length} counts × ${PATTERNS.length} patterns`);
}

function runReduceF32() {
    console.log('\n══ Path 3: reduce_f32 ══');

    const TOL = 1e-3;
    for (const n of COUNTS) {
        const capacity = n + 137;
        const values = new Float32Array(capacity).fill(1e9); // stale tail
        let naive = 0;
        for (let i = 0; i < n; i++) {
            // Deterministic, mixed-sign, non-uniform magnitudes.
            const v = Math.fround(Math.sin(i * 0.37) * (1 + (i % 7)));
            values[i] = v;
            naive += v;
        }

        const got = reduceF32Chore(values, n);
        const delta = Math.abs(got - naive);
        if (delta > TOL || Number.isNaN(delta)) {
            fail(`reduce_f32 n=${n}: got ${got}, expected ≈ ${naive}, |Δ| = ${delta}`, `n=${n}`);
        } else {
            passes++;
        }
    }

    console.log(`  ✓ ${COUNTS.length} counts (tol ${TOL})`);
}

console.log('Shared GPU chores parity harness (#1597)');
console.log('Mirror: tests/parity/refs/gpu-chores.mjs ↔ src/compute/chores/gpu-chores-wgsl.ts');

runPrefixSumAndCompact();
runReduceF32();

console.log('\n────────────────────────────────────────');
console.log(`Result: ${passes} PASS, ${failures} FAIL`);
if (failures > 0) process.exit(1);
console.log('GPU chores harness green.');
