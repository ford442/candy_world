/**
 * Progression reachability (#1976): every unlock in unlocks.ts must be earnable
 * and must do something.
 *
 * - A *source* for an item is a `.harvest('<item>', …)` call in src/ (a spawner's
 *   interact hook, a harvest hook, or a set-piece).
 * - A *consumer* of an unlock is an `isUnlocked('<id>')` check in src/ outside
 *   unlocks.ts, or a data file in assets/ that gates content on it with
 *   `"unlock": "<id>"` (score cues: living-score.ts).
 *
 * Run with: npx tsx tests/progression-reachability.test.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNLOCK_DEFINITIONS } from '../src/systems/unlocks.ts';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const ASSETS = fileURLToPath(new URL('../assets', import.meta.url));

function walk(dir: string, out: string[] = [], match = /\.(ts|js|mjs)$/): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out, match);
        else if (match.test(name)) out.push(path);
    }
    return out;
}

const HARVEST_RE = /\.harvest\(\s*['"]([a-z0-9_]+)['"]/g;
const CONSUMER_RE = /\bisUnlocked\(\s*['"]([a-z0-9_]+)['"]/g;

const sources = new Map<string, string[]>();
const consumers = new Map<string, string[]>();
for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(HARVEST_RE)) {
        sources.set(m[1], [...(sources.get(m[1]) ?? []), rel]);
    }
    if (rel === join('systems', 'unlocks.ts')) continue;
    for (const m of text.matchAll(CONSUMER_RE)) {
        consumers.set(m[1], [...(consumers.get(m[1]) ?? []), rel]);
    }
}

const DATA_CONSUMER_RE = /"unlock"\s*:\s*"([a-z0-9_]+)"/g;
for (const file of walk(ASSETS, [], /\.json$/)) {
    const rel = relative(join(SRC, '..'), file);
    for (const m of readFileSync(file, 'utf8').matchAll(DATA_CONSUMER_RE)) {
        consumers.set(m[1], [...(consumers.get(m[1]) ?? []), rel]);
    }
}

const problems: string[] = [];
for (const def of Object.values(UNLOCK_DEFINITIONS)) {
    for (const req of def.requirements) {
        if (!sources.has(req.itemId)) {
            problems.push(
                `unlock "${def.id}" needs ${req.count}x "${req.itemId}", but nothing in src/ harvests it`
            );
        }
    }
    if (!consumers.has(def.id)) {
        problems.push(`unlock "${def.id}" is earnable but nothing in src/ checks isUnlocked('${def.id}')`);
    }
}

if (problems.length > 0) {
    console.error('Progression reachability FAILED:\n  - ' + problems.join('\n  - '));
    process.exit(1);
}
console.log(
    `Progression reachability OK: ${Object.keys(UNLOCK_DEFINITIONS).length} unlocks, ` +
        `${sources.size} harvestable items.`
);
