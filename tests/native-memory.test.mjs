/**
 * Native-layer memory safety, against the real AssemblyScript build.
 *
 *  - malloc'd blocks sit above every fixed region and survive heavy use;
 *  - boids never reach native code with pointer 0, and a JS-backed slab never
 *    writes into AS memory;
 *  - NativeF32 views follow memory.grow instead of going stale;
 *  - a failed (or hung) Emscripten instantiate rejects, so MT falls back to
 *    ST and then to JS within 5 s instead of hanging boot.
 *
 * Run: npm run test:native-memory   (requires npm run build:wasm)
 */
import assert from 'node:assert/strict';

// --- Minimal browser surface for the loader modules ------------------------
globalThis.window = globalThis.window ?? globalThis;
globalThis.document = globalThis.document ?? {
    getElementById: () => null,
    baseURI: 'http://localhost/',
};
globalThis.location = globalThis.location ?? { search: '', href: 'http://localhost/' };

const { computeLayout } = await import('../scripts/memory-layout.mjs');
const layout = computeLayout();

let passed = 0;
async function test(name, fn) {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

console.log('native memory');

const loader = await import('../src/utils/wasm-loader-core.ts');
const nativeMemory = await import('../src/utils/native-memory.ts');
const boids = await import('../src/systems/fauna/boids-bridge.ts');
const { FAUNA_BOID_STRIDE } = await import('../src/systems/fauna/types.ts');
const { createNativeModule, firstNativeModule } =
    await import('../src/utils/native-instantiate.ts');

const instance = loader.getWasmInstance();
assert.ok(instance, 'AS module failed to load; run npm run build:wasm');
const exports = instance.exports;
const heapBase = exports.getHeapBase();

await test('heap base is above the generated layout', () => {
    assert.ok(heapBase >= layout.end, `heap base ${heapBase} < layout end ${layout.end}`);
    assert.equal(nativeMemory.hasAsAllocator(), true);
});

await test('asMalloc blocks are above every fixed region and freeable', () => {
    const ptrs = [];
    for (let i = 0; i < 200; i++) {
        const p = nativeMemory.asMalloc(64 + i);
        assert.ok(p >= heapBase, `block ${i} at ${p} below heap base ${heapBase}`);
        ptrs.push(p);
    }
    ptrs.forEach((p) => nativeMemory.asFree(p));
    assert.equal(nativeMemory.asMalloc(0), 0);
    nativeMemory.asFree(0);
});

await test('boids slab is AS-owned, non-null, and above the fixed regions', () => {
    assert.ok(loader.wasmUpdateBoids, 'updateBoids export missing');
    const buffer = boids.allocateBoidsBuffer(32);
    assert.equal(buffer.backend, 'as');
    assert.ok(buffer.ptr >= heapBase, `boids ptr ${buffer.ptr} below heap base`);
    assert.equal(buffer.view.length, 32 * FAUNA_BOID_STRIDE);

    for (let i = 0; i < 32; i++) {
        const b = i * FAUNA_BOID_STRIDE;
        buffer.view[b] = (i % 8) * 4 - 16;
        buffer.view[b + 2] = Math.floor(i / 8) * 4 - 16;
        buffer.view[b + 3] = 1;
    }
    // Fixed regions plus the gap up to --memoryBase (static data and the shadow
    // stack live between memoryBase and the heap base, and the stack is scratch).
    const low = new Uint8Array(exports.memory.buffer, 0, layout.heapBaseFloor).slice();
    boids.updateBoidsBatch(buffer, 32, 0.016, 100, 100, 1);
    assert.deepEqual(
        new Uint8Array(exports.memory.buffer, 0, layout.heapBaseFloor),
        low,
        'native boids step wrote into the fixed regions'
    );
    assert.notEqual(buffer.view[3], 1, 'native step did not run on the slab');
    boids.freeBoidsBuffer(buffer);
});

await test('JS-backed boids never write into AS memory (no ptr 0 native call)', () => {
    const slab = new Float32Array(16 * FAUNA_BOID_STRIDE);
    for (let i = 0; i < 16; i++) slab[i * FAUNA_BOID_STRIDE + 3] = 1;
    const buffer = new boids.BoidsBuffer('as', null, slab); // ptr 0, even if mislabelled
    assert.equal(buffer.ptr, 0);

    const before = new Uint8Array(exports.memory.buffer).slice(0, layout.end + 4096);
    boids.updateBoidsBatch(buffer, 16, 0.016, 0, 0, 1);
    const after = new Uint8Array(exports.memory.buffer, 0, layout.end + 4096);
    assert.deepEqual(after, before, 'ptr-0 slab reached native updateBoids');
    assert.notEqual(slab[3], 1, 'JS fallback did not step the slab');
});

await test('NativeF32 re-derives its view after memory.grow', () => {
    const block = nativeMemory.asAllocF32(8);
    block.view.set([1, 2, 3, 4, 5, 6, 7, 8]);
    const stale = block.view;
    exports.memory.grow(1);
    assert.equal(stale.length, 0, 'expected the old view to be detached');
    assert.deepEqual(Array.from(block.view), [1, 2, 3, 4, 5, 6, 7, 8]);
    loader.refreshWasmViews();
    assert.equal(loader.positionView.buffer, exports.memory.buffer);
    nativeMemory.asFree(block.ptr);
});

await test('emHeapF32 works without an exported HEAPF32', () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const heap = nativeMemory.emHeapF32({ wasmMemory: memory });
    assert.equal(heap.buffer, memory.buffer);
    memory.grow(1);
    assert.equal(nativeMemory.emHeapF32({ wasmMemory: memory }).length, (2 * 65536) / 4);
    assert.equal(nativeMemory.emHeapF32(null), null);
});

// --- Emscripten instantiate failure handling --------------------------------

/** Emscripten-like factory: resolves only once the hook's success callback runs. */
function fakeFactory(name) {
    return (config) =>
        new Promise((resolve) => {
            config.instantiateWasm({}, () => resolve({ name }));
        });
}
const failingInstantiate = async () => {
    throw new Error('CompileError: forced failure');
};
const okInstantiate = async () => ({ instance: {}, module: {} });
const hangingInstantiate = () => new Promise(() => {});

await test('instantiate failure rejects instead of hanging', async () => {
    await assert.rejects(
        createNativeModule(fakeFactory('mt'), {}, failingInstantiate, 60000),
        /forced failure/
    );
});

await test('hung instantiate rejects at the timeout', async () => {
    const t0 = Date.now();
    await assert.rejects(
        createNativeModule(fakeFactory('mt'), {}, hangingInstantiate, 200),
        /did not initialize within 200 ms/
    );
    assert.ok(Date.now() - t0 < 2000);
});

await test('a throwing success callback or factory rejects', async () => {
    const throwingRuntime = (config) =>
        new Promise(() => {
            config.instantiateWasm({}, () => {
                throw new Error('runtime init failed');
            });
        });
    await assert.rejects(
        createNativeModule(throwingRuntime, {}, okInstantiate, 60000),
        /runtime init/
    );
    await assert.rejects(
        createNativeModule(
            () => {
                throw new Error('factory threw');
            },
            {},
            okInstantiate,
            60000
        ),
        /factory threw/
    );
});

await test('forced MT failure falls back to ST, then to JS, within 5 s', async () => {
    const t0 = Date.now();
    const failures = [];
    const viaSt = await firstNativeModule(
        [
            {
                label: 'MT',
                load: () => createNativeModule(fakeFactory('mt'), {}, failingInstantiate),
            },
            { label: 'ST', load: () => createNativeModule(fakeFactory('st'), {}, okInstantiate) },
        ],
        (label) => failures.push(label)
    );
    assert.deepEqual(viaSt, { name: 'st' });
    assert.deepEqual(failures, ['MT']);

    const none = await firstNativeModule([
        { label: 'MT', load: () => createNativeModule(fakeFactory('mt'), {}, failingInstantiate) },
        { label: 'ST', load: () => createNativeModule(fakeFactory('st'), {}, failingInstantiate) },
    ]);
    assert.equal(none, null, 'all native variants failed: caller stays on JS');
    assert.ok(Date.now() - t0 < 5000, `fallback took ${Date.now() - t0} ms`);
});

console.log(`\n✅ ${passed} native-memory tests passed`);
