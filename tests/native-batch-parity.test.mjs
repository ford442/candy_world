import { register } from "node:module";


import { pathToFileURL } from "node:url";
register("./support/wasm-init-hooks.mjs", import.meta.url);

/**
 * Batch ground-height parity across C++ ↔ AssemblyScript ↔ JS, driven through
 * the production bridges (src/utils/wasm-physics.ts, wasm-ground.ts).
 *
 * Regression for the C++ batch paths throwing TypeError on `em.HEAPF32.set`
 * (HEAPF32 was never exported) and for getGroundHeightBatch handing AS
 * pointers to the C++ function. The C++ tier also runs with HEAPF32 hidden to
 * prove the bridges no longer depend on it.
 *
 * Run: npm run test:native-batch-parity
 * Requires npm run build:wasm; the C++ tier needs npm run build:emcc and is
 * skipped without it unless CANDY_PARITY_REQUIRE_CPP=1.
 */
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
const physics = await import('../src/utils/wasm-physics.ts');
const ground = await import('../src/utils/wasm-ground.ts');
const { fillUnifiedGroundHeightsJS, invalidateJsGroundCache } =
    await import('../src/systems/ground-height-core.ts');

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

/** Use `em` as the C++ tier (or none), counting calls into its `_batch*` exports. */
function useCpp(em) {
    if (!em) {
        loader.setEmscriptenInstance(null);
        return { batchCalls: () => 0 };
    }
    let calls = 0;
    const tracked = new Proxy(em, {
        get(target, prop) {
            const value = Reflect.get(target, prop);
            if (
                typeof prop === 'string' &&
                prop.startsWith('_batch') &&
                typeof value === 'function'
            ) {
                return (...args) => {
                    calls++;
                    return value(...args);
                };
            }
            return value;
        },
    });
    loader.setEmscriptenInstance(tracked);
    loader.initCppFunctions();
    return { batchCalls: () => calls };
}

function jsTerrain(x, z) {
    if (isNaN(x) || isNaN(z)) return 0;
    return (
        Math.sin(x * 0.05) * 2 +
        Math.cos(z * 0.05) * 2 +
        Math.sin(x * 0.2) * 0.3 +
        Math.cos(z * 0.15) * 0.3
    );
}

function maxDiff(a, b) {
    assert.equal(a.length, b.length);
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
}

// Grid of sample points, including one platform and the world edges.
const N = 3000;
const positions = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
    positions[i * 2] = ((i * 37) % 257) - 128 + (i % 7) * 0.13;
    positions[i * 2 + 1] = ((i * 91) % 257) - 128 - (i % 5) * 0.21;
}
const platforms = [{ minX: 5, maxX: 15, minZ: 5, maxZ: 15, maxY: 12 }];

const tiers = [];
const em = await loadCpp();
if (em) {
    tiers.push({ name: 'C++', em });
    tiers.push({
        name: 'C++ (no HEAPF32)',
        em: new Proxy(em, { get: (t, p) => (p === 'HEAPF32' ? undefined : Reflect.get(t, p)) }),
    });
} else if (process.env.CANDY_PARITY_REQUIRE_CPP === '1') {
    throw new Error(
        'C++ build required (CANDY_PARITY_REQUIRE_CPP=1) but public/candy_native_st.* missing'
    );
} else {
    console.log('  !! C++ tier SKIPPED: build it with npm run build:emcc');
}
tiers.push({ name: 'AS', em: null });

let passed = 0;
function check(name, fn) {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

console.log('native batch parity');

// 1. batchGroundHeight (terrain only) and getGroundHeightBatch
const terrainJs = new Float32Array(N);
for (let i = 0; i < N; i++) terrainJs[i] = jsTerrain(positions[i * 2], positions[i * 2 + 1]);

for (const tier of tiers) {
    check(`batchGroundHeight ${tier.name} ↔ JS`, () => {
        const probe = useCpp(tier.em);
        const out = physics.batchGroundHeight(positions);
        if (tier.em) assert.ok(probe.batchCalls() > 0, 'C++ tier did not run');
        assert.ok(maxDiff(out, terrainJs) <= EPS, `max |Δ| ${maxDiff(out, terrainJs)}`);
        const again = physics.getGroundHeightBatch(positions);
        assert.ok(maxDiff(again, terrainJs) <= EPS, 'getGroundHeightBatch diverged');
    });
}

// 2. fillUnifiedGroundHeights (terrain + platforms + lakes, cached)
invalidateJsGroundCache();
const unifiedJs = new Float32Array(N);
fillUnifiedGroundHeightsJS(positions, unifiedJs, N, 1000, jsTerrain, platforms);

for (const tier of tiers) {
    check(`fillUnifiedGroundHeights ${tier.name} ↔ JS`, () => {
        const probe = useCpp(tier.em);
        ground.syncGroundPlatformsToNative(platforms);
        ground.invalidateNativeGroundCache();
        const out = new Float32Array(N);
        ground.fillUnifiedGroundHeights(positions, out, N, 1000, jsTerrain, platforms);
        if (tier.em) assert.ok(probe.batchCalls() > 0, 'C++ tier did not run');
        assert.ok(maxDiff(out, unifiedJs) <= EPS, `max |Δ| ${maxDiff(out, unifiedJs)}`);
        // Second call reuses the persistent native buffers.
        const out2 = new Float32Array(N / 2);
        ground.fillUnifiedGroundHeights(positions, out2, N / 2, 1000, jsTerrain, platforms);
        assert.ok(maxDiff(out2, unifiedJs.subarray(0, N / 2)) <= EPS, 'buffer reuse diverged');
    });
}

if (em) {
    check('C++ batch path survives memory growth', () => {
        useCpp(em);
        em._malloc(96 << 20); // grow the C++ heap past the cached buffer
        const out = physics.batchGroundHeight(positions);
        assert.ok(maxDiff(out, terrainJs) <= EPS);
    });
}

loader.setEmscriptenInstance(null);
console.log(`\n✅ ${passed} batch parity checks passed`);
