#!/usr/bin/env node
/**
 * Import-cycle ratchet (#1827 Part B.1; first landed for #1754, deleted by the
 * stale #1779 squash).
 *
 * Builds the runtime import graph reachable from src/main.ts (the Vite entry) with madge
 * (type-only imports skipped) and compares its cyclic part against
 * scripts/cycles-baseline.json.
 *
 * WHY not gate on madge's `circular().length`: that number counts DFS back
 * edges, so it depends on traversal order. The same graph reports 26 or 64
 * cycles depending only on `baseDir`, and adding or renaming an unrelated file
 * can move it. This gate uses two numbers that only rise when an import closes
 * a new loop and only fall when one is broken:
 *   cyclicModules  modules inside a strongly connected component of size > 1
 *   cyclicEdges    imports whose two ends sit in the same such component
 * madge's figure is still printed, for continuity with the numbers in #1827.
 *
 * The baseline must match exactly. Higher fails (a new cycle). Lower also
 * fails, with the command that locks the improvement in, so the baseline can
 * only move down and never carries slack for the next regression.
 *
 * Usage:
 *   npm run test:cycles                gate; never writes
 *   npm run test:cycles -- --update    rewrite the baseline (refuses to raise it)
 *   npm run test:cycles -- --list      also print every cyclic component
 */
import madge from 'madge';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(rootDir, 'scripts', 'cycles-baseline.json');
const ENTRY = 'src/main.ts';
const update = process.argv.includes('--update');
const allowIncrease = process.argv.includes('--allow-increase');
const list = process.argv.includes('--list');

const res = await madge(join(rootDir, ENTRY), {
    baseDir: rootDir,
    tsConfig: join(rootDir, 'tsconfig.json'),
    fileExtensions: ['ts', 'tsx', 'js', 'mjs'],
    detectiveOptions: {
        ts: { skipTypeImports: true },
        tsx: { skipTypeImports: true },
    },
});

// A relative import madge could not resolve silently drops an edge, which
// would read as a cycle fixed. Vite query imports (`?init`, `?url`) are the
// only relative specifiers expected here.
const unresolved = res
    .warnings()
    .skipped.filter((spec) => spec.startsWith('.') && !spec.includes('?'));
if (unresolved.length) {
    console.error('cycles: madge could not resolve these imports, so the graph is incomplete:');
    for (const spec of unresolved) console.error(`  ${spec}`);
    process.exit(1);
}

/** Cyclic components (Tarjan SCCs of size > 1, or self-loops) and the imports inside them. */
function analyze(graph) {
    const index = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    const components = [];
    let next = 0;
    const visit = (v) => {
        index.set(v, next);
        low.set(v, next);
        next++;
        stack.push(v);
        onStack.add(v);
        for (const w of graph[v] ?? []) {
            if (!index.has(w)) {
                visit(w);
                low.set(v, Math.min(low.get(v), low.get(w)));
            } else if (onStack.has(w)) {
                low.set(v, Math.min(low.get(v), index.get(w)));
            }
        }
        if (low.get(v) === index.get(v)) {
            const component = [];
            let w;
            do {
                w = stack.pop();
                onStack.delete(w);
                component.push(w);
            } while (w !== v);
            components.push(component);
        }
    };
    for (const v of Object.keys(graph)) if (!index.has(v)) visit(v);

    const cyclic = components
        .filter((c) => c.length > 1 || (graph[c[0]] ?? []).includes(c[0]))
        .map((c) => c.sort())
        .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
    const componentOf = new Map();
    cyclic.forEach((c, i) => c.forEach((v) => componentOf.set(v, i)));

    const edges = [];
    for (const [from, deps] of Object.entries(graph)) {
        for (const to of deps) {
            if (componentOf.has(from) && componentOf.get(from) === componentOf.get(to))
                edges.push(`${from} -> ${to}`);
        }
    }
    edges.sort();
    return { cyclic, edges, cyclicModules: cyclic.reduce((n, c) => n + c.length, 0) };
}

const graph = res.obj();
const { cyclic, edges, cyclicModules } = analyze(graph);
const current = {
    cyclicModules,
    cyclicEdges: edges.length,
    madgeCycles: res.circular().length,
};

let baseline = { cyclicModules: Infinity, cyclicEdges: Infinity, edges: [] };
try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
    if (!update) {
        console.error(`cycles: no baseline at ${baselinePath}; run with --update to create it`);
        process.exit(1);
    }
}

const fmt = (key) => {
    const d = current[key] - (baseline[key] ?? 0);
    return `${current[key]} (baseline ${baseline[key] ?? '-'}, ${d >= 0 ? '+' : ''}${d})`;
};
console.log(`Import cycles reachable from ${ENTRY} (type-only imports skipped):`);
console.log(`  modules in cycles  ${fmt('cyclicModules')}`);
console.log(`  cyclic imports     ${fmt('cyclicEdges')}`);
console.log(`  components         ${cyclic.length}`);
console.log(`  madge circular()   ${fmt('madgeCycles')}  (informational, order-dependent)`);

if (list) {
    console.log('');
    for (const c of cyclic) console.log(`[${c.length}] ${c.join('\n     ')}\n`);
}

const rose =
    current.cyclicModules > baseline.cyclicModules || current.cyclicEdges > baseline.cyclicEdges;
const fell =
    current.cyclicModules < baseline.cyclicModules || current.cyclicEdges < baseline.cyclicEdges;

if (update) {
    if (rose && !allowIncrease) {
        console.error(
            '\ncycles: refusing to raise the baseline. Break the new cycle, or pass --allow-increase and say why in the PR.'
        );
        process.exit(1);
    }
    writeFileSync(
        baselinePath,
        JSON.stringify(
            { ...current, updatedAt: new Date().toISOString().slice(0, 10), edges },
            null,
            4
        ) + '\n'
    );
    console.log(
        `\nBaseline written: ${current.cyclicModules} modules, ${current.cyclicEdges} imports.`
    );
    process.exit(0);
}

if (rose) {
    // A new import that closes a loop usually drags many existing imports into
    // one merged component, so list the imports whose removal alone undoes most
    // of the growth rather than every newly cyclic edge.
    const known = new Set(baseline.edges ?? []);
    const added = edges.filter((e) => !known.has(e));
    const suspects = added
        .map((e) => {
            const [from, to] = e.split(' -> ');
            const without = { ...graph, [from]: graph[from].filter((d) => d !== to) };
            return { e, left: analyze(without).edges.length };
        })
        .sort((a, b) => a.left - b.left)
        .filter((s, i, all) => s.left === all[0].left && s.left < current.cyclicEdges);

    console.error('\n❌ cycles: the import graph gained a cycle.');
    if (suspects.length) {
        console.error('Removing any one of these imports undoes most of it:');
        for (const s of suspects) console.error(`  ${s.e}`);
    }
    console.error(
        `\n${added.length} import(s) are now inside a cycle that were not in the baseline.\n` +
            'Import the defining module instead of a barrel, move shared state into a leaf\n' +
            'module, or inject the dependency. Rerun with --list for the full components.'
    );
    process.exit(1);
}

if (fell) {
    console.error(
        '\n🎉 cycles went down. Lock it in so it cannot creep back:\n' +
            '  npm run test:cycles -- --update\n' +
            'and commit scripts/cycles-baseline.json.'
    );
    process.exit(1);
}

const stale =
    edges.length !== (baseline.edges ?? []).length || edges.some((e, i) => e !== baseline.edges[i]);
console.log(
    stale
        ? '\n✅ cycles: counts match the baseline (edge list differs, likely a rename; --update refreshes it).'
        : '\n✅ cycles: matches the baseline.'
);
