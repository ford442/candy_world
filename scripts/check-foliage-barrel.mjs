#!/usr/bin/env node
/**
 * Guard: no module under `src/foliage/` may import the foliage barrel
 * (`src/foliage/index.ts`).
 *
 * WHY: the barrel re-exports nearly every foliage module. A foliage module that
 * imports it (leaf → barrel → leaf) puts itself and the barrel inside a runtime
 * import cycle, and those cycles are what pin the Vite chunk split (circular
 * chunks, TDZ at boot). `index.ts` is the public entry for world-gen and debug
 * only; foliage internals import `material-core.ts`, `foliage-reactivity.ts`,
 * `foliage-materials.ts`, etc. directly.
 *
 * Exits non-zero listing each offending import.
 *
 * Run: npm run test:foliage-barrel
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOLIAGE = path.join(root, 'src', 'foliage');
const BARREL = path.join(FOLIAGE, 'index.ts');

// Static `import ... from`, `export ... from`, and dynamic `import()` specifiers.
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return /\.(ts|js|mjs)$/.test(e.name) ? [p] : [];
    });
}

function resolvesToBarrel(fromFile, spec) {
    if (!spec.startsWith('.')) return false;
    const p = path.resolve(path.dirname(fromFile), spec);
    return p === BARREL || p + '.ts' === BARREL || path.join(p, 'index.ts') === BARREL;
}

const offenders = [];
for (const file of walk(FOLIAGE)) {
    if (file === BARREL) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(SPEC_RE)) {
        if (!resolvesToBarrel(file, m[1])) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${path.relative(root, file)}:${line}  '${m[1]}'`);
    }
}

if (offenders.length) {
    console.error(
        `foliage-barrel: ${offenders.length} import(s) of src/foliage/index.ts from inside src/foliage/:`
    );
    for (const o of offenders) console.error(`  ${o}`);
    console.error(
        'Import the defining module instead (material-core.ts, foliage-reactivity.ts, foliage-materials.ts, ...).'
    );
    process.exit(1);
}
console.log('✓ foliage-barrel: no src/foliage/ module imports the foliage barrel');
