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

// Inline JS core (mirror ground-height-core.ts — no TS import in node test)
const LAKE_BOUNDS = { minX: -38, maxX: 78, minZ: -28, maxZ: 68 };
const LAKE_BOTTOM = -2.0;
const LAKE_ISLAND = { centerX: 20, centerZ: 20, radius: 12, peakHeight: 3.0, falloffRadius: 4, enabled: true };
const LAKE_ISLAND_RADIUS_SQ = LAKE_ISLAND.radius * LAKE_ISLAND.radius;

function rawTerrain(x, z) {
    if (Number.isNaN(x) || Number.isNaN(z)) return 0;
    return Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 +
        Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3;
}

function applyPlatformOverride(x, z, terrainHeight, platforms) {
    let best = terrainHeight;
    for (const p of platforms) {
        if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
        if (p.maxY > best) best = p.maxY;
    }
    return best;
}

function applyLakeModifiers(x, z, height) {
    if (x <= LAKE_BOUNDS.minX || x >= LAKE_BOUNDS.maxX || z <= LAKE_BOUNDS.minZ || z >= LAKE_BOUNDS.maxZ) {
        return height;
    }
    if (LAKE_ISLAND.enabled) {
        const dx = x - LAKE_ISLAND.centerX;
        const dz = z - LAKE_ISLAND.centerZ;
        const distSq = dx * dx + dz * dz;
        if (distSq < LAKE_ISLAND_RADIUS_SQ) {
            const dist = Math.sqrt(distSq);
            const normalizedDist = dist / LAKE_ISLAND.radius;
            const islandHeight = LAKE_ISLAND.peakHeight * Math.cos(normalizedDist * Math.PI / 2);
            const edgeDist = LAKE_ISLAND.radius - dist;
            const edgeBlend = Math.min(1.0, edgeDist / LAKE_ISLAND.falloffRadius);
            const finalIslandHeight = 1.5 + islandHeight * edgeBlend;
            return Math.max(height, finalIslandHeight);
        }
    }
    const distX = Math.min(x - LAKE_BOUNDS.minX, LAKE_BOUNDS.maxX - x);
    const distZ = Math.min(z - LAKE_BOUNDS.minZ, LAKE_BOUNDS.maxZ - z);
    const distEdge = Math.min(distX, distZ);
    const blend = Math.min(1.0, distEdge / 10.0);
    const targetHeight = height + (LAKE_BOTTOM - height) * blend;
    return targetHeight < height ? targetHeight : height;
}

function jsUnified(x, z, now, platforms) {
    let h = rawTerrain(x, z);
    h = applyPlatformOverride(x, z, h, platforms);
    h = applyLakeModifiers(x, z, h);
    return h;
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
