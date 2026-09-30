/**
 * Parity + microbench: JS core vs AssemblyScript unified ground height.
 * Run: node tests/ground-unified-parity.mjs
 * Requires: pnpm run build:wasm first.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

import { getUnifiedGroundHeightTyped } from '../src/systems/physics/physics-math.ts';

import { registerWalkableIslandPlatform } from '../src/systems/ground-system.ts';
function jsUnified(x, z, now, platforms) {
    return getUnifiedGroundHeightTyped(x, z, now);
}

// We need to register the platforms in JS too, since the original code did applyPlatformOverride
const testPlatforms = [
    { minX: 5, maxX: 15, minZ: 5, maxZ: 15, maxY: 12.0 },
];
// Mock THREE.Object3D shape to register them in ground-system
for (let i = 0; i < testPlatforms.length; i++) {
    const p = testPlatforms[i];
    // registerWalkableIslandPlatform takes islandRadius. The bounds are minX = cx - r*0.9
    // so r*0.9 = 5 => r = 5.5555
    registerWalkableIslandPlatform({
        uuid: 'test_platform_' + i,
        position: { x: (p.minX + p.maxX)/2, y: p.maxY, z: (p.minZ + p.maxZ)/2 },
        userData: { isWalkable: true, islandRadius: 5 / 0.9 }
    });
}

// Load AS WASM
const wasmPath = join(root, 'src/wasm/candy_physics.wasm');
const wasmBytes = readFileSync(wasmPath);

const importObject = {
    env: {
        abort: () => { throw new Error('WASM abort'); },
        seed: () => Date.now(),
        now: () => Date.now(),
    },
};

const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
const exports = instance.exports;

const required = ['getUnifiedGroundHeight', 'batchUnifiedGroundHeight', 'clearGroundPlatforms', 'addGroundPlatform', 'invalidateGroundCache'];
for (const name of required) {
    if (typeof exports[name] !== 'function') {
        console.error(`Missing export: ${name}`);
        process.exit(1);
    }
}

const platforms = [
    { minX: 5, maxX: 15, minZ: 5, maxZ: 15, maxY: 12.0 },
];

exports.clearGroundPlatforms();
for (const p of platforms) {
    exports.addGroundPlatform(p.minX, p.maxX, p.minZ, p.maxZ, p.maxY);
}
exports.invalidateGroundCache();

const samples = [
    [0, 0], [10, 10], [20, 20], [50, 30], [-60, -40],
    [5.5, 5.5], [14.9, 14.9], [-10, 25], [30, -15], [100, -100],
];

let passed = 0;
let failed = 0;
const now = performance.now();

console.log('Ground unified parity (JS vs AS WASM)');
for (const [x, z] of samples) {
    const js = jsUnified(x, z, now, platforms);
    const wasm = exports.getUnifiedGroundHeight(x, z, now);
    const ok = Math.abs(js - wasm) < 0.001;
    if (ok) {
        console.log(`  ✓ (${x}, ${z}) js=${js.toFixed(4)} wasm=${wasm.toFixed(4)}`);
        passed++;
    } else {
        console.error(`  ✗ (${x}, ${z}) js=${js} wasm=${wasm} diff=${Math.abs(js - wasm)}`);
        failed++;
    }
}

// Batch parity (use fixed memory offsets — no allocator in node smoke)
const positions = new Float32Array(samples.flat());
const count = samples.length;
const mem = exports.memory;
const inOff = 65536;
const outOff = inOff + positions.length * 4;
const f32 = new Float32Array(mem.buffer);
f32.set(positions, inOff / 4);
exports.batchUnifiedGroundHeight(inOff, count, outOff, now);
const batchOut = f32.subarray(outOff / 4, outOff / 4 + count);

for (let i = 0; i < count; i++) {
    const [x, z] = samples[i];
    const js = jsUnified(x, z, now, platforms);
    const wasm = batchOut[i];
    const ok = Math.abs(js - wasm) < 0.001;
    if (ok) passed++;
    else {
        console.error(`  ✗ batch[${i}] js=${js} wasm=${wasm}`);
        failed++;
    }
}
console.log(`Batch parity: ${count} samples checked`);

// Microbench
const BENCH_N = 50000;
exports.invalidateGroundCache();
const t0 = performance.now();
for (let i = 0; i < BENCH_N; i++) {
    const x = (i % 200) - 100;
    const z = ((i * 7) % 200) - 100;
    exports.getUnifiedGroundHeight(x, z, now);
}
const wasmMs = performance.now() - t0;

const t1 = performance.now();
for (let i = 0; i < BENCH_N; i++) {
    const x = (i % 200) - 100;
    const z = ((i * 7) % 200) - 100;
    jsUnified(x, z, now, platforms);
}
const jsMs = performance.now() - t1;

console.log(`\nMicrobench (${BENCH_N} queries, cold cache per path):`);
console.log(`  AS WASM: ${wasmMs.toFixed(1)} ms (${(BENCH_N / wasmMs * 1000).toFixed(0)} q/s)`);
console.log(`  JS core: ${jsMs.toFixed(1)} ms (${(BENCH_N / jsMs * 1000).toFixed(0)} q/s)`);
console.log(`  Speedup: ${(jsMs / wasmMs).toFixed(2)}x`);

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
