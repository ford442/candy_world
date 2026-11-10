/**
 * Objectives layer, first cut (#2028 slice B): Melody files, the state machine,
 * the document field and its union rule, and the journal.
 *
 * Node only. The shipped `assets/melodies/*.json` are parsed through the real
 * schema, and every id a trigger names is checked against what `src/` and
 * `assets/` actually contain, so renaming a harvest item, a discovery or a stall
 * fails here instead of leaving a Melody that can never finish.
 *
 * Run: npx tsx tests/objectives.test.ts
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISCOVERY_MAP } from '../src/systems/discovery-map.ts';
import {
    AWAKEN_TYPES,
    MelodyFileError,
    parseMelodyFile,
    parseMelodyFiles,
    type Melody,
} from '../src/gameplay/objectives/schema.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const MELODY_DIR = join(ROOT, 'assets', 'melodies');
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'melodies');

let failures = 0;
function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err instanceof Error ? err.stack : String(err)}`);
    }
}

// ---------------------------------------------------------------------------
// What exists on disk
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (/\.(ts|js|mjs)$/.test(name)) out.push(path);
    }
    return out;
}

function readJsonDir(dir: string): Record<string, unknown> {
    const files: Record<string, unknown> = {};
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        files[name] = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    }
    return files;
}

/** Same scan as `progression-reachability.test.ts`: a source is a `.harvest('<item>'` call. */
const HARVEST_RE = /\.harvest\(\s*['"]([a-z0-9_]+)['"]/g;
const CONSUME_RE = /\.consume\(\s*['"]([a-z0-9_]+)['"]/g;

const harvestable = new Set<string>();
const consumed = new Set<string>();
for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(HARVEST_RE)) harvestable.add(m[1]);
    // `UnlockSystem` itself declares `consume`; only its callers spend an item.
    if (relative(SRC, file) === join('systems', 'unlocks.ts')) continue;
    for (const m of text.matchAll(CONSUME_RE)) consumed.add(m[1]);
}

/** `AWAKENABLE_TYPES = new Set(['a', 'b'])`, read from source: importing the store drags in the renderer. */
function awakenableTypes(): Set<string> {
    const text = readFileSync(join(SRC, 'systems', 'awakened-persistence.ts'), 'utf8');
    const m = text.match(/AWAKENABLE_TYPES\s*=\s*new Set\(\[([^\]]*)\]\)/);
    assert.ok(m, 'could not find AWAKENABLE_TYPES in awakened-persistence.ts');
    return new Set([...m[1].matchAll(/['"]([a-z0-9_]+)['"]/g)].map((x) => x[1]));
}

/** A stall's stamp is `night_market_stamp:<map entity id>` (`stampIdForStall`). */
function stampIdsFromMap(): Set<string> {
    const map = JSON.parse(readFileSync(join(ROOT, 'assets', 'map.json'), 'utf8')) as {
        entities: Array<{ id: string; type: string }>;
    };
    return new Set(
        map.entities
            .filter((e) => e.type === 'night_market_stall')
            .map((e) => `night_market_stamp:${e.id}`)
    );
}

interface Catalog {
    harvest: ReadonlySet<string>;
    consumed: ReadonlySet<string>;
    discoveries: ReadonlySet<string>;
    stamps: ReadonlySet<string>;
    awaken: ReadonlySet<string>;
}

const catalog: Catalog = {
    harvest: harvestable,
    consumed,
    discoveries: new Set(Object.keys(DISCOVERY_MAP)),
    stamps: stampIdsFromMap(),
    awaken: awakenableTypes(),
};

/** Every trigger target that does not resolve, as a message naming the Melody and step. */
function findUnresolved(melodies: readonly Melody[], c: Catalog): string[] {
    const out: string[] = [];
    for (const m of melodies) {
        for (const step of m.steps) {
            const t = step.trigger;
            const where = `${m.id}/${step.id}`;
            if (t.kind === 'harvest') {
                if (!c.harvest.has(t.item)) {
                    out.push(`${where}: nothing in src/ harvests "${t.item}"`);
                } else if (c.consumed.has(t.item)) {
                    out.push(`${where}: "${t.item}" is spent by an ability, so "have N" can lapse`);
                }
            } else if (t.kind === 'discover') {
                if (!c.discoveries.has(t.id)) {
                    out.push(`${where}: "${t.id}" is not in DISCOVERY_MAP (peers drop it)`);
                }
            } else if (t.kind === 'stamp') {
                if (!c.stamps.has(t.id))
                    out.push(`${where}: no Night Market stall gives "${t.id}"`);
            } else if (t.type && !c.awaken.has(t.type)) {
                out.push(`${where}: "${t.type}" is not an awakenable flora type`);
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Step 1: the Melody file format and the shipped files
// ---------------------------------------------------------------------------

const shipped = parseMelodyFiles(readJsonDir(MELODY_DIR));

test('every assets/melodies/*.json parses, and the three starters are there', () => {
    assert.deepEqual(shipped.map((m) => m.id).sort(), ['meadow', 'night-market', 'sugar-caves']);
    for (const m of shipped) {
        assert.equal(m.prereq, undefined, `${m.id}: starters have no prereq`);
        assert.equal(m.season, undefined, `${m.id}: starters have no season`);
    }
});

test('the starters have the steps the plan names', () => {
    const byId = new Map(shipped.map((m) => [m.id, m]));
    assert.deepEqual(
        byId.get('meadow')!.steps.map((s) => s.trigger),
        [
            { kind: 'harvest', item: 'fern_core', count: 1 },
            { kind: 'harvest', item: 'vibrato_nectar', count: 1 },
            { kind: 'harvest', item: 'snap_shard', count: 1 },
        ]
    );
    assert.deepEqual(
        byId.get('sugar-caves')!.steps.map((s) => s.trigger),
        [{ kind: 'awaken', count: 3 }]
    );
    assert.deepEqual(
        byId.get('night-market')!.steps.map((s) => s.trigger),
        [0, 1, 2, 3, 4, 5].map((n) => ({
            kind: 'stamp',
            id: `night_market_stamp:setpiece:night_market:stall:${n}`,
        }))
    );
});

test('a malformed file fails with the file name and the path of the bad field', () => {
    const bad = JSON.parse(readFileSync(join(FIXTURE_DIR, 'bad.json'), 'utf8'));
    assert.throws(
        () => parseMelodyFile('bad.json', bad),
        (err: unknown) => {
            assert.ok(err instanceof MelodyFileError);
            assert.equal(err.file, 'bad.json');
            assert.equal(err.path, 'steps.1.trigger.count');
            assert.match(err.message, /bad\.json/);
            assert.match(err.message, /steps\.1\.trigger\.count/);
            return true;
        }
    );
    // The same file inside a set still names itself.
    assert.throws(
        () => parseMelodyFiles({ 'meadow.json': shipped[0], 'bad.json': bad }),
        /bad\.json.*steps\.1\.trigger\.count/
    );
});

test('unknown keys, bad ids and out-of-range counts are refused with their path', () => {
    const base = () =>
        structuredClone(shipped.find((m) => m.id === 'meadow')!) as Record<string, any>;
    const refuses = (mutate: (m: Record<string, any>) => void, path: RegExp) => {
        const m = base();
        mutate(m);
        assert.throws(() => parseMelodyFile('x.json', m), path);
    };
    refuses((m) => (m.reward = 'nothing'), /at "reward"/); // no rewards in this cut
    refuses((m) => (m.steps[0].trigger.cout = 1), /steps\.0\.trigger\.cout/);
    refuses((m) => (m.steps[0].trigger.count = 0), /steps\.0\.trigger\.count/);
    refuses((m) => (m.steps[0].trigger.count = 1.5), /steps\.0\.trigger\.count/);
    refuses((m) => (m.steps[0].trigger.kind = 'visit'), /steps\.0\.trigger\.kind/); // later cut
    refuses((m) => (m.id = 'Has Spaces'), /at "id"/);
    refuses((m) => (m.steps = []), /at "steps"/);
    refuses((m) => (m.steps[1].id = m.steps[0].id), /step ids must be unique/);
    refuses((m) => (m.prereq = [m.id]), /own prerequisite/);
    refuses(
        (m) => (m.steps[0].trigger = { kind: 'stamp', id: 'night_market_stamp:bad id' }),
        /steps\.0\.trigger\.id/
    );
    refuses(
        (m) => (m.steps[0].trigger = { kind: 'awaken', count: 1, type: 'pine_tree' }),
        /steps\.0\.trigger\.type/
    );
});

test('seasons and prerequisites parse; ids and references are checked across files', () => {
    const file = (id: string, extra: Record<string, unknown> = {}) => ({
        id,
        title: id,
        steps: [{ id: 's', text: 't', trigger: { kind: 'discover', id: 'cave' } }],
        ...extra,
    });
    const ok = parseMelodyFiles({
        'a.json': file('a', { season: 'winter' }),
        'b.json': file('b', { prereq: ['a'] }),
    });
    assert.equal(ok[0].season, 'winter');
    assert.deepEqual(ok[1].prereq, ['a']);

    assert.throws(
        () => parseMelodyFiles({ 'a.json': file('a'), 'b.json': file('a') }),
        /b\.json.*"a" is already defined in "a\.json"/
    );
    assert.throws(
        () => parseMelodyFiles({ 'a.json': file('a', { prereq: ['nope'] }) }),
        /a\.json.*prereq\.0.*unknown Melody "nope"/
    );
    assert.throws(
        () =>
            parseMelodyFiles({
                'a.json': file('a', { prereq: ['b'] }),
                'b.json': file('b', { prereq: ['a'] }),
            }),
        /prerequisites loop: a -> b -> a/
    );
});

test('every trigger in the starter files resolves to an id that exists on main', () => {
    assert.deepEqual(findUnresolved(shipped, catalog), []);
});

test('the resolve check is not vacuous: it names a broken Melody, and the scans found real data', () => {
    const synthetic = parseMelodyFile('synthetic.json', {
        id: 'synthetic',
        title: 'Synthetic',
        steps: [
            { id: 'h', text: 't', trigger: { kind: 'harvest', item: 'no_such_item', count: 1 } },
            { id: 'c', text: 't', trigger: { kind: 'harvest', item: 'tremolo_bulb', count: 1 } },
            { id: 'd', text: 't', trigger: { kind: 'discover', id: 'night_market' } },
            { id: 's', text: 't', trigger: { kind: 'stamp', id: 'night_market_stamp:stall:99' } },
        ],
    });
    const problems = findUnresolved([synthetic], catalog);
    assert.equal(problems.length, 4, problems.join('\n'));
    assert.match(problems[0], /synthetic\/h.*no_such_item/);
    assert.match(problems[1], /synthetic\/c.*tremolo_bulb.*spent/);
    assert.match(problems[2], /synthetic\/d.*night_market.*DISCOVERY_MAP/);
    assert.match(problems[3], /synthetic\/s.*night_market_stamp:stall:99/);

    // The harvest scan sees the ids the spec lists, so an empty scan cannot pass.
    for (const item of [
        'fern_core',
        'vibrato_nectar',
        'snap_shard',
        'chime_shard',
        'harmony_orb',
    ]) {
        assert.ok(catalog.harvest.has(item), `scan missed harvest id "${item}"`);
    }
    // Both spent items are found from source rather than listed here.
    assert.deepEqual([...catalog.consumed].sort(), ['harmony_orb', 'tremolo_bulb']);
    assert.equal(catalog.stamps.size, 6);
    assert.ok(catalog.discoveries.has('cave'));
});

test('the schema awaken types are exactly the awakenable flora types in src', () => {
    assert.deepEqual([...AWAKEN_TYPES].sort(), [...catalog.awaken].sort());
});

// ---------------------------------------------------------------------------
// Step 2: UnlockSystem.onHarvest and the state machine
// ---------------------------------------------------------------------------

// Inert DOM + a Map-backed localStorage, so the toast / announcer paths of the real UnlockSystem
// run in Node (same stubs as progression-effects.test.ts).
const noop = () => {};
const fakeEl: any = new Proxy(function () {}, {
    get: (_t, p) => (p === 'style' ? {} : p === 'classList' ? { add: noop, remove: noop } : fakeEl),
    apply: () => fakeEl,
    set: () => true,
});
(globalThis as any).document = {
    getElementById: () => null,
    createElement: () => fakeEl,
    body: { appendChild: noop, prepend: noop },
    head: { appendChild: noop },
    addEventListener: noop,
};
const lsData = new Map<string, string>();
(globalThis as any).localStorage = {
    getItem: (k: string) => lsData.get(k) ?? null,
    setItem: (k: string, v: string) => void lsData.set(k, String(v)),
    removeItem: (k: string) => void lsData.delete(k),
};

const { unlockSystem } = await import('../src/systems/unlocks.ts');
const { createObjectiveSystem } = await import('../src/gameplay/objectives/objective-system.ts');
type ObjectiveSystem = ReturnType<typeof createObjectiveSystem>;
type Announcement = [event: string, title: string];

test('onHarvest reports each harvest with its amount and the new total', () => {
    unlockSystem.reset();
    const seen: Array<[string, number, number]> = [];
    const off = unlockSystem.onHarvest((id, amount, total) => {
        // The inventory already holds the new count when listeners run.
        assert.equal(unlockSystem.getItemCount(id), total);
        seen.push([id, amount, total]);
    });
    unlockSystem.harvest('fern_core', 1, 'Fern Core');
    // chime_shard is harvested three at a time: count with `amount`, not by call.
    unlockSystem.harvest('chime_shard', 3, 'Chime Shard');
    unlockSystem.harvest('chime_shard', 3, 'Chime Shard');
    assert.deepEqual(seen, [
        ['fern_core', 1, 1],
        ['chime_shard', 3, 3],
        ['chime_shard', 3, 6],
    ]);
    off();
    unlockSystem.harvest('fern_core', 1, 'Fern Core');
    assert.equal(seen.length, 3, 'unsubscribed');
});

test('onHarvest is not called for restore or consume, and a throwing listener does not break harvest', () => {
    unlockSystem.reset();
    let calls = 0;
    const offBad = unlockSystem.onHarvest(() => {
        throw new Error('listener failure');
    });
    const offGood = unlockSystem.onHarvest(() => calls++);
    const warn = console.warn;
    console.warn = noop;
    try {
        unlockSystem.restore([], { fern_core: 5 });
        assert.equal(unlockSystem.consume('fern_core', 2), true);
        assert.equal(calls, 0);
        unlockSystem.harvest('snap_shard', 1, 'Snap Shard');
    } finally {
        console.warn = warn;
    }
    assert.equal(calls, 1, 'later listeners still run');
    assert.equal(unlockSystem.getItemCount('snap_shard'), 1, 'the harvest itself completed');
    offBad();
    offGood();
});

test('a listener still runs when harvest is wrapped, as save-integration wraps it', () => {
    unlockSystem.reset();
    const wrapped = unlockSystem.harvest;
    let triggered = 0;
    let heard = 0;
    const off = unlockSystem.onHarvest(() => heard++);
    const original = unlockSystem.harvest.bind(unlockSystem);
    unlockSystem.harvest = (itemId: string, amount?: number, displayName?: string) => {
        original(itemId, amount, displayName);
        triggered++;
    };
    try {
        unlockSystem.harvest('vibrato_nectar', 1, 'Vibrato Nectar');
    } finally {
        unlockSystem.harvest = wrapped;
        off();
    }
    assert.deepEqual([triggered, heard], [1, 1]);
});

/** A mutable stand-in for the player's progress. */
function fakeWorld() {
    const items = new Map<string, number>();
    const found = new Set<string>();
    const awakened: string[] = [];
    return {
        snapshot: {
            itemCount: (id: string) => items.get(id) ?? 0,
            isDiscovered: (id: string) => found.has(id),
            awakenedCount: (type?: string) =>
                type ? awakened.filter((t) => t === type).length : awakened.length,
        },
        give: (id: string, n = 1) => items.set(id, (items.get(id) ?? 0) + n),
        spend: (id: string, n = 1) => items.set(id, Math.max(0, (items.get(id) ?? 0) - n)),
        discover: (id: string) => found.add(id),
        awaken: (type = 'luminous_plant') => awakened.push(type),
    };
}

function build(
    melodies: readonly Melody[],
    options: { initial?: { completed: string[]; step: Record<string, number> } } = {}
) {
    const world = fakeWorld();
    const calls: Announcement[] = [];
    const details: Array<string | undefined> = [];
    const system: ObjectiveSystem = createObjectiveSystem({
        melodies,
        snapshot: world.snapshot,
        announce: (event, title, detail) => {
            calls.push([event, title]);
            details.push(detail);
        },
        initial: options.initial,
    });
    return { world, system, calls, details };
}

const melody = (id: string) => shipped.find((m) => m.id === id)!;
const STALL = (n: number) => `night_market_stamp:setpiece:night_market:stall:${n}`;

test('Meadow runs from start to completed with the expected announcements', () => {
    const { world, system, calls, details } = build([melody('meadow')]);
    system.evaluate();
    assert.deepEqual(calls, [['started', 'Meadow Melody']]);

    system.evaluate(); // nothing changed: idempotent
    assert.equal(calls.length, 1);

    world.give('fern_core');
    system.evaluate();
    world.give('vibrato_nectar');
    system.evaluate();
    assert.deepEqual(system.getProgress(), { completed: [], step: { meadow: 2 } });
    world.give('snap_shard');
    system.evaluate();

    assert.deepEqual(calls, [
        ['started', 'Meadow Melody'],
        ['step', 'Meadow Melody'],
        ['step', 'Meadow Melody'],
        ['completed', 'Meadow Melody'],
    ]);
    // `step` says what to do next; `started` and `completed` carry no detail.
    assert.deepEqual(details, [
        undefined,
        melody('meadow').steps[1].text,
        melody('meadow').steps[2].text,
        undefined,
    ]);
    assert.deepEqual(system.getProgress(), { completed: ['meadow'], step: {} });
});

test('a snapshot that already satisfies everything completes with one announcement per Melody', () => {
    const { world, system, calls } = build(shipped);
    for (const item of ['fern_core', 'vibrato_nectar', 'snap_shard']) world.give(item);
    for (let i = 0; i < 3; i++) world.awaken();
    for (let n = 0; n < 6; n++) world.discover(STALL(n));
    system.evaluate();
    assert.deepEqual(calls.sort(), [
        ['completed', 'Meadow Melody'],
        ['completed', 'Night Market Stamps'],
        ['completed', 'Sugar Caves'],
    ]);
    const before = system.getProgress();
    system.evaluate();
    system.evaluate();
    assert.equal(calls.length, 3, 'calling evaluate again changes nothing');
    assert.deepEqual(system.getProgress(), before);
});

test('a Melody that jumps part-way announces one step, not one per step', () => {
    const { world, system, calls } = build([melody('night-market')]);
    for (let n = 0; n < 4; n++) world.discover(STALL(n));
    system.evaluate();
    assert.deepEqual(calls, [['step', 'Night Market Stamps']]);
    assert.deepEqual(system.getProgress().step, { 'night-market': 4 });
});

test('a fresh start announces every active Melody as started, once', () => {
    const { system, calls } = build(shipped);
    system.evaluate();
    assert.deepEqual(
        calls.map((c) => c[0]),
        ['started', 'started', 'started']
    );
    system.evaluate();
    assert.equal(calls.length, 3);
    assert.deepEqual(system.getProgress().step, { meadow: 0, 'night-market': 0, 'sugar-caves': 0 });
});

test('chime_shard, harvested three at a time, satisfies count 3 after one harvest', () => {
    const chime: Melody = parseMelodyFile('chime.json', {
        id: 'chime',
        title: 'Chimes',
        steps: [
            {
                id: 'three',
                text: 'three',
                trigger: { kind: 'harvest', item: 'chime_shard', count: 3 },
            },
            { id: 'six', text: 'six', trigger: { kind: 'harvest', item: 'chime_shard', count: 6 } },
        ],
    });
    // Wired to the real UnlockSystem exactly as index.ts wires it.
    unlockSystem.reset();
    const calls: Announcement[] = [];
    const system = createObjectiveSystem({
        melodies: [chime],
        snapshot: {
            itemCount: (id) => unlockSystem.getItemCount(id),
            isDiscovered: () => false,
            awakenedCount: () => 0,
        },
        announce: (event, title) => calls.push([event, title]),
    });
    const off = unlockSystem.onHarvest(() => system.evaluate());
    try {
        unlockSystem.harvest('chime_shard', 3, 'Chime Shard');
        assert.deepEqual(system.getProgress().step, { chime: 1 }, 'one call satisfied count 3');
        unlockSystem.harvest('chime_shard', 3, 'Chime Shard');
        assert.deepEqual(system.getProgress(), { completed: ['chime'], step: {} });
    } finally {
        off();
    }
    assert.deepEqual(calls, [
        ['step', 'Chimes'],
        ['completed', 'Chimes'],
    ]);
});

test('steps are sequential: a later step satisfied early does not skip the current one', () => {
    const { world, system, calls } = build([melody('meadow')]);
    world.give('snap_shard');
    system.evaluate();
    assert.deepEqual(calls, [['started', 'Meadow Melody']]);
    world.give('fern_core');
    world.give('vibrato_nectar');
    system.evaluate();
    assert.deepEqual(
        calls.at(-1),
        ['completed', 'Meadow Melody'],
        'it catches up once the earlier steps hold'
    );
});

test('a step already passed stays passed when an item is spent, and a completed Melody stays completed', () => {
    const { world, system } = build([melody('meadow')]);
    world.give('fern_core');
    world.give('vibrato_nectar');
    system.evaluate();
    world.spend('fern_core'); // UnlockSystem.consume can do this
    world.spend('vibrato_nectar');
    system.evaluate();
    assert.deepEqual(system.getProgress().step, { meadow: 2 });
    world.give('snap_shard');
    system.evaluate();
    assert.deepEqual(system.getProgress(), { completed: ['meadow'], step: {} });
    world.spend('snap_shard');
    system.evaluate();
    assert.deepEqual(system.getProgress(), { completed: ['meadow'], step: {} });
});

test('awaken counts all flora, or only the named type', () => {
    const { world, system, calls } = build([melody('sugar-caves')]);
    world.awaken();
    world.awaken();
    system.evaluate();
    assert.deepEqual(calls, [['started', 'Sugar Caves']]);
    world.awaken('gem_canopy_tree');
    system.evaluate();
    assert.deepEqual(calls.at(-1), ['completed', 'Sugar Caves']);

    const typed = parseMelodyFile('typed.json', {
        id: 'typed',
        title: 'Typed',
        steps: [
            {
                id: 'gems',
                text: 't',
                trigger: { kind: 'awaken', count: 2, type: 'gem_canopy_tree' },
            },
        ],
    });
    const t = build([typed]);
    t.world.awaken('luminous_plant');
    t.world.awaken('luminous_plant');
    t.world.awaken('gem_canopy_tree');
    t.system.evaluate();
    assert.deepEqual(
        t.system.getProgress().completed,
        [],
        'two luminous plants are not two gem trees'
    );
    t.world.awaken('gem_canopy_tree');
    t.system.evaluate();
    assert.deepEqual(t.system.getProgress().completed, ['typed']);
});

test('a prerequisite keeps a Melody locked until it completes, and opening it counts as started', () => {
    const base = (id: string, extra: Record<string, unknown> = {}) =>
        parseMelodyFile(`${id}.json`, {
            id,
            title: id.toUpperCase(),
            steps: [{ id: 's', text: `do ${id}`, trigger: { kind: 'discover', id: 'cave' } }],
            ...extra,
        });
    // B is listed before A on purpose: completion order must not depend on array order.
    const b = base('b', {
        prereq: ['a'],
        steps: [{ id: 's', text: 'do b', trigger: { kind: 'discover', id: 'waterfall' } }],
    });
    const a = base('a');
    const { world, system, calls } = build([b, a]);
    system.evaluate();
    assert.deepEqual(calls, [['started', 'A']]);
    assert.deepEqual(
        system.getViews().map((v) => [v.id, v.status, v.needs]),
        [
            ['b', 'locked', ['A']],
            ['a', 'active', []],
        ]
    );

    world.discover('cave');
    system.evaluate();
    assert.deepEqual(calls.slice(1), [
        ['completed', 'A'],
        ['started', 'B'],
    ]);
    world.discover('waterfall');
    system.evaluate();
    assert.deepEqual(system.getProgress().completed.sort(), ['a', 'b']);
});

test('apply is silent: state from a document or a peer is never announced', () => {
    const { world, system, calls } = build(shipped);
    system.apply({ completed: ['meadow'], step: { 'night-market': 3 } });
    assert.deepEqual(calls, []);
    assert.deepEqual(system.getProgress(), {
        completed: ['meadow'],
        step: { 'night-market': 3, 'sugar-caves': 0 },
    });

    // The merged world also satisfies Night Market in full: it completes, still silently.
    for (let n = 0; n < 6; n++) world.discover(STALL(n));
    system.apply({ completed: [], step: {} });
    assert.deepEqual(calls, []);
    assert.ok(system.getProgress().completed.includes('night-market'));

    // A later local transition still announces.
    for (let i = 0; i < 3; i++) world.awaken();
    system.evaluate();
    assert.deepEqual(calls, [['completed', 'Sugar Caves']]);
});

test('apply only moves forward, and an empty state is the identity', () => {
    const { system } = build([melody('meadow')], {
        initial: { completed: [], step: { meadow: 2 } },
    });
    system.apply({ completed: [], step: { meadow: 1 } });
    assert.deepEqual(system.getProgress().step, { meadow: 2 });
    system.apply({ completed: [], step: {} });
    assert.deepEqual(system.getProgress(), { completed: [], step: { meadow: 2 } });
    system.apply({ completed: ['meadow'], step: { meadow: 0 } });
    assert.deepEqual(system.getProgress(), { completed: ['meadow'], step: {} });
});

test('initial state is taken as is, and ids from a newer build survive', () => {
    const { system, calls } = build([melody('meadow')], {
        initial: { completed: ['winter-melody'], step: { meadow: 1, 'summer-melody': 4 } },
    });
    system.evaluate();
    assert.deepEqual(calls, [], 'saved state announces nothing');
    assert.deepEqual(system.getProgress(), {
        completed: ['winter-melody'],
        step: { meadow: 1, 'summer-melody': 4 },
    });
});

test('a stored index past the end (a Melody that lost steps) completes it', () => {
    const { system, calls } = build([melody('sugar-caves')], {
        initial: { completed: [], step: { 'sugar-caves': 7 } },
    });
    system.evaluate();
    assert.deepEqual(calls, [['completed', 'Sugar Caves']]);
});

test('onChange fires on a real change, from evaluate or apply, and not on a no-op', () => {
    const { world, system } = build([melody('meadow')]);
    let changes = 0;
    const off = system.onChange(() => changes++);
    system.evaluate(); // started
    assert.equal(changes, 1);
    system.evaluate();
    system.apply({ completed: [], step: {} });
    assert.equal(changes, 1, 'no-ops are quiet');
    world.give('fern_core');
    system.evaluate();
    assert.equal(changes, 2);
    system.apply({ completed: [], step: { meadow: 2 } });
    assert.equal(changes, 3);
    off();
    system.apply({ completed: ['meadow'], step: {} });
    assert.equal(changes, 3, 'unsubscribed');
});

test('a throwing announce or change listener does not stop the state from advancing', () => {
    const world = fakeWorld();
    const system = createObjectiveSystem({
        melodies: [melody('meadow')],
        snapshot: world.snapshot,
        announce: () => {
            throw new Error('announce failure');
        },
    });
    system.onChange(() => {
        throw new Error('listener failure');
    });
    const warn = console.warn;
    console.warn = noop;
    try {
        world.give('fern_core');
        system.evaluate();
    } finally {
        console.warn = warn;
    }
    assert.deepEqual(system.getProgress().step, { meadow: 1 });
});

test('journal views: current step text for active, totals, and completed Melodies', () => {
    const { world, system } = build([melody('meadow'), melody('sugar-caves')]);
    system.evaluate();
    world.give('fern_core');
    system.evaluate();
    const [meadow, caves] = system.getViews();
    assert.deepEqual(
        [meadow.status, meadow.done, meadow.total, meadow.current],
        ['active', 1, 3, melody('meadow').steps[1].text]
    );
    assert.deepEqual([caves.status, caves.done, caves.total], ['active', 0, 1]);
    for (let i = 0; i < 3; i++) world.awaken();
    system.evaluate();
    const done = system.getViews()[1];
    assert.deepEqual([done.status, done.done, done.current], ['completed', 1, null]);
});

// ---------------------------------------------------------------------------
// The registry leaf in `app`, and the local mirror
// ---------------------------------------------------------------------------

const registry = await import('../src/systems/melody-progress.ts');
const { loadLocalMelodyProgress, saveLocalMelodyProgress, MELODY_STORAGE_KEY } =
    await import('../src/gameplay/objectives/local-store.ts');

test('melody-progress: state applied before the chunk loads is held, handed over, and read back', () => {
    registry.applyMelodyProgress({ completed: ['a'], step: { b: 2 } });
    registry.applyMelodyProgress({ completed: [], step: { b: 1, c: 0 } });
    assert.deepEqual(registry.readMelodyProgress(), { completed: ['a'], step: { b: 2, c: 0 } });

    const applied: unknown[] = [];
    let live = registry.emptyMelodyProgress();
    const unregister = registry.registerMelodyStore({
        read: () => live,
        apply: (p) => {
            applied.push(p);
            live = registry.unionMelodyProgress(live, p);
        },
    });
    assert.deepEqual(
        applied,
        [{ completed: ['a'], step: { b: 2, c: 0 } }],
        'pending handed over once'
    );
    registry.applyMelodyProgress({ completed: ['d'], step: {} });
    assert.deepEqual(registry.readMelodyProgress().completed.sort(), ['a', 'd']);

    unregister(); // the state comes back here instead of being lost
    assert.deepEqual(registry.readMelodyProgress().completed.sort(), ['a', 'd']);
    // Leave the leaf as we found it for the next test.
    registry.registerMelodyStore({ read: registry.emptyMelodyProgress, apply: () => {} })();
});

test('melody-progress: an empty registration hands nothing over', () => {
    const fresh = [] as unknown[];
    const un = registry.registerMelodyStore({
        read: registry.emptyMelodyProgress,
        apply: (p) => fresh.push(p),
    });
    assert.deepEqual(fresh, []);
    un();
});

test('local mirror: round-trips, and falls back to empty on garbage or unusable storage', () => {
    const data = new Map<string, string>();
    const storage = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
    };
    assert.deepEqual(loadLocalMelodyProgress(storage), { completed: [], step: {} });
    saveLocalMelodyProgress(storage, { completed: ['meadow'], step: { 'night-market': 3 } });
    assert.deepEqual(loadLocalMelodyProgress(storage), {
        completed: ['meadow'],
        step: { 'night-market': 3 },
    });

    const empty = { completed: [], step: {} };
    for (const bad of ['{', 'null', '[]', '{"version":2,"completed":["x"]}', '"text"']) {
        data.set(MELODY_STORAGE_KEY, bad);
        assert.deepEqual(loadLocalMelodyProgress(storage), empty, `garbage: ${bad}`);
    }
    // Wrong-typed members are dropped, bad indexes are sanitised, __proto__ is not data.
    data.set(
        MELODY_STORAGE_KEY,
        '{"version":1,"completed":["ok",7,null,"__proto__"],"step":{"a":2.9,"b":-1,"c":"x","__proto__":3}}'
    );
    assert.deepEqual(loadLocalMelodyProgress(storage), { completed: ['ok'], step: { a: 2 } });

    const throwing = {
        getItem: () => {
            throw new Error('denied');
        },
        setItem: () => {
            throw new Error('quota');
        },
    };
    assert.deepEqual(loadLocalMelodyProgress(throwing), empty);
    assert.doesNotThrow(() => saveLocalMelodyProgress(throwing, empty));
    assert.deepEqual(loadLocalMelodyProgress(null), empty);
    assert.doesNotThrow(() => saveLocalMelodyProgress(undefined, empty));
});

test('unionMelodyProgress: empty is the identity in both orders, larger step wins, completed drops the step', () => {
    const { unionMelodyProgress, emptyMelodyProgress } = registry;
    const x = { completed: ['a'], step: { b: 2, c: 1 } };
    assert.deepEqual(unionMelodyProgress(x, emptyMelodyProgress()), x);
    assert.deepEqual(unionMelodyProgress(emptyMelodyProgress(), x), x);
    assert.deepEqual(unionMelodyProgress(x, undefined), x, 'either side may lack the field');
    assert.deepEqual(unionMelodyProgress(undefined, x), x);
    assert.deepEqual(unionMelodyProgress(undefined, undefined), emptyMelodyProgress());

    const y = { completed: ['c'], step: { b: 5, a: 3 } };
    const u = unionMelodyProgress(x, y);
    assert.deepEqual(u.completed.sort(), ['a', 'c']);
    assert.deepEqual(u.step, { b: 5 }, 'larger index wins; completed ids lose their step entry');
    assert.deepEqual(unionMelodyProgress(y, x).step, u.step, 'commutative');
    assert.deepEqual(unionMelodyProgress(u, u), u, 'idempotent');
});

// ---------------------------------------------------------------------------
// Step 3: progress.melodies in the WorldDocument, and its union rule
// ---------------------------------------------------------------------------

const { createEmptyDocument, emptyProgress, validateWorldDocument } =
    await import('../src/world/document/schema.ts');
const { unionProgress } = await import('../src/world/document/progress-union.ts');

const newDoc = () => createEmptyDocument({ seed: 7, mapVersion: 'test', now: 1_000 });

test('a document without melodies validates and gets the empty state', () => {
    const raw = JSON.parse(JSON.stringify(newDoc()));
    delete raw.progress.melodies; // as saved before Melodies existed
    const result = validateWorldDocument(raw);
    assert.ok(result.ok, result.ok ? '' : result.error.message);
    assert.deepEqual(result.doc.progress.melodies, { completed: [], step: {} });
    assert.equal(result.doc.schema, 1, 'WORLD_DOCUMENT_SCHEMA stays 1');

    // Each load gets its own default object, so one document cannot change another.
    const other = validateWorldDocument(raw);
    assert.ok(other.ok);
    assert.notEqual(other.doc.progress.melodies, result.doc.progress.melodies);
});

test('progress.melodies round-trips through validateWorldDocument', () => {
    const doc = newDoc();
    doc.progress.melodies = {
        completed: ['meadow'],
        step: { 'night-market': 3, 'sugar-caves': 0 },
    };
    const result = validateWorldDocument(JSON.parse(JSON.stringify(doc)));
    assert.ok(result.ok, result.ok ? '' : result.error.message);
    assert.deepEqual(result.doc, doc);
    assert.deepEqual(emptyProgress().melodies, { completed: [], step: {} });
});

test('a malformed melodies field is refused with its path', () => {
    const refuses = (mutate: (p: Record<string, any>) => void, path: RegExp) => {
        const raw = JSON.parse(JSON.stringify(newDoc()));
        mutate(raw.progress);
        const result = validateWorldDocument(raw);
        assert.ok(!result.ok);
        assert.match(result.error.message, path);
    };
    refuses(
        (p) => (p.melodies = { completed: [], step: { a: -1 } }),
        /progress\.melodies\.step\.a/
    );
    refuses(
        (p) => (p.melodies = { completed: [], step: { a: 1.5 } }),
        /progress\.melodies\.step\.a/
    );
    refuses((p) => (p.melodies = { completed: [7], step: {} }), /progress\.melodies\.completed\.0/);
    refuses(
        (p) => (p.melodies = { completed: [''], step: {} }),
        /progress\.melodies\.completed\.0/
    );
    refuses((p) => (p.melodies = { step: {} }), /progress\.melodies\.completed/);
    refuses((p) => (p.melodies = 'done'), /progress\.melodies/);
});

test('unionProgress: the empty melodies state is the identity, in both argument orders', () => {
    const full = emptyProgress();
    full.discoveries = ['cave'];
    full.melodies = { completed: ['meadow'], step: { 'night-market': 2 } };
    assert.deepEqual(unionProgress(full, emptyProgress()), full);
    assert.deepEqual(unionProgress(emptyProgress(), full), full);
    assert.deepEqual(unionProgress(full, full), full, 'idempotent');
});

test('unionProgress: the larger step wins, and a completed Melody has no step entry', () => {
    const a = emptyProgress();
    a.melodies = { completed: ['meadow'], step: { 'night-market': 2, 'sugar-caves': 0 } };
    const b = emptyProgress();
    b.melodies = { completed: ['sugar-caves'], step: { 'night-market': 5, meadow: 1 } };
    const ab = unionProgress(a, b).melodies;
    assert.deepEqual([...ab.completed].sort(), ['meadow', 'sugar-caves']);
    assert.deepEqual(ab.step, { 'night-market': 5 });
    const ba = unionProgress(b, a).melodies;
    assert.deepEqual([...ba.completed].sort(), [...ab.completed].sort());
    assert.deepEqual(ba.step, ab.step, 'commutative');
});

test('unionProgress: either side may lack the field (a record built before it existed)', () => {
    const withField = emptyProgress();
    withField.melodies = { completed: ['meadow'], step: { x: 1 } };
    const without = emptyProgress() as Record<string, any>;
    delete without.melodies;
    assert.deepEqual(unionProgress(withField, without as any).melodies, withField.melodies);
    assert.deepEqual(unionProgress(without as any, withField).melodies, withField.melodies);
    assert.deepEqual(unionProgress(without as any, without as any).melodies, {
        completed: [],
        step: {},
    });
});

test('unionProgress still unions every other field', () => {
    const a = emptyProgress();
    a.discoveries = ['x'];
    a.inventory = { gem: 2 };
    a.partII = { sugarCavesUnlocked: true };
    const b = emptyProgress();
    b.discoveries = ['y'];
    b.inventory = { gem: 5, nectar: 1 };
    b.melodies = { completed: ['meadow'], step: {} };
    const u = unionProgress(a, b);
    assert.deepEqual(u.discoveries, ['x', 'y']);
    assert.deepEqual(u.inventory, { gem: 5, nectar: 1 });
    assert.equal(u.partII.sugarCavesUnlocked, true);
    assert.deepEqual(u.melodies.completed, ['meadow']);
});

if (failures > 0) {
    console.error(`\n${failures} objectives test(s) failed`);
    process.exit(1);
}
console.log('\nobjectives: all tests passed');
