#!/usr/bin/env node
/**
 * The linked garden DSP module (public/candy_dsp.wasm) against its contract.
 *
 * AudioWorkletGlobalScope can only run it if it is a standalone module, so
 * this fails the build (emscripten/dsp/build.sh runs it after linking) when:
 *
 *   - it imports anything (the worklet has nothing to give it)
 *   - its function exports are not exactly the EMSCRIPTEN_KEEPALIVE functions
 *     of emscripten/dsp/*.cpp (dspAbi), plus the reactor runtime below
 *   - its memory is shared, missing, or can grow (the worklet's output views
 *     over memory.buffer would detach on growth)
 *
 * Usage: node scripts/check-dsp-wasm.mjs [path/to/candy_dsp.wasm]
 * tests/dsp-render.test.mjs runs the same check on the built file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dspAbi } from './check-native-exports.mjs';

const TAG = 'check-dsp-wasm';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DSP_WASM = path.join(ROOT, 'public', 'candy_dsp.wasm');

/** Exports an Emscripten STANDALONE_WASM reactor adds on its own. */
export const DSP_RUNTIME_EXPORTS = new Set([
    '_initialize',
    '_emscripten_stack_restore',
    'emscripten_stack_get_current',
]);

/** Problems with the module in `bytes` (empty when it meets the contract). */
export function checkDspWasm(bytes, root = ROOT) {
    const problems = [];
    let module;
    try {
        module = new WebAssembly.Module(bytes);
    } catch (err) {
        return [`does not compile: ${err.message}`];
    }

    const imports = WebAssembly.Module.imports(module);
    for (const imp of imports) {
        problems.push(
            `imports ${imp.module}.${imp.name} (${imp.kind}): the worklet provides no imports`
        );
    }

    const moduleExports = WebAssembly.Module.exports(module);
    const fns = new Set(moduleExports.filter((e) => e.kind === 'function').map((e) => e.name));
    const abi = dspAbi(root).functions;
    for (const name of abi) {
        if (!fns.has(name)) problems.push(`${name} is EMSCRIPTEN_KEEPALIVE but not exported`);
    }
    for (const name of fns) {
        if (!abi.has(name) && !DSP_RUNTIME_EXPORTS.has(name)) {
            problems.push(`exports ${name}, which is not a dsp_* EMSCRIPTEN_KEEPALIVE function`);
        }
    }
    for (const name of abi) {
        if (!name.startsWith('dsp_')) problems.push(`${name}: every DSP export is named dsp_*`);
    }

    const memories = moduleExports.filter((e) => e.kind === 'memory');
    if (memories.length !== 1 || memories[0].name !== 'memory') {
        problems.push(`exports ${memories.length} memories; want exactly one named "memory"`);
    } else if (imports.length === 0) {
        const { memory } = new WebAssembly.Instance(module, {}).exports;
        if (
            typeof SharedArrayBuffer !== 'undefined' &&
            memory.buffer instanceof SharedArrayBuffer
        ) {
            problems.push('memory is shared: the module must not need cross-origin isolation');
        }
        let grew = false;
        try {
            memory.grow(1);
            grew = true;
        } catch {
            /* expected: maximum == initial */
        }
        if (grew) problems.push('memory can grow: build with ALLOW_MEMORY_GROWTH=0');
    }
    return problems;
}

function main() {
    const file = path.resolve(process.argv[2] ?? DSP_WASM);
    if (!fs.existsSync(file)) {
        console.error(`❌ [${TAG}] ${path.relative(ROOT, file)} not found (npm run build:dsp)`);
        process.exit(1);
    }
    const problems = checkDspWasm(fs.readFileSync(file));
    if (problems.length) {
        console.error(`❌ [${TAG}] ${path.relative(ROOT, file)} breaks the DSP module contract:`);
        for (const p of problems) console.error(`   - ${p}`);
        process.exit(1);
    }
    console.log(
        `✅ [${TAG}] ${path.relative(ROOT, file)}: no imports, ${dspAbi().functions.size} dsp_* exports, fixed unshared memory`
    );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
