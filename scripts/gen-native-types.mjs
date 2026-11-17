#!/usr/bin/env node
/**
 * Native boundary types, generated (#2166 part B).
 *
 * TS calls into two WASM modules by name. Their signatures used to be written
 * by hand in src/utils/wasm-loader-types.ts, and 20 C++ entries were
 * `(...args: number[]) => …`: a missing or swapped argument compiled, and the
 * C++ side read garbage. This writes src/utils/native-exports.generated.ts
 * from the sources themselves, so tsc checks every call:
 *
 *   C++   every function emscripten/exports.txt or EMSCRIPTEN_KEEPALIVE
 *         exports (the same list check:native-exports reads), parsed from its
 *         definition in emscripten/*.cpp. Scalars map to number (int64 to
 *         bigint), pointers to NativePtr with the pointee in a doc comment.
 *   DSP   every EMSCRIPTEN_KEEPALIVE function of the garden DSP module
 *         (emscripten/dsp/*.cpp, all dsp_*), parsed the same way. The
 *         worklet calls it through a DspExports-typed exports object.
 *   AS    every export of assembly/index.ts, read from the declaration file
 *         asc writes with `--bindings raw` (the compiler's own view of the
 *         ABI; it is a debug compile into a temp dir, about a second).
 *   structs  scripts/native-structs.json: structs JS writes into native
 *         memory and passes by pointer. Each becomes a field spec for
 *         defineNativeStruct() in src/utils/native-memory.ts, so the TS writer
 *         and its offsets come from one definition. A struct with `countsKey`
 *         must have as many fields as that scripts/memory-layout.mjs COUNTS entry.
 *
 * The output holds only types and constant field specs, no export names as
 * strings, so check:native-exports does not read it as a reference.
 *
 * Usage:
 *   npm run gen:native-types            rewrite the generated file
 *   npm run gen:native-types -- --check exit 1 if it is stale (check:native-exports runs this)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cppAbi, dspAbi, stripComments } from './check-native-exports.mjs';
import { COUNTS } from './memory-layout.mjs';

const TAG = 'gen-native-types';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'src', 'utils', 'native-exports.generated.ts');
const STRUCTS = path.join(ROOT, 'scripts', 'native-structs.json');

// -----------------------------------------------------------------------------
// C++
// -----------------------------------------------------------------------------

const SCALARS = new Map([
    ['void', 'void'],
    ['float', 'f32'],
    ['double', 'f64'],
    ['bool', 'bool'],
    ['char', 'i8'],
    ['int8_t', 'i8'],
    ['uint8_t', 'u8'],
    ['short', 'i16'],
    ['int16_t', 'i16'],
    ['uint16_t', 'u16'],
    ['int', 'i32'],
    ['long', 'i32'],
    ['int32_t', 'i32'],
    ['unsigned', 'u32'],
    ['unsigned int', 'u32'],
    ['uint32_t', 'u32'],
    ['size_t', 'usize'],
    ['uintptr_t', 'usize'],
    ['intptr_t', 'isize'],
    ['int64_t', 'i64'],
    ['uint64_t', 'u64'],
    ['long long', 'i64'],
]);
const QUALIFIERS =
    /\b(?:const|volatile|restrict|__restrict__|__restrict|struct|static|inline|extern|EMSCRIPTEN_KEEPALIVE)\b/g;

/**
 * A C++ type spelling as an ABI tag: `f32`, `i32`, `ptr<float>`, … Throws on
 * a type the boundary cannot carry, so a new export with one fails loudly.
 */
export function cppTypeTag(spelling) {
    const t = spelling.replace(/"C"/g, '').replace(QUALIFIERS, ' ').replace(/\s+/g, ' ').trim();
    const stars = (t.match(/\*/g) ?? []).length;
    const base = t.replace(/[*&]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.includes('&'))
        throw new Error(`reference type '${spelling}' cannot cross the wasm boundary`);
    if (stars > 0) return `ptr<${base}${'*'.repeat(stars - 1)}>`;
    const tag = SCALARS.get(base);
    if (!tag) throw new Error(`unknown C++ type '${spelling}'`);
    return tag;
}

/** TS type for an ABI tag. */
export function tsTypeOf(tag) {
    if (tag === 'void') return 'void';
    if (tag.startsWith('ptr<')) return 'NativePtr';
    if (tag === 'i64' || tag === 'u64') return 'bigint';
    return 'number';
}

/** Split a parameter list on top-level commas. */
function splitParams(list) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const c of list) {
        if (c === '(' || c === '<') depth++;
        else if (c === ')' || c === '>') depth--;
        if (c === ',' && depth === 0) {
            out.push(cur);
            cur = '';
        } else cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out.map((p) => p.trim()).filter((p) => p && p !== 'void');
}

/** `const float* positions` → { name: 'positions', type: 'ptr<float>' } */
export function parseParam(text, index) {
    const clean = text.replace(/=.*$/, '').trim();
    const m = clean.match(/^(.*?)([A-Za-z_]\w*)\s*(\[\s*\d*\s*\])?$/);
    let typeText;
    let name;
    if (
        m &&
        /[\w*&]\s*$/.test(m[1]) &&
        m[1].trim() &&
        !SCALARS.has(clean.replace(QUALIFIERS, ' ').trim())
    ) {
        typeText = m[1] + (m[3] ? '*' : '');
        name = m[2];
    } else {
        typeText = clean;
        name = `arg${index}`;
    }
    return { name, type: cppTypeTag(typeText) };
}

/**
 * The definition of `name` in C++ source with comments stripped: return type
 * and parameters. Definitions only (a `{` follows the parameter list), so a
 * forward declaration cannot disagree with the body.
 */
export function findCppDefinition(src, name) {
    const re = new RegExp(
        `(^|[;{}\\n])\\s*((?:EMSCRIPTEN_KEEPALIVE\\s+)?(?:(?:static|inline|extern\\s+"C"|const|unsigned|signed|struct)\\s+)*[A-Za-z_][\\w:]*(?:\\s+[A-Za-z_][\\w:]*)?[\\s*&]+)${name}\\s*\\(([^)]*)\\)\\s*(?:noexcept\\s*)?\\{`,
        'm'
    );
    const m = src.match(re);
    if (!m) return null;
    const ret = m[2].replace(/EMSCRIPTEN_KEEPALIVE/g, '').trim();
    return {
        ret: cppTypeTag(ret),
        params: splitParams(m[3]).map(parseParam),
    };
}

/** Signatures of `names`, from the definitions in `dir`/*.cpp (`file` is relative to emscripten/). */
function signaturesIn(dir, prefix, names) {
    const files = fs.existsSync(dir)
        ? fs
              .readdirSync(dir)
              .filter((f) => f.endsWith('.cpp'))
              .sort()
              .map((f) => ({
                  file: prefix + f,
                  src: stripComments(fs.readFileSync(path.join(dir, f), 'utf8')),
              }))
        : [];
    const sigs = [];
    const missing = [];
    for (const name of [...names].sort()) {
        let found = null;
        for (const { file, src } of files) {
            const def = findCppDefinition(src, name);
            if (def) {
                found = { name, file, ...def };
                break;
            }
        }
        if (found) sigs.push(found);
        else missing.push(name);
    }
    return { sigs, missing };
}

export function cppSignatures(root = ROOT) {
    return signaturesIn(path.join(root, 'emscripten'), '', cppAbi(root).functions);
}

export function dspSignatures(root = ROOT) {
    return signaturesIn(path.join(root, 'emscripten', 'dsp'), 'dsp/', dspAbi(root).functions);
}

// -----------------------------------------------------------------------------
// AssemblyScript
// -----------------------------------------------------------------------------

/** Run asc with --bindings raw into a temp dir and return the .d.ts text. */
export function ascBindings(root = ROOT) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'candy-asc-bindings-'));
    try {
        const asc = path.join(root, 'node_modules', '.bin', 'asc');
        execFileSync(
            asc,
            [
                path.join(root, 'assembly', 'index.ts'),
                '--outFile',
                path.join(tmp, 'abi.wasm'),
                '--bindings',
                'raw',
                '--enable',
                'bulk-memory',
                '--memoryBase',
                '589824',
                '--initialMemory',
                '16',
                '--maximumMemory',
                '256',
            ],
            { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        return fs.readFileSync(path.join(tmp, 'abi.d.ts'), 'utf8');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

/** Functions and globals from asc's raw bindings declaration file. */
export function parseAscBindings(dts) {
    const body = dts.slice(dts.indexOf('declare namespace __AdaptedExports'));
    const functions = [];
    const globals = [];
    const re =
        /\/\*\*([\s\S]*?)\*\/\s*export (?:function (\w+)\(([^)]*)\):\s*([\w.]+);|const (\w+):\s*\{[\s\S]*?\/\*\* @type `(\w+)` \*\/)/g;
    for (const m of body.matchAll(re)) {
        const doc = m[1];
        if (m[2]) {
            const tags = [...doc.matchAll(/@param (\w+) `(\w+)`/g)].map((t) => [t[1], t[2]]);
            const tagOf = new Map(tags);
            const params = m[3]
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean)
                .map((p) => {
                    const [n, t] = p.split(':').map((s) => s.trim());
                    return { name: n, type: tagOf.get(n) ?? t, ts: t };
                });
            const ret = doc.match(/@returns `(\w+)`/)?.[1] ?? 'void';
            functions.push({ name: m[2], params, ret, retTs: m[4] });
        } else {
            globals.push({ name: m[5], type: m[6] });
        }
    }
    return { functions, globals };
}

// -----------------------------------------------------------------------------
// Structs
// -----------------------------------------------------------------------------

const FIELD_TYPES = new Set(['f32', 'i32', 'u32', 'ptr']);

export function loadStructs(file = STRUCTS, counts = COUNTS) {
    if (!fs.existsSync(file)) return [];
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Object.entries(json.structs ?? {}).map(([name, spec]) => {
        const fields = Object.entries(spec.fields ?? {});
        if (!fields.length) throw new Error(`struct ${name} has no fields`);
        for (const [f, t] of fields) {
            if (!FIELD_TYPES.has(t)) {
                throw new Error(
                    `${name}.${f}: field type '${t}' (use ${[...FIELD_TYPES].join(', ')})`
                );
            }
        }
        if (spec.countsKey !== undefined) {
            const want = counts[spec.countsKey];
            if (want === undefined)
                throw new Error(`${name}: COUNTS.${spec.countsKey} does not exist`);
            if (want !== fields.length) {
                throw new Error(
                    `${name} has ${fields.length} fields but scripts/memory-layout.mjs COUNTS.${spec.countsKey} is ${want}`
                );
            }
        }
        return {
            name,
            doc: [spec.doc, spec.reader && `Read by ${spec.reader}.`].filter(Boolean).join(' '),
            fields,
        };
    });
}

// -----------------------------------------------------------------------------
// Emit
// -----------------------------------------------------------------------------

function emitParams(params) {
    return params.map((p) => `${p.name}: ${p.ts ?? tsTypeOf(p.type)}`).join(', ');
}

export function render({ cpp, dsp = [], as, structs }) {
    const L = [];
    L.push(
        '// GENERATED by scripts/gen-native-types.mjs from emscripten/*.cpp, emscripten/dsp/*.cpp,',
        '// assembly/index.ts (asc --bindings raw) and scripts/native-structs.json. Do not edit by hand:',
        '// change the native source and run `npm run gen:native-types`.',
        '// `npm run check:native-exports` fails while this file is stale.',
        '',
        "/** A byte offset into a module's linear memory. */",
        'export type NativePtr = number;',
        '',
        '/** Every function the C++ module exports, by its C name (no leading `_`). */',
        'export interface CppExports {'
    );
    for (const s of cpp) {
        L.push(
            `    /** emscripten/${s.file}: \`${s.ret} ${s.name}(${s.params.map((p) => `${p.type} ${p.name}`).join(', ')})\` */`
        );
        L.push(`    ${s.name}: (${emitParams(s.params)}) => ${tsTypeOf(s.ret)};`);
    }
    L.push('}', '', 'export type CppExportName = keyof CppExports;', '');
    L.push(
        '/** The same functions as the Emscripten module object carries them (`_name`). */',
        'export type CppModuleExports = { [K in CppExportName as `_${K}`]: CppExports[K] };',
        ''
    );
    L.push(
        '/** Every function the garden DSP module exports (emscripten/dsp/, public/candy_dsp.wasm). */',
        'export interface DspExports {'
    );
    for (const s of dsp) {
        L.push(
            `    /** emscripten/${s.file}: \`${s.ret} ${s.name}(${s.params.map((p) => `${p.type} ${p.name}`).join(', ')})\` */`
        );
        L.push(`    ${s.name}: (${emitParams(s.params)}) => ${tsTypeOf(s.ret)};`);
    }
    L.push('}', '', 'export type DspExportName = keyof DspExports;', '');
    L.push(
        '/** Every function the AssemblyScript module exports (assembly/index.ts). */',
        'export interface AsExports {'
    );
    for (const f of as.functions) {
        L.push(
            `    /** \`${f.name}(${f.params.map((p) => `${p.name}: ${p.type}`).join(', ')}): ${f.ret}\` */`
        );
        L.push(`    ${f.name}: (${emitParams(f.params)}) => ${f.retTs};`);
    }
    L.push('}', '', 'export type AsExportName = keyof AsExports;', '');
    L.push(
        '/** Every global the AssemblyScript module exports; read with `.value`. */',
        'export interface AsGlobals {'
    );
    for (const g of as.globals)
        L.push(`    /** \`${g.type}\` */`, `    ${g.name}: WebAssembly.Global;`);
    L.push('}', '');
    L.push(
        '/**',
        ' * Structs JS writes into native memory and passes by pointer',
        ' * (scripts/native-structs.json). Pass one to defineNativeStruct()',
        ' * (src/utils/native-memory.ts); every field is 4 bytes, in this order.',
        ' */',
        'export const NATIVE_STRUCTS = {'
    );
    for (const s of structs) {
        if (s.doc) L.push(`    /** ${s.doc} */`);
        L.push(`    ${s.name}: {`);
        for (const [f, t] of s.fields) L.push(`        ${f}: '${t}',`);
        L.push('    },');
    }
    L.push('} as const;');
    L.push('');
    return L.join('\n');
}

export async function generate(root = ROOT) {
    const { sigs, missing } = cppSignatures(root);
    const dsp = dspSignatures(root);
    missing.push(...dsp.missing);
    if (missing.length) {
        throw new Error(
            `no C++ definition found for: ${missing.join(', ')}. Every exported function needs a ` +
                'definition (with a body) in emscripten/*.cpp or emscripten/dsp/*.cpp.'
        );
    }
    const as = parseAscBindings(ascBindings(root));
    const text = render({
        cpp: sigs,
        dsp: dsp.sigs,
        as,
        structs: loadStructs(path.join(root, 'scripts', 'native-structs.json')),
    });
    // Format like the rest of src/ (the pre-commit hook would otherwise rewrite it).
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(OUT)) ?? {};
    return prettier.format(text, { ...options, filepath: OUT });
}

async function main() {
    const check = process.argv.includes('--check');
    let text;
    try {
        text = await generate();
    } catch (err) {
        console.error(`❌ [${TAG}] ${err.message}`);
        process.exit(1);
    }
    const rel = path.relative(ROOT, OUT);
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (check) {
        if (current !== text) {
            console.error(
                `❌ [${TAG}] ${rel} is stale: the native signatures changed.\n` +
                    '   Run `npm run gen:native-types` and commit the result.'
            );
            process.exit(1);
        }
        console.log(`✅ [${TAG}] ${rel} matches the native sources.`);
        return;
    }
    fs.writeFileSync(OUT, text);
    console.log(`[${TAG}] wrote ${rel}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
