/**
 * Progression reachability (#1976): every unlock in unlocks.ts must be earnable
 * and must do something.
 *
 * - A *source* for an item is a `.harvest('<item>', …)` call in src/ (a spawner's
 *   interact hook, a harvest hook, or a set-piece).
 * - A *consumer* of an unlock is an `isUnlocked('<id>')` check in src/ outside
 *   unlocks.ts, or a data file in assets/ that gates content on it with
 *   `"unlock": "<id>"` (score cues: living-score.ts).
 * - `announceQuest` has a caller outside the announcer and its re-export.
 *
 * The check also runs on a synthetic unlock with an unsourced item and no
 * consumer, and must name both, so a broken scan cannot pass silently.
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

type UnlockDefs = Record<string, { id: string; requirements: { itemId: string; count: number }[] }>;

function findProblems(
    defs: UnlockDefs,
    sourcesById: ReadonlyMap<string, string[]>,
    consumersById: ReadonlyMap<string, string[]>
): string[] {
    const out: string[] = [];
    for (const def of Object.values(defs)) {
        for (const req of def.requirements) {
            if (!sourcesById.has(req.itemId)) {
                out.push(
                    `unlock "${def.id}" needs ${req.count}x "${req.itemId}", but nothing in src/ harvests it`
                );
            }
        }
        if (!consumersById.has(def.id)) {
            out.push(
                `unlock "${def.id}" is earnable but nothing in src/ checks isUnlocked('${def.id}')`
            );
        }
    }
    return out;
}

const problems = findProblems(UNLOCK_DEFINITIONS, sources, consumers);

const QUEST_EXEMPT = new Set([join('ui', 'announcer.ts'), 'accessibility-index.ts']);
const questCallers = walk(SRC)
    .filter((f) => !QUEST_EXEMPT.has(relative(SRC, f)))
    .filter((f) => /\bannounceQuest\(/.test(readFileSync(f, 'utf8')));
if (questCallers.length === 0) {
    problems.push('announceQuest() has no caller outside ui/announcer.ts');
}

// Mutation proof: the same check must reject an unlock nobody can earn or use.
const mutant = findProblems(
    {
        ...UNLOCK_DEFINITIONS,
        ghost: { id: 'ghost', requirements: [{ itemId: 'ghost_item', count: 1 }] },
    },
    sources,
    consumers
);
if (
    !mutant.some((p) => p.includes('"ghost_item"')) ||
    !mutant.some((p) => p.includes("isUnlocked('ghost')"))
) {
    problems.push(
        `the check did not flag a synthetic unsourced, unconsumed unlock: ${JSON.stringify(mutant)}`
    );
}

if (problems.length > 0) {
    console.error('Progression reachability FAILED:\n  - ' + problems.join('\n  - '));
    process.exit(1);
}
console.log(
    `Progression reachability OK: ${Object.keys(UNLOCK_DEFINITIONS).length} unlocks, ` +
        `${sources.size} harvestable items.`
);
