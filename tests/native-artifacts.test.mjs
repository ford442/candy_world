/**
 * scripts/check-native-artifacts.mjs: the fail-closed check CI runs after
 * `build:emcc`. It must go red when an artifact is missing, truncated, not
 * WebAssembly, or lacks an export, and green on a complete set. Built from
 * synthetic artifacts, so it needs no emsdk and runs in the PR gate.
 *
 * Run: npm run test:native-artifacts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    checkNativeArtifacts,
    DSP_WASM,
    expectedExports,
    MIN_BYTES,
    TIERS,
} from '../scripts/check-native-artifacts.mjs';
import { dspAbi } from '../scripts/check-native-exports.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-native-artifacts.mjs');

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

// ---- a tiny wasm encoder -----------------------------------------------------
const u32 = (n) => {
    const out = [];
    do {
        let b = n & 0x7f;
        n >>>= 7;
        if (n) b |= 0x80;
        out.push(b);
    } while (n);
    return out;
};
const str = (s) => [...u32(s.length), ...Buffer.from(s)];
const section = (id, body) => [id, ...u32(body.length), ...body];

/** A valid module exporting `fns` as () -> () and, optionally, a memory. */
function wasm({ fns = [], memory = null, padTo = 0 } = {}) {
    const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    if (fns.length) {
        bytes.push(...section(1, [1, 0x60, 0, 0]));
        bytes.push(...section(3, [...u32(fns.length), ...fns.map(() => 0)]));
    }
    if (memory)
        bytes.push(
            ...section(5, [
                1,
                memory.max == null ? 0 : 1,
                memory.min,
                ...(memory.max == null ? [] : [memory.max]),
            ])
        );
    const entries = [
        ...fns.map((n, i) => [...str(n), 0, i]),
        ...(memory ? [[...str('memory'), 2, 0]] : []),
    ];
    if (entries.length) bytes.push(...section(7, [...u32(entries.length), ...entries.flat()]));
    if (fns.length)
        bytes.push(...section(10, [...u32(fns.length), ...fns.flatMap(() => [2, 0, 0x0b])]));
    const buf = Buffer.from(bytes);
    if (buf.length >= padTo) return buf;
    // A custom section is legal anywhere and ignored by the validator: padding.
    const body = Buffer.concat([Buffer.from(str('pad')), Buffer.alloc(padTo - buf.length)]);
    return Buffer.concat([buf, Buffer.from([0, ...u32(body.length)]), body]);
}

const glueFor = (names, pad = MIN_BYTES.glue) =>
    names.map((n) => `Module["_${n}"] = () => 0;`).join('\n') + '\n//' + ' '.repeat(pad);

const dspFns = [...dspAbi(ROOT).functions];
const goodDsp = () =>
    wasm({ fns: dspFns, memory: { min: 1, max: 1 }, padTo: MIN_BYTES.dspWasm + 64 });

/** A complete, sound artifact directory; `mutate(dir)` breaks it. */
function fixture(mutate) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-artifacts-'));
    const names = expectedExports(ROOT);
    for (const t of TIERS) {
        fs.writeFileSync(path.join(dir, t.js), glueFor(names));
        fs.writeFileSync(path.join(dir, t.wasm), wasm({ padTo: MIN_BYTES.nativeWasm + 64 }));
    }
    fs.writeFileSync(path.join(dir, DSP_WASM), goodDsp());
    mutate?.(dir, names);
    return dir;
}
const problemsOf = (dir) => checkNativeArtifacts({ dir, root: ROOT });
const cli = (dir) =>
    spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--no-instantiate'], { encoding: 'utf8' });

console.log('native-artifacts');

test('a complete set of artifacts passes (library and CLI)', () => {
    const dir = fixture();
    assert.deepEqual(problemsOf(dir), []);
    const r = cli(dir);
    assert.equal(r.status, 0, r.stderr);
});

test('no artifacts at all (em++ absent, build.sh exited 0) fails naming all five', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-artifacts-empty-'));
    const problems = problemsOf(dir);
    for (const f of [...TIERS.flatMap((t) => [t.js, t.wasm]), DSP_WASM]) {
        assert.ok(
            problems.some((p) => p.startsWith(`${f} is missing`)),
            `${f} not reported: ${problems.join('; ')}`
        );
    }
    const r = cli(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /candy_native_st\.wasm is missing/);
});

for (const tier of TIERS) {
    test(`a missing ${tier.name} wasm fails`, () => {
        const dir = fixture((d) => fs.rmSync(path.join(d, tier.wasm)));
        assert.deepEqual(problemsOf(dir).length, 1);
        assert.match(problemsOf(dir)[0], new RegExp(`${tier.wasm} is missing`));
        assert.equal(cli(dir).status, 1);
    });

    test(`a missing ${tier.name} glue fails`, () => {
        const dir = fixture((d) => fs.rmSync(path.join(d, tier.js)));
        assert.match(problemsOf(dir).join('\n'), new RegExp(`${tier.js} is missing`));
    });

    test(`a truncated ${tier.name} wasm fails`, () => {
        const dir = fixture((d) => fs.writeFileSync(path.join(d, tier.wasm), wasm()));
        assert.match(problemsOf(dir).join('\n'), /truncated build/);
    });

    test(`a ${tier.name} wasm with bad magic fails`, () => {
        const dir = fixture((d) =>
            fs.writeFileSync(path.join(d, tier.wasm), Buffer.alloc(MIN_BYTES.nativeWasm + 64, 0x41))
        );
        assert.match(problemsOf(dir).join('\n'), /not a WebAssembly binary/);
    });

    test(`a ${tier.name} wasm with a valid header but a corrupt body fails`, () => {
        const dir = fixture((d) => {
            const bad = Buffer.alloc(MIN_BYTES.nativeWasm + 64, 0xff);
            Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).copy(bad);
            fs.writeFileSync(path.join(d, tier.wasm), bad);
        });
        assert.match(problemsOf(dir).join('\n'), /not valid WebAssembly/);
    });

    test(`a ${tier.name} glue missing an exports.txt name fails and names it`, () => {
        const dir = fixture((d, names) =>
            fs.writeFileSync(
                path.join(d, tier.js),
                glueFor(names.filter((n) => n !== 'getGroundHeight'))
            )
        );
        const problems = problemsOf(dir);
        assert.equal(problems.length, 1);
        assert.match(problems[0], new RegExp(`${tier.js} \\(${tier.name}\\) does not export 1 of`));
        assert.match(problems[0], /getGroundHeight/);
    });
}

test('a DSP module that lost a dsp_* export fails', () => {
    const dir = fixture((d) =>
        fs.writeFileSync(
            path.join(d, DSP_WASM),
            wasm({
                fns: dspFns.slice(1),
                memory: { min: 1, max: 1 },
                padTo: MIN_BYTES.dspWasm + 64,
            })
        )
    );
    assert.match(
        problemsOf(dir).join('\n'),
        new RegExp(`${DSP_WASM}: ${dspFns[0]} is EMSCRIPTEN_KEEPALIVE but not exported`)
    );
});

test('a DSP module whose memory can grow fails', () => {
    const dir = fixture((d) =>
        fs.writeFileSync(
            path.join(d, DSP_WASM),
            wasm({ fns: dspFns, memory: { min: 1, max: 4 }, padTo: MIN_BYTES.dspWasm + 64 })
        )
    );
    assert.match(problemsOf(dir).join('\n'), /memory can grow/);
});

test('exports.txt is the list the check reads (not a hand-kept copy)', () => {
    const names = expectedExports(ROOT);
    assert.ok(names.length > 40, `only ${names.length} names`);
    assert.ok(names.includes('getGroundHeight') && names.includes('malloc'));
});

console.log(`native-artifacts: ${passed} passed`);
