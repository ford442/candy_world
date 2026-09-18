#!/usr/bin/env -S npx tsx
/**
 * Drift guard: every `CONFIG.x.y.z` symbol referenced in docs/**\/*.md must
 * actually resolve against the real CONFIG object (src/core/config/**).
 *
 * `docs/CHARACTER_CONTROLLER.md` was the poster child for this drifting
 * silently — a doc describing a CONFIG shape that no longer existed, with
 * nothing to catch it. This walks the live CONFIG object rather than the
 * type declarations, so it also catches paths that type-check but were never
 * actually populated (e.g. a renamed default).
 *
 * Run: npx tsx scripts/check-docs-symbols.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/core/config.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DOCS_DIR = join(ROOT, 'docs');

// CONFIG.<segment>(.<segment>)* — identifier-only, so trailing sentence
// punctuation ("...CONFIG.player.radius.") never gets swept into the path.
const CONFIG_PATH_RE = /CONFIG((?:\.[A-Za-z_$][A-Za-z0-9_$]*)+)/g;

// docs/archive/** is a historical record of superseded plans, not live
// developer-facing guidance — it isn't kept in sync with CONFIG and shouldn't
// be (same reasoning as protecting old Outcome: lines in weekly_plan.md).
const SKIP_DIRS = new Set(['archive']);

function walkMarkdownFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...walkMarkdownFiles(full));
        else if (entry.endsWith('.md')) out.push(full);
    }
    return out;
}

/** Resolves a dotted path against the live CONFIG object. Arrays/functions/primitives short-circuit as resolved (nothing meaningful to check further down). */
function resolvesInConfig(path) {
    const segments = path.split('.').filter(Boolean);
    let node = CONFIG;
    for (const seg of segments) {
        if (node === null || node === undefined) return false;
        if (Array.isArray(node) || typeof node === 'function' || typeof node !== 'object') {
            return true; // can't meaningfully validate deeper into an array/fn/primitive
        }
        if (!Object.prototype.hasOwnProperty.call(node, seg)) return false;
        node = node[seg];
    }
    return true;
}

const files = walkMarkdownFiles(DOCS_DIR);
const failures = [];

for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
        for (const match of line.matchAll(CONFIG_PATH_RE)) {
            const fullPath = 'CONFIG' + match[1];
            const propPath = match[1].slice(1); // drop leading "."
            if (!resolvesInConfig(propPath)) {
                failures.push({ file: relative(ROOT, file), line: idx + 1, path: fullPath });
            }
        }
    });
}

if (failures.length > 0) {
    console.error(`❌ ${failures.length} doc-symbol reference(s) do not resolve against CONFIG:\n`);
    for (const f of failures) {
        console.error(`  ${f.file}:${f.line} — ${f.path}`);
    }
    console.error(
        '\nEither the doc drifted from src/core/config/**, or the symbol was renamed/removed. Fix the doc or the config.'
    );
    process.exit(1);
}

console.log(`✅ ${files.length} docs file(s) scanned — all CONFIG.* references resolve.`);
