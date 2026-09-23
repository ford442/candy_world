#!/usr/bin/env node
/**
 * Guard: every `CONFIG.<a>.<b>` symbol cited anywhere in `docs/**` must resolve
 * to a real property of the runtime config object exported from
 * `src/core/config/**`.
 *
 * WHY: docs in this repo have repeatedly described config knobs that were never
 * implemented (or that were renamed out from under the prose). A doc that cites
 * a knob which does not exist is worse than no doc — it sends readers looking
 * for a setting they cannot find. This check makes that drift fail CI.
 *
 * Exits non-zero listing every unresolved symbol with the files that cite it.
 *
 * Run: npm run test:docs-symbols
 * (Must run under tsx with tests/support/register-hooks.mjs so the TS config
 * modules and their asset imports load without a bundler.)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(root, 'docs');

// `CONFIG.a.b`, `CONFIG.a.b.c`, ... — at least one dotted segment past CONFIG.
const SYMBOL_RE = /\bCONFIG(?:\.[A-Za-z_$][\w$]*){2,}/g;

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(full);
    }
    return out;
}

function resolvePath(rootObj, segments) {
    let cur = rootObj;
    for (const seg of segments) {
        if (cur === null || typeof cur !== 'object') return false;
        if (!(seg in cur)) return false;
        cur = cur[seg];
    }
    return true;
}

async function main() {
    if (!fs.existsSync(DOCS_DIR)) {
        console.error(`✗ docs/ not found at ${DOCS_DIR}`);
        process.exit(1);
    }

    const mod = await import('../src/core/config/index.ts');
    const CONFIG = mod.CONFIG ?? mod.default;
    if (!CONFIG || typeof CONFIG !== 'object') {
        console.error('✗ src/core/config/index.ts did not export a CONFIG object');
        process.exit(1);
    }

    // symbol -> Set of doc files citing it
    const citations = new Map();
    for (const file of walk(DOCS_DIR)) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const match of text.matchAll(SYMBOL_RE)) {
            const symbol = match[0];
            if (!citations.has(symbol)) citations.set(symbol, new Set());
            citations.get(symbol).add(path.relative(root, file));
        }
    }

    const unresolved = [];
    for (const [symbol, files] of citations) {
        const segments = symbol.split('.').slice(1);
        if (!resolvePath(CONFIG, segments)) unresolved.push({ symbol, files: [...files].sort() });
    }
    unresolved.sort((a, b) => a.symbol.localeCompare(b.symbol));

    console.log(`docs-symbols: ${citations.size} distinct CONFIG symbol(s) cited across docs/`);

    if (unresolved.length > 0) {
        console.error('');
        console.error(`✗ ${unresolved.length} CONFIG symbol(s) cited in docs/ do not exist under src/core/config/:`);
        for (const { symbol, files } of unresolved) {
            console.error(`  ✗ ${symbol}`);
            for (const f of files) console.error(`      cited in ${f}`);
        }
        console.error('');
        console.error('Either implement the config property or correct the docs.');
        process.exit(1);
    }

    console.log(`✓ all ${citations.size} cited CONFIG symbols resolve against the runtime config`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
