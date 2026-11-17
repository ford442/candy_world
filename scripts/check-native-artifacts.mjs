#!/usr/bin/env node
/**
 * Fail-closed check of the built native tier (`npm run build:emcc` output).
 *
 * `emscripten/build.sh` and `emscripten/dsp/build.sh` exit 0 when em++ is not on
 * PATH (they remove stale artifacts and let the app fall back to JS), and
 * `build.sh` ignores a failing post-build verify. That is right for a developer
 * without emsdk and wrong for CI, where "the toolchain was there" is the
 * premise: a broken emsdk step must not read as green. Run this right after
 * `build:emcc` wherever the toolchain is required (emscripten-verify.yml).
 *
 * It asserts, for each of the five artifacts:
 *   - candy_native.{js,wasm}     (threaded)         exist, non-trivial size
 *   - candy_native_st.{js,wasm}  (single-threaded)  exist, non-trivial size
 *   - candy_dsp.wasm             (garden DSP)       exists, meets its contract
 * and that
 *   - both .wasm files are valid WebAssembly (magic + WebAssembly.validate)
 *   - both .js glue files expose Module["_<name>"] for every name in
 *     emscripten/exports.txt. The glue is checked, not the raw wasm export
 *     table: at -O2 emcc minifies wasm export names and the glue maps them
 *     back, so Module._<name> is the contract callers see.
 *   - the single-threaded module instantiates in Node and each of those names
 *     is a function on it (the threaded one needs workers and COOP/COEP, so
 *     test:native-omp-regions runs it in Chromium instead).
 *
 * Usage:
 *   node scripts/check-native-artifacts.mjs                 # public/, with instantiate
 *   node scripts/check-native-artifacts.mjs --no-instantiate
 *   node scripts/check-native-artifacts.mjs --dir <dir>     # artifacts elsewhere
 *
 * Exit: 0 all present and sound, 1 any problem (each printed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkDspWasm } from './check-dsp-wasm.mjs';

const TAG = 'check-native-artifacts';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Smallest plausible sizes: a truncated or empty file is a failed build. */
export const MIN_BYTES = { glue: 4096, nativeWasm: 16384, dspWasm: 4096 };

export const TIERS = [
    { name: 'threaded', js: 'candy_native.js', wasm: 'candy_native.wasm' },
    { name: 'single-threaded', js: 'candy_native_st.js', wasm: 'candy_native_st.wasm' },
];
export const DSP_WASM = 'candy_dsp.wasm';

/** Names in emscripten/exports.txt without the leading underscore. */
export function expectedExports(root = ROOT) {
    return fs
        .readFileSync(path.join(root, 'emscripten', 'exports.txt'), 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/^_/, ''))
        .filter(Boolean);
}

function readArtifact(dir, file, minBytes, problems) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) {
        problems.push(`${file} is missing (build:emcc skipped it, or em++ was not on PATH)`);
        return null;
    }
    const bytes = fs.readFileSync(p);
    if (bytes.length < minBytes) {
        problems.push(
            `${file} is ${bytes.length} bytes, under the ${minBytes}-byte floor: truncated build`
        );
        return null;
    }
    return bytes;
}

/**
 * Static problems with the artifacts in `dir` (empty when sound).
 * `minBytes` overrides MIN_BYTES for fixtures.
 */
export function checkNativeArtifacts({ dir, root = ROOT, minBytes = MIN_BYTES } = {}) {
    const problems = [];
    const expected = expectedExports(root);

    for (const tier of TIERS) {
        const glue = readArtifact(dir, tier.js, minBytes.glue, problems);
        const wasm = readArtifact(dir, tier.wasm, minBytes.nativeWasm, problems);

        if (glue) {
            const exposed = new Set(
                [...glue.toString('utf8').matchAll(/Module\["_(\w+)"\]/g)].map((m) => m[1])
            );
            const missing = expected.filter((n) => !exposed.has(n));
            if (missing.length) {
                problems.push(
                    `${tier.js} (${tier.name}) does not export ${missing.length} of ${expected.length} ` +
                        `exports.txt names: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}`
                );
            }
        }
        if (wasm) {
            if (wasm.length < 4 || wasm.readUInt32BE(0) !== 0x0061736d) {
                problems.push(
                    `${tier.wasm} (${tier.name}) is not a WebAssembly binary (bad magic)`
                );
            } else if (!WebAssembly.validate(wasm)) {
                problems.push(`${tier.wasm} (${tier.name}) is not valid WebAssembly`);
            }
        }
    }

    const dsp = readArtifact(dir, DSP_WASM, minBytes.dspWasm, problems);
    if (dsp) {
        for (const p of checkDspWasm(dsp, root)) problems.push(`${DSP_WASM}: ${p}`);
    }
    return problems;
}

/**
 * Load the single-threaded module the way tests/character-controller-native
 * does (Node's fetch cannot read file://, so the bytes go in through
 * instantiateWasm) and return the names that are not callable on it.
 */
export async function missingRuntimeExports({ dir, root = ROOT }) {
    const mod = await import(pathToFileURL(path.join(dir, 'candy_native_st.js')).href);
    const bytes = fs.readFileSync(path.join(dir, 'candy_native_st.wasm'));
    const em = await mod.default({
        instantiateWasm(imports, done) {
            WebAssembly.instantiate(bytes, imports).then(({ instance, module }) =>
                done(instance, module)
            );
            return {};
        },
    });
    return expectedExports(root).filter((n) => typeof em[`_${n}`] !== 'function');
}

async function main() {
    const args = process.argv.slice(2);
    const dirIdx = args.indexOf('--dir');
    const dir = dirIdx >= 0 ? path.resolve(args[dirIdx + 1] ?? '') : path.join(ROOT, 'public');
    const instantiate = !args.includes('--no-instantiate');

    const problems = checkNativeArtifacts({ dir });

    const stLoadable =
        fs.existsSync(path.join(dir, 'candy_native_st.js')) &&
        fs.existsSync(path.join(dir, 'candy_native_st.wasm'));
    if (instantiate && stLoadable && problems.length === 0) {
        try {
            const missing = await Promise.race([
                missingRuntimeExports({ dir }),
                new Promise((_, rej) =>
                    setTimeout(
                        () => rej(new Error('instantiate timed out after 30 s')),
                        30_000
                    ).unref()
                ),
            ]);
            if (missing.length) {
                problems.push(
                    `candy_native_st instantiated but ${missing.length} exports are not functions: ${missing.join(', ')}`
                );
            }
        } catch (err) {
            problems.push(`candy_native_st does not instantiate in Node: ${err?.message ?? err}`);
        }
    }

    if (problems.length) {
        console.error(`[${TAG}] FAIL (${dir})`);
        for (const p of problems) console.error(`  - ${p}`);
        process.exit(1);
    }
    console.log(
        `[${TAG}] ok: ${TIERS.map((t) => t.name).join(' + ')} + DSP present, valid, ` +
            `${expectedExports().length} exports each${instantiate ? ', ST instantiates' : ''}`
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error(`[${TAG}] ${err?.stack ?? err}`);
        process.exit(1);
    });
}
