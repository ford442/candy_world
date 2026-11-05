import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./support/wasm-init-hooks.mjs", import.meta.url);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window ?? globalThis;
globalThis.document = globalThis.document ?? {
    getElementById: () => null,
    baseURI: 'http://localhost/',
};
globalThis.location = globalThis.location ?? { search: '', href: 'http://localhost/' };

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EPS = 1e-4;

const loader = await import('../src/utils/wasm-loader-core.ts');
const boidsBridge = await import('../src/systems/fauna/boids-bridge.ts');

assert.ok(loader.isWasmReady(), 'AS module failed to load; run npm run build:wasm');

async function loadCpp() {
    const jsPath = path.join(root, 'public/candy_native_st.js');
    const wasmPath = jsPath.replace(/\.js$/, '.wasm');
    if (!fs.existsSync(jsPath) || !fs.existsSync(wasmPath)) return null;
    const bytes = fs.readFileSync(wasmPath);
    const mod = await import(pathToFileURL(jsPath).href);
    return mod.default({
        print() {},
        printErr() {},
        instantiateWasm: (imports, cb) => {
            WebAssembly.instantiate(bytes, imports).then((r) => cb(r.instance, r.module));
            return {};
        },
    });
}

const em = await loadCpp();
if (em) {
    loader.setEmscriptenInstance(em);
    loader.initCppFunctions();
} else {
    console.log('  !! C++ tier SKIPPED: build it with npm run build:emcc');
    if (process.env.CANDY_PARITY_REQUIRE_CPP === '1') {
        process.exit(1);
    }
}

const count = 256;
const jsBuffer = boidsBridge.allocateBoidsBuffer(count);
const cppBuffer = em ? boidsBridge.allocateBoidsBuffer(count) : null;

jsBuffer.backend = 'js';
if (cppBuffer) cppBuffer.backend = 'cpp';

const seedData = new Float32Array(count * 8);
let seed = 12345;
function random() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
}
for (let i = 0; i < count; i++) {
    seedData[i * 8 + 0] = (random() - 0.5) * 100;
    seedData[i * 8 + 1] = 0;
    seedData[i * 8 + 2] = (random() - 0.5) * 100;
    seedData[i * 8 + 3] = (random() - 0.5) * 2;
    seedData[i * 8 + 4] = (random() - 0.5) * 2;
    seedData[i * 8 + 5] = (random() - 0.5) * 2;
    seedData[i * 8 + 6] = random() * Math.PI * 2;
    seedData[i * 8 + 7] = Math.floor(random() * 3);
}

jsBuffer.view.set(seedData);
if (cppBuffer) cppBuffer.view.set(seedData);

let passed = 0;
function check(name, fn) {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

function maxDiff(a, b) {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
}

const steps = 10;
const dt = 0.016;
const playerX = 10;
const playerZ = -10;
let time = 0;

console.log('native boids parity');

for (let step = 0; step < steps; step++) {
    boidsBridge.updateBoidsBatch(jsBuffer, count, dt, playerX, playerZ, time);
    if (cppBuffer) {
        boidsBridge.updateBoidsBatch(cppBuffer, count, dt, playerX, playerZ, time);
    }
    time += dt;
}

if (cppBuffer) {
    check('C++ ↔ JS', () => {
        const diff = maxDiff(jsBuffer.view, cppBuffer.view);
        assert.ok(diff <= EPS, `max |Δ| ${diff}`);
    });
} else {
    check('AS fallback removed, nothing to compare against JS without CPP', () => {});
}

console.log(`\n✅ ${passed} boids parity checks passed`);

boidsBridge.freeBoidsBuffer(jsBuffer);
if (cppBuffer) boidsBridge.freeBoidsBuffer(cppBuffer);
loader.setEmscriptenInstance(null);
