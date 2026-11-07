#!/usr/bin/env node
/**
 * Native export ratchet (#2026 slice 1).
 *
 * Both native modules export functions that TS looks up by name, and nothing
 * checked that the two sides agree. This compares them:
 *
 *   dead export    a function the AssemblyScript ABI (assembly/index.ts) or the
 *                  C++ module (emscripten/exports.txt plus every
 *                  EMSCRIPTEN_KEEPALIVE function, which EXPORT_KEEPALIVE=1
 *                  exports too) exports that no file in src/, tests/ or
 *                  scripts/ uses
 *   stale lookup   a name src/ or tests/ asks a module for that the module does
 *                  not export, so the lookup is always null
 *
 * Comments and TS type declarations (interface, type, declare) are stripped
 * first. An AS function is used when its name appears as a word; an AS global
 * only through `exports.NAME`. A C++ export is used only through a C++ lookup,
 * because the two modules share names: getNativeFunc[Void]('x'),
 * ccall/cwrap('x'), a `._x` property, or a string literal 'x' / '_x' (a name
 * table looked up later). Lookups: those C++ forms with a string name, and AS
 * `exports.x` / `exports['x']`. An export only tests or scripts use is allowed
 * (tests keep what they need) and listed with --list.
 *
 * assembly/index.ts must name every export (no `export *`), so the AS ABI is a
 * reviewed list. The word rule cannot tell an AS export from a JS function of
 * the same name (`lerp`, `clamp`): such names read as used, so keep them off
 * the ABI unless TS calls them through `exports`.
 *
 * Ratchet: scripts/native-exports-baseline.json lists the dead exports and
 * stale lookups still allowed. A new one fails. One that is gone also fails,
 * with the command that drops it from the baseline, so the list only shrinks.
 *
 * Usage:
 *   npm run check:native-exports              gate; never writes
 *   npm run check:native-exports -- --update  rewrite the baseline (refuses to grow it)
 *   npm run check:native-exports -- --list    also list exports only tests use
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'native-exports';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts', 'native-exports-baseline.json');
const SELF = path.join(ROOT, 'scripts', 'check-native-exports.mjs');

/** Where references are searched. tests/ and scripts/ count, but are reported as test-only. */
const CORPUS_DIRS = ['src', 'tests', 'scripts'];
/** asc --bindings output (gitignored), and this script and its test, whose fixtures name exports. */
const CORPUS_SKIP = [
    path.join(ROOT, 'src', 'wasm'),
    SELF,
    path.join(ROOT, 'tests', 'native-exports.test.mjs'),
];
const CORPUS_EXT = /\.(?:ts|tsx|js|mjs|cjs)$/;

/** Emscripten runtime exports every module has; not part of our ABI. */
const CPP_CORE = new Set(['main', 'malloc', 'free']);

// -----------------------------------------------------------------------------
// Source text helpers
// -----------------------------------------------------------------------------

/**
 * Remove // and block comments, keeping string and template literals (and the
 * line structure) intact. Regex literals are not special-cased; none in the
 * corpus contains a comment opener.
 */
export function stripComments(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const n = src[i + 1];
        if (c === '/' && n === '/') {
            while (i < src.length && src[i] !== '\n') i++;
        } else if (c === '/' && n === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
                if (src[i] === '\n') out += '\n';
                i++;
            }
            i += 2;
        } else if (c === '"' || c === "'" || c === '`') {
            const start = i++;
            while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
            out += src.slice(start, ++i);
        } else {
            out += c;
            i++;
        }
    }
    return out;
}

/** Index just past the brace block that opens at or after `from`. */
function skipBraces(src, from) {
    let i = src.indexOf('{', from);
    if (i < 0) return src.length;
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return i + 1;
    }
    return src.length;
}

/**
 * Remove TS type declarations: `interface X {…}`, `declare … {…}` and
 * `type X = …;`. A name listed in an exports interface is a type, not a call.
 */
export function stripTypeDeclarations(src) {
    const re =
        /^[ \t]*(?:export[ \t]+)?(?:(interface|declare)\b|type[ \t]+\w+(?:<[^=]*>)?[ \t]*=)/gm;
    let out = '';
    let last = 0;
    for (let m; (m = re.exec(src));) {
        if (m.index < last) continue;
        out += src.slice(last, m.index);
        let end;
        if (m[1]) {
            end = skipBraces(src, m.index);
        } else {
            // type alias: up to the `;` (or blank line) at brace/paren depth 0
            let depth = 0;
            end = re.lastIndex;
            for (; end < src.length; end++) {
                const ch = src[end];
                if ('{(<['.includes(ch)) depth++;
                else if ('})>]'.includes(ch)) depth--;
                else if (depth <= 0 && (ch === ';' || (ch === '\n' && src[end + 1] === '\n')))
                    break;
            }
            end++;
        }
        out += src.slice(m.index, end).replace(/[^\n]/g, '');
        last = end;
        re.lastIndex = end;
    }
    return out + src.slice(last);
}

function walk(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (CORPUS_SKIP.some((s) => full === s || full.startsWith(s + path.sep))) continue;
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walk(full, files);
        } else if (CORPUS_EXT.test(entry.name)) {
            files.push(full);
        }
    }
    return files;
}

/** Code of every corpus file, comments and type declarations stripped. */
export function loadCorpus(root = ROOT) {
    return CORPUS_DIRS.flatMap((d) => walk(path.join(root, d))).map((file) => {
        const rel = path.relative(root, file).split(path.sep).join('/');
        const raw = stripComments(fs.readFileSync(file, 'utf8'));
        const code = /\.tsx?$/.test(file) ? stripTypeDeclarations(raw) : raw;
        return { rel, code, area: rel.startsWith('src/') ? 'src' : 'test' };
    });
}

// -----------------------------------------------------------------------------
// The two ABIs
// -----------------------------------------------------------------------------

/**
 * Exports of an AssemblyScript module as name → 'function' | 'value',
 * following `export *`, `export { a as b } from`, and local `export { a }`.
 */
export function asModuleExports(file, seen = new Map()) {
    if (seen.has(file)) return seen.get(file);
    const exports = new Map();
    seen.set(file, exports);
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    const resolve = (spec) => {
        const base = path.resolve(path.dirname(file), spec);
        return fs.existsSync(base) ? base : `${base}.ts`;
    };

    for (const m of src.matchAll(
        /^[ \t]*(?:@\w+(?:\([^)]*\))?\s+)*export\s+(?:declare\s+)?(function|const|let|var|class|enum)\s+(\w+)/gm
    )) {
        exports.set(m[2], m[1] === 'function' ? 'function' : 'value');
    }
    for (const m of src.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
        for (const [k, v] of asModuleExports(resolve(m[1]), seen)) exports.set(k, v);
    }
    const imports = new Map();
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        for (const part of m[1].split(',')) {
            const [orig, alias = orig] = part.trim().split(/\s+as\s+/);
            if (orig) imports.set(alias.trim(), { orig: orig.trim(), from: m[2] });
        }
    }
    for (const m of src.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
        for (const part of m[1].split(',')) {
            const [orig, alias = orig] = part.trim().split(/\s+as\s+/);
            if (!orig) continue;
            let kind = 'value';
            if (m[2]) {
                kind = asModuleExports(resolve(m[2]), seen).get(orig.trim()) ?? 'value';
            } else if (imports.has(orig.trim())) {
                const imp = imports.get(orig.trim());
                kind = asModuleExports(resolve(imp.from), seen).get(imp.orig) ?? 'value';
            } else if (new RegExp(`\\bfunction\\s+${orig.trim()}\\b`).test(src)) {
                kind = 'function';
            }
            exports.set(alias.trim(), kind);
        }
    }
    return exports;
}

/** Names the AssemblyScript module exports (assembly/index.ts): functions and globals. */
export function asAbi(root = ROOT) {
    const index = path.join(root, 'assembly', 'index.ts');
    const all = asModuleExports(index);
    return {
        wildcard: /export\s*\*/.test(stripComments(fs.readFileSync(index, 'utf8'))),
        functions: new Set([...all].filter(([, k]) => k === 'function').map(([n]) => n)),
        values: new Set([...all].filter(([, k]) => k !== 'function').map(([n]) => n)),
    };
}

/** EMSCRIPTEN_KEEPALIVE function names in C++ source text. */
export function keepaliveNames(cppSrc) {
    const src = stripComments(cppSrc);
    return [
        ...src.matchAll(
            /EMSCRIPTEN_KEEPALIVE\s+(?:(?:static|inline|extern|const|unsigned|signed|struct)\s+)*[\w:<>]+[\s*&]+(\w+)\s*\(/g
        ),
    ].map((m) => m[1]);
}

/**
 * Function names the C++ module exports: exports.txt (EXPORTED_FUNCTIONS) plus
 * every EMSCRIPTEN_KEEPALIVE function, which -s EXPORT_KEEPALIVE=1 also exports.
 */
export function cppAbi(root = ROOT) {
    const dir = path.join(root, 'emscripten');
    const listed = fs
        .readFileSync(path.join(dir, 'exports.txt'), 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/^_/, ''))
        .filter((l) => l && !l.startsWith('#'));
    const keepalive = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.cpp'))
        .flatMap((f) => keepaliveNames(fs.readFileSync(path.join(dir, f), 'utf8')));
    return {
        functions: new Set([...listed, ...keepalive].filter((n) => !CPP_CORE.has(n))),
        listed: new Set(listed.filter((n) => !CPP_CORE.has(n))),
        keepalive: new Set(keepalive),
    };
}

// -----------------------------------------------------------------------------
// References and lookups
// -----------------------------------------------------------------------------

/** Names looked up in the C++ module by a string: getNativeFunc[Void], ccall, cwrap. */
export function cppStringLookups(code) {
    const re =
        /\b(?:getNativeFunc(?:Void)?\s*(?:<[^;'"`]*?>)?|ccall|cwrap)\s*\(\s*['"`]([A-Za-z_]\w*)['"`]/g;
    return [...code.matchAll(re)].map((m) => m[1]);
}

/**
 * Every C++ use: the string lookups, `._name`, and a string literal that is
 * exactly the name with or without the `_` (a name table looked up later, as
 * foliage-ecs-bridge.ts does with `getNativeFunc(slot.batchFnName)`).
 */
export function cppReferences(code) {
    return new Set([
        ...cppStringLookups(code),
        ...[...code.matchAll(/\._([A-Za-z]\w*)/g)].map((m) => m[1]),
        ...[...code.matchAll(/['"`]_?([A-Za-z]\w*)['"`]/g)].map((m) => m[1]),
    ]);
}

/**
 * Blank the contents of string and template literals, except a literal that is
 * a bracket key (`obj['x']`), so prose like `exports.txt` cannot read as code.
 */
export function blankStrings(code) {
    let out = '';
    let i = 0;
    while (i < code.length) {
        const c = code[i];
        if (c !== '"' && c !== "'" && c !== '`') {
            out += c;
            i++;
            continue;
        }
        const start = i++;
        while (i < code.length && code[i] !== c) i += code[i] === '\\' ? 2 : 1;
        const literal = code.slice(start, ++i);
        out += /\[\s*$/.test(out) ? literal : c + ' '.repeat(Math.max(0, literal.length - 2)) + c;
    }
    return out;
}

/** Names looked up on an AS `exports` object: `exports.x`, `exports?.x`, `exports['x']`. */
export function asLookups(code) {
    code = blankStrings(code);
    const names = [];
    const re =
        /(?<![\w$'"`/-])(?<!module\.)exports\b(?:\s+as\s+[\w<>, ]+)?\)?\s*(?:\??\.\s*([A-Za-z_]\w*)|\??\.?\[\s*['"]([A-Za-z_]\w*)['"]\s*\])/g;
    for (const m of code.matchAll(re)) names.push(m[1] ?? m[2]);
    return names;
}

const wordRe = (name) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`);

/** The full report: dead exports per module, stale lookups, test-only exports. */
export function analyze(root = ROOT) {
    const corpus = loadCorpus(root);
    const as = asAbi(root);
    const cpp = cppAbi(root);

    const asUse = new Map([...as.functions].map((n) => [n, new Set()]));
    for (const { code, area } of corpus) {
        for (const [name, areas] of asUse) if (wordRe(name).test(code)) areas.add(area);
    }
    // An exported global is read as `exports.NAME.value`; its name alone is
    // no evidence (native-memory-layout.ts mirrors every layout constant).
    for (const n of as.values) asUse.set(n, new Set());
    const cppUse = new Map([...cpp.functions].map((n) => [n, new Set()]));
    const stale = new Set();
    for (const { rel, code, area } of corpus) {
        for (const name of asLookups(code)) if (as.values.has(name)) asUse.get(name).add(area);
        for (const name of cppReferences(code)) cppUse.get(name)?.add(area);
        for (const name of cppStringLookups(code)) {
            if (!cpp.functions.has(name) && !CPP_CORE.has(name)) stale.add(`cpp:${name} (${rel})`);
        }
        for (const name of asLookups(code)) {
            if (!as.functions.has(name) && !as.values.has(name) && name !== 'memory') {
                stale.add(`as:${name} (${rel})`);
            }
        }
    }

    const pick = (use, test) =>
        [...use]
            .filter(([, areas]) => test(areas))
            .map(([n]) => n)
            .sort();
    return {
        as,
        cpp,
        dead: [
            ...pick(asUse, (a) => a.size === 0).map((n) => `as:${n}`),
            ...pick(cppUse, (a) => a.size === 0).map((n) => `cpp:${n}`),
        ],
        stale: [...stale].sort(),
        testOnly: [
            ...pick(asUse, (a) => a.size === 1 && a.has('test')).map((n) => `as:${n}`),
            ...pick(cppUse, (a) => a.size === 1 && a.has('test')).map((n) => `cpp:${n}`),
        ],
    };
}

// -----------------------------------------------------------------------------
// Gate
// -----------------------------------------------------------------------------

function main() {
    const update = process.argv.includes('--update');
    const list = process.argv.includes('--list');
    const report = analyze();

    if (report.as.wildcard) {
        console.error(
            `❌ [${TAG}] assembly/index.ts uses \`export *\`: list every export by name, so the\n` +
                'wasm ABI is the reviewed list and not every helper a module shares with its siblings.'
        );
        process.exit(1);
    }

    let baseline = { deadExports: 0, staleLookups: 0, dead: [], stale: [] };
    if (fs.existsSync(BASELINE)) baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    else if (!update) {
        console.error(
            `❌ [${TAG}] no baseline at ${path.relative(ROOT, BASELINE)}; run with --update`
        );
        process.exit(1);
    }

    const allowed = (key) => new Set(baseline[key] ?? []);
    const added = (key) => report[key].filter((x) => !allowed(key).has(x));
    const removed = (key) => [...allowed(key)].filter((x) => !report[key].includes(x));

    console.log(
        `[${TAG}] AS: ${report.as.functions.size} functions + ${report.as.values.size} globals · C++: ${report.cpp.functions.size} functions` +
            ` (${report.cpp.listed.size} in exports.txt, ${report.cpp.keepalive.size} EMSCRIPTEN_KEEPALIVE)`
    );
    console.log(
        `  dead exports   ${report.dead.length} (baseline ${baseline.dead?.length ?? '-'})`
    );
    console.log(
        `  stale lookups  ${report.stale.length} (baseline ${baseline.stale?.length ?? '-'})`
    );
    console.log(`  test-only      ${report.testOnly.length} (allowed)`);
    if (list) for (const t of report.testOnly) console.log(`    ${t}`);

    const grew = added('dead').length + added('stale').length > 0;
    if (update) {
        if (grew) {
            console.error(`\n❌ [${TAG}] refusing to grow the baseline. New entries:`);
            for (const x of [...added('dead'), ...added('stale')]) console.error(`   + ${x}`);
            process.exit(1);
        }
        fs.writeFileSync(
            BASELINE,
            JSON.stringify(
                {
                    deadExports: report.dead.length,
                    staleLookups: report.stale.length,
                    updatedAt: new Date().toISOString().slice(0, 10),
                    dead: report.dead,
                    stale: report.stale,
                },
                null,
                4
            ) + '\n'
        );
        console.log(
            `\nBaseline written: ${report.dead.length} dead, ${report.stale.length} stale.`
        );
        return;
    }

    if (grew) {
        console.error(`\n❌ [${TAG}] new dead exports or stale lookups:`);
        for (const x of added('dead')) console.error(`   + dead  ${x}`);
        for (const x of added('stale')) console.error(`   + stale ${x}`);
        console.error(
            '\nA dead export: call it from src/ (or a test), or drop it from the ABI\n' +
                '(assembly/index.ts; emscripten/build.sh ANIMATION_FUNCTIONS and its\n' +
                'EMSCRIPTEN_KEEPALIVE, then `npm run verify:emcc:manifest -- --write`).\n' +
                'A stale lookup: look the name up on the module that exports it, or delete it.'
        );
        process.exit(1);
    }
    if (removed('dead').length + removed('stale').length > 0) {
        console.error(`\n🎉 [${TAG}] fewer dead exports / stale lookups. Lock it in:`);
        for (const x of [...removed('dead'), ...removed('stale')]) console.error(`   - ${x}`);
        console.error(
            '  npm run check:native-exports -- --update\nand commit scripts/native-exports-baseline.json.'
        );
        process.exit(1);
    }
    console.log(`\n✅ [${TAG}] matches the baseline.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
