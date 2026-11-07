/**
 * scripts/check-native-exports.mjs (#2026 slice 1): the parsers and the
 * dead-export / stale-lookup rules, on a fixture tree, then the real tree:
 * the parsed AS ABI must equal the built candy_physics.wasm exports, and the
 * parsed C++ ABI the built candy_native_st.js glue (when build:emcc ran).
 *
 * Run: npm run test:native-exports   (the AS cross-check needs build:wasm)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    analyze,
    asAbi,
    asLookups,
    blankStrings,
    cppAbi,
    cppReferences,
    cppStringLookups,
    keepaliveNames,
    stripComments,
    stripTypeDeclarations,
} from '../scripts/check-native-exports.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const test = (name, fn) => {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
};

console.log('native-exports: parsers');

test('comments go, strings and line count stay', () => {
    const src = "a(); // fbm()\n/* hash()\n */ b('//not a comment');";
    const out = stripComments(src);
    assert.ok(!out.includes('fbm') && !out.includes('hash'));
    assert.ok(out.includes("'//not a comment'"));
    assert.equal(out.split('\n').length, src.split('\n').length);
});

test('interface / type / declare bodies are not references', () => {
    const src = [
        'export interface WasmExports { rbSpawn?: () => void; }',
        'type Fn = { jointCreate: number };',
        'declare global { interface Window { fbm2D: number } }',
        'exports.getGroundHeight(0, 0);',
    ].join('\n');
    const out = stripTypeDeclarations(src);
    assert.ok(!/rbSpawn|jointCreate|fbm2D/.test(out));
    assert.ok(out.includes('getGroundHeight'));
});

test('string blanking keeps bracket keys only', () => {
    const out = blankStrings(`x['keep'] + "exports.txt" + \`t\``);
    assert.ok(out.includes("'keep'"));
    assert.ok(!out.includes('exports.txt'));
});

test('C++ lookups: getNativeFunc, ccall/cwrap, ._name, name tables', () => {
    const code = [
        "getNativeFunc<(x: number) => number>('fastSin');",
        "getNativeFuncVoid('batchShiver_c');",
        "em.ccall('getGroundHeight', 'number', [], []);",
        'M._updatePhysicsCPP(1);',
        "const t = { shiver: 'batchSpring_c' };",
    ].join('\n');
    assert.deepEqual(cppStringLookups(code), ['fastSin', 'batchShiver_c', 'getGroundHeight']);
    const refs = cppReferences(code);
    for (const n of [
        'fastSin',
        'batchShiver_c',
        'getGroundHeight',
        'updatePhysicsCPP',
        'batchSpring_c',
    ]) {
        assert.ok(refs.has(n), n);
    }
});

test("AS lookups: exports.x, exports?.x, (exports as any)['x'], not module.exports", () => {
    const code = [
        'exports.rbSpawn(1);',
        'wasmInstance?.exports?.jointCount();',
        "(instance.exports as any)['processBatchUniversal_c'];",
        'module.exports.notWasm = 1;',
        "console.log('see exports.txt');",
    ].join('\n');
    assert.deepEqual(asLookups(code), ['rbSpawn', 'jointCount', 'processBatchUniversal_c']);
});

test('EMSCRIPTEN_KEEPALIVE on its own line or inline', () => {
    const src =
        'EMSCRIPTEN_KEEPALIVE\nvoid a(int x) {}\nEMSCRIPTEN_KEEPALIVE float* b() {}\n// EMSCRIPTEN_KEEPALIVE\nvoid c() {}';
    assert.deepEqual(keepaliveNames(src), ['a', 'b']);
});

console.log('native-exports: rules (fixture tree)');

const fixtures = [];
function fixture(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-exports-'));
    fixtures.push(dir);
    for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), text);
    }
    return dir;
}

const base = {
    'assembly/index.ts': "export { used, testOnly, unused, LIMIT } from './mod';\n",
    'assembly/mod.ts': [
        'export const LIMIT: i32 = 4;',
        'export function used(): i32 { return 1; }',
        'export function testOnly(): i32 { return 2; }',
        'export function unused(): i32 { return 3; }',
        'export function internal(): i32 { return 4; }',
    ].join('\n'),
    'emscripten/exports.txt': '_main\n_malloc\n_free\n_cppUsed\n_cppDead\n',
    'emscripten/a.cpp':
        'EMSCRIPTEN_KEEPALIVE\nvoid cppUsed() {}\nvoid cppDead() {}\nEMSCRIPTEN_KEEPALIVE\nint cppKeepalive() { return 0; }\n',
    'src/use.ts': [
        'exports.used();',
        "getNativeFunc('cppUsed');",
        "getNativeFunc('cppMissing');",
        "(inst.exports as any)['cppUsed'];",
        '// unused() is only named in a comment',
    ].join('\n'),
    'tests/t.mjs': 'ex.testOnly(); M._cppKeepalive(); exports.LIMIT.value;\n',
};

test('dead, stale and test-only classification', () => {
    const r = analyze(fixture(base));
    assert.deepEqual(r.dead, ['as:unused', 'cpp:cppDead']);
    assert.deepEqual(r.stale, ['as:cppUsed (src/use.ts)', 'cpp:cppMissing (src/use.ts)']);
    assert.deepEqual(r.testOnly, ['as:LIMIT', 'as:testOnly', 'cpp:cppKeepalive']);
});

test('a KEEPALIVE function outside exports.txt is still part of the C++ ABI', () => {
    const abi = cppAbi(fixture(base));
    assert.ok(abi.functions.has('cppKeepalive'));
    assert.ok(!abi.listed.has('cppKeepalive'));
});

test('export * is flagged, and expands for the ABI', () => {
    const abi = asAbi(fixture({ ...base, 'assembly/index.ts': "export * from './mod';\n" }));
    assert.equal(abi.wildcard, true);
    assert.ok(abi.functions.has('internal'));
    assert.ok(abi.values.has('LIMIT'));
});

console.log('native-exports: real tree');

test('the repository is at 0 dead exports and 0 stale lookups', () => {
    const r = analyze(ROOT);
    assert.deepEqual(r.dead, []);
    assert.deepEqual(r.stale, []);
    assert.equal(asAbi(ROOT).wildcard, false);
});

const asWasm = path.join(ROOT, 'src', 'wasm', 'candy_physics.wasm');
if (fs.existsSync(asWasm)) {
    test('parsed AS ABI == candy_physics.wasm exports', () => {
        const exports = WebAssembly.Module.exports(new WebAssembly.Module(fs.readFileSync(asWasm)));
        const abi = asAbi(ROOT);
        const fns = exports
            .filter((e) => e.kind === 'function')
            .map((e) => e.name)
            .sort();
        const globals = exports
            .filter((e) => e.kind === 'global')
            .map((e) => e.name)
            .sort();
        assert.deepEqual(fns, [...abi.functions].sort());
        assert.deepEqual(globals, [...abi.values].sort());
    });
} else {
    console.log('  ⏭ candy_physics.wasm not built (npm run build:wasm); AS cross-check skipped');
}

const glue = path.join(ROOT, 'public', 'candy_native_st.js');
if (fs.existsSync(glue)) {
    test('parsed C++ ABI == candy_native_st.js glue exports', () => {
        const names = new Set(
            [...fs.readFileSync(glue, 'utf8').matchAll(/Module\["_(\w+)"\]/g)].map((m) => m[1])
        );
        for (const core of ['main', 'malloc', 'free']) names.delete(core);
        assert.deepEqual([...names].sort(), [...cppAbi(ROOT).functions].sort());
    });
} else {
    console.log('  ⏭ candy_native_st.js not built (npm run build:emcc); C++ cross-check skipped');
}

for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n✅ ${passed} native-exports tests passed`);
