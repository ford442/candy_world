#!/usr/bin/env node
/**
 * `any` ratchet (#2166 part C). Same shape as cycles-ratchet.mjs.
 *
 * Counts the `any` type keyword in src/ (every .ts/.tsx file, declaration
 * files included) per directory, with the TypeScript parser rather than a
 * regex, so `: any`, `as any`, `any[]`, `<any>`, `Record<string, any>` and
 * `(...args: any[])` all count and a word in a comment or string does not.
 * The ESLint baseline counted these together with every other problem, so an
 * `any` could hide behind an unrelated lint fix.
 *
 * The baseline (scripts/any-baseline.json) must match exactly:
 *   a directory above its baseline   fails (a new `any`; type it instead)
 *   a directory below its baseline   fails with the command that locks the
 *                                    improvement in, so the baseline never
 *                                    carries slack for the next regression
 *   a directory not in the baseline  counts from 0
 * test:baselines also fails a PR whose `total` goes up.
 *
 * `--update` rewrites the baseline. It refuses to raise the total; it does
 * accept one directory rising while another falls by at least as much, which
 * is what moving a file looks like.
 *
 * Usage:
 *   npm run check:any                 gate; never writes
 *   npm run check:any -- --update     rewrite the baseline (refuses to raise the total)
 *   npm run check:any -- --list       also print each directory's count
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TAG = 'any-ratchet';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts', 'any-baseline.json');
const SCAN = 'src';

/** Number of `any` keywords in one file's source text. */
export function countAny(text, fileName = 'x.ts') {
    const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
    let n = 0;
    const visit = (node) => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) n++;
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return n;
}

/** { 'src/foliage': 191, … } for every directory with at least one `any`. */
export function countTree(root = ROOT, scan = SCAN) {
    const perDir = {};
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules') walk(full);
            } else if (/\.tsx?$/.test(entry.name)) {
                const n = countAny(fs.readFileSync(full, 'utf8'), entry.name);
                if (n === 0) continue;
                const rel = path.relative(root, dir).split(path.sep).join('/');
                perDir[rel] = (perDir[rel] ?? 0) + n;
            }
        }
    };
    walk(path.join(root, scan));
    return Object.fromEntries(Object.entries(perDir).sort(([a], [b]) => a.localeCompare(b)));
}

/** Directories above / below their baseline count. */
export function compare(current, baseline) {
    const dirs = new Set([...Object.keys(current), ...Object.keys(baseline)]);
    const up = [];
    const down = [];
    for (const d of [...dirs].sort()) {
        const now = current[d] ?? 0;
        const was = baseline[d] ?? 0;
        if (now > was) up.push({ dir: d, was, now });
        else if (now < was) down.push({ dir: d, was, now });
    }
    return { up, down };
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

function main() {
    const update = process.argv.includes('--update');
    const list = process.argv.includes('--list');
    const current = countTree();
    const total = sum(current);

    let baseline = null;
    if (fs.existsSync(BASELINE)) baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    else if (!update) {
        console.error(
            `❌ [${TAG}] no baseline at ${path.relative(ROOT, BASELINE)}; run with --update`
        );
        process.exit(1);
    }
    const base = baseline?.directories ?? {};
    const { up, down } = compare(current, base);

    console.log(`[${TAG}] \`any\` in ${SCAN}/: ${total} (baseline ${baseline?.total ?? '-'})`);
    if (list)
        for (const [d, n] of Object.entries(current))
            console.log(`  ${String(n).padStart(4)}  ${d}`);

    if (update) {
        if (baseline && total > baseline.total) {
            console.error(
                `❌ [${TAG}] refusing to raise the total (${baseline.total} → ${total}).`
            );
            for (const u of up) console.error(`   + ${u.dir}: ${u.was} → ${u.now}`);
            process.exit(1);
        }
        fs.writeFileSync(
            BASELINE,
            JSON.stringify(
                { total, updatedAt: new Date().toISOString().slice(0, 10), directories: current },
                null,
                4
            ) + '\n'
        );
        console.log(`Baseline written: ${total}.`);
        return;
    }

    if (up.length) {
        console.error(`\n❌ [${TAG}] new \`any\`:`);
        for (const u of up) console.error(`   ${u.dir}: ${u.was} → ${u.now}`);
        console.error(
            "\nGive it a real type (unknown + a guard, a generic, or the module's own type).\n" +
                'If a file moved between directories, `npm run check:any -- --update` accepts\n' +
                'it as long as the total does not rise.'
        );
        process.exit(1);
    }
    if (down.length) {
        console.error(`\n🎉 [${TAG}] fewer \`any\`. Lock it in:`);
        for (const d of down) console.error(`   ${d.dir}: ${d.was} → ${d.now}`);
        console.error('  npm run check:any -- --update\nand commit scripts/any-baseline.json.');
        process.exit(1);
    }
    console.log(`✅ [${TAG}] matches the baseline.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
