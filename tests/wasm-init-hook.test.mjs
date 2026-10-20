/**
 * The `.wasm?init` test hook must keep Vite's semantics under tsx.
 *
 * On Node 24, tsx installs in-thread hooks (`module.registerHooks`) that run
 * before tests/support/wasm-init-hooks.mjs: they strip `?init` before our
 * resolve sees the specifier and re-attach it afterwards. When the hook keyed
 * on `?init` in resolve, css-hooks stubbed the binary to `{}` and every
 * native test failed with "initCandyPhysics is not a function" (#1981 onward).
 *
 * Run: tsx --import ./tests/support/register-wasm-hooks.mjs tests/wasm-init-hook.test.mjs
 *      (requires npm run build:wasm)
 */
import assert from 'node:assert/strict';
import module from 'node:module';

globalThis.window = globalThis.window ?? globalThis;
globalThis.document = globalThis.document ?? {
    getElementById: () => null,
    baseURI: 'http://localhost/',
};
globalThis.location = globalThis.location ?? { search: '', href: 'http://localhost/' };

let passed = 0;
async function test(name, fn) {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

const inThreadHooks = typeof module.registerHooks === 'function';
console.log(
    `wasm ?init hook (node ${process.version}, in-thread hooks ${inThreadHooks ? 'available' : 'absent'})`
);

await test('`.wasm?init` default export is the instantiate function', async () => {
    const mod = await import('../src/wasm/candy_physics.wasm?init');
    assert.equal(typeof mod.default, 'function', `default export is ${typeof mod.default}`);
});

await test('a bare `.wasm` import is still stubbed', async () => {
    const mod = await import('../src/wasm/candy_physics.wasm');
    assert.deepEqual(mod.default, {});
});

await test('the production loader instantiates through it with the real import object', async () => {
    const loader = await import('../src/utils/wasm-loader-core.ts');
    assert.ok(loader.isWasmReady(), 'AS module failed to load; run npm run build:wasm');
    const { getHeapBase } = loader.wasmInstance.exports;
    assert.equal(typeof getHeapBase, 'function', 'instance does not export getHeapBase');
    assert.ok(getHeapBase() > 0, `getHeapBase() = ${getHeapBase()}`);
});

console.log(`\n✅ ${passed} wasm ?init hook tests passed`);
