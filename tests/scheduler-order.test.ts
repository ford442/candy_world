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
 * Also checks that game-loop.ts calls no `update*` / `tick*` function itself:
 * every per-frame call goes through a registered system.
 *
 * A diff here means the frame order changed. If that was the intent, audit
 * the cross-system reads (docs/ARCHITECTURE.md) and run:
 *   npx tsx tests/scheduler-order.test.ts --update
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES, SystemScheduler, type Phase } from '../src/core/scheduler/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const snapPath = join(root, 'tests/fixtures/frame-order.json');

function fail(msg: string): never {
    console.error(`✗ ${msg}`);
    process.exit(1);
}

// --- game-loop.ts calls nothing per frame itself ---------------------------
{
    const loop = read('src/core/game-loop.ts');
    const body = loop.slice(loop.indexOf('export function animate'));
    const direct = [...body.matchAll(/\b((?:update|tick)[A-Z]\w*)\s*\(/g)].map((m) => m[1]);
    if (direct.length > 0) {
        fail(
            `game-loop.ts animate() calls ${direct.join(', ')} directly — register a system instead`
        );
    }
    console.log('✓ game-loop.ts animate() makes no direct update*/tick* calls');
}

// --- parse the declarations -------------------------------------------------
const src = read('src/core/game-loop-systems.ts');
const start = src.indexOf('export const FRAME_SYSTEMS');
const end = src.indexOf('\n];', start);
if (start < 0 || end < 0) fail('could not find the FRAME_SYSTEMS array in game-loop-systems.ts');
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
    fail(
        `parsed ${decls.length} systems but the file declares ${declared} ids — keep each entry as { // comment… id, phase, … }`
    );
}
for (const d of decls) {
    if (!PHASES.includes(d.phase)) fail(`${d.id}: unknown phase '${d.phase}'`);
}

// The frame source: `FRAME_SOURCE = <name>`, and `<name>`'s `id:` in game-loop-audio.ts.
const sourceName = src.match(/export const FRAME_SOURCE: FrameSource = (\w+);/)?.[1];
if (!sourceName) fail('could not find `export const FRAME_SOURCE: FrameSource = …;`');
const sourceId = read('src/core/game-loop-audio.ts').match(
    new RegExp(`export const ${sourceName}: FrameSource = \\{\\s*id: '([^']+)'`)
)?.[1];
if (!sourceId) fail(`could not find ${sourceName}'s id in game-loop-audio.ts`);

const s = new SystemScheduler();
s.setFrameSource({ id: sourceId, sample: () => ({ time: 0, audio: null }) });
for (const d of decls) s.register({ ...d, update: () => {} });
const order = s.getOrder();

if (process.argv.includes('--update')) {
    writeFileSync(snapPath, JSON.stringify(order, null, 4) + '\n');
    console.log(`wrote ${order.length} entries to tests/fixtures/frame-order.json`);
    process.exit(0);
}

const snap: string[] = JSON.parse(readFileSync(snapPath, 'utf8'));
if (JSON.stringify(snap) === JSON.stringify(order)) {
    console.log(`✓ frame order matches the snapshot (${order.length} entries)`);
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
