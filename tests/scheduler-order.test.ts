/**
 * Frame order snapshot (#1973).
 *
 * Reads the system declarations (id / phase / after / before) out of
 * src/core/game-loop-systems.ts, resolves them with the real SystemScheduler,
 * and compares the run order against tests/fixtures/frame-order.json. The
 * module itself can't be imported under node (its imports reach the DOM), so
 * the declarations are parsed; the parse fails loudly if the file's shape
 * changes.
 *
 * A diff here means the frame order changed. If that was the intent, audit
 * the cross-system reads (docs/SCHEDULER.md) and run:
 *   npx tsx tests/scheduler-order.test.ts --update
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES, SystemScheduler, type Phase } from '../src/core/scheduler/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = join(root, 'src/core/game-loop-systems.ts');
const snapPath = join(root, 'tests/fixtures/frame-order.json');

const src = readFileSync(srcPath, 'utf8');
const start = src.indexOf('export const FRAME_SYSTEMS');
const end = src.indexOf('\n];', start);
if (start < 0 || end < 0) {
    console.error('✗ could not find the FRAME_SYSTEMS array in game-loop-systems.ts');
    process.exit(1);
}
const body = src.slice(start, end);

const ids = (list: string | undefined) =>
    list ? [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]) : undefined;
const decls: { id: string; phase: Phase; after?: string[]; before?: string[] }[] = [];
// One top-level `{ ... }` per system: id first, phase second (enforced below).
for (const m of body.matchAll(
    /\{\s*(?:\/\/[^\n]*\n\s*)*id: '([^']+)',\s*phase: '([^']+)',([\s\S]*?)\n    \},/g
)) {
    const rest = m[3];
    decls.push({
        id: m[1],
        phase: m[2] as Phase,
        after: ids(rest.match(/\bafter: \[([^\]]*)\]/)?.[1]),
        before: ids(rest.match(/\bbefore: \[([^\]]*)\]/)?.[1]),
    });
}
const declared = (body.match(/^\s{8}id: '/gm) ?? []).length;
if (decls.length === 0 || decls.length !== declared) {
    console.error(
        `✗ parsed ${decls.length} systems but the file declares ${declared} ids — keep each entry as { // comment… id, phase, … }`
    );
    process.exit(1);
}
for (const d of decls) {
    if (!PHASES.includes(d.phase)) {
        console.error(`✗ ${d.id}: unknown phase '${d.phase}'`);
        process.exit(1);
    }
}

const s = new SystemScheduler();
for (const d of decls) s.register({ ...d, update: () => {} });
const order = s.getOrder();

if (process.argv.includes('--update')) {
    writeFileSync(snapPath, JSON.stringify(order, null, 4) + '\n');
    console.log(`wrote ${order.length} systems to tests/fixtures/frame-order.json`);
    process.exit(0);
}

const snap: string[] = JSON.parse(readFileSync(snapPath, 'utf8'));
if (JSON.stringify(snap) === JSON.stringify(order)) {
    console.log(`✓ frame order matches the snapshot (${order.length} systems)`);
} else {
    console.error('✗ frame order differs from tests/fixtures/frame-order.json');
    const n = Math.max(snap.length, order.length);
    for (let i = 0; i < n; i++) {
        const mark = snap[i] === order[i] ? ' ' : '≠';
        console.error(
            `  ${mark} ${String(i).padStart(2)}  ${(snap[i] ?? '—').padEnd(36)} ${order[i] ?? '—'}`
        );
    }
    console.error('  If intended: npx tsx tests/scheduler-order.test.ts --update');
    process.exit(1);
}
