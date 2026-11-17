/**
 * Objectives, triggers slice (#2028): `visit`, `play-on-beat` and `build` triggers, seasonal
 * activation, and Melody rewards. Node only; the state machine runs against a fake snapshot whose
 * build count comes from the real authored-entity registry and whose cues come from the real
 * signal leaf.
 *
 * Run: npx tsx tests/objectives-triggers.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    __resetAuthoredEntitiesForTests,
    markPlacedEntity,
    placedEntityCount,
    unmarkPlacedEntity,
} from '../src/world/authored-entities.ts';
import {
    __resetObjectiveSignalsForTests,
    emitObjectiveCue,
    getCurrentBiome,
    isOnBeat,
    onObjectiveCue,
    reportBiome,
    type ObjectiveCue,
} from '../src/systems/objective-signals.ts';
import {
    createObjectiveSystem,
    type MelodyEvent,
    type ObjectiveSystem,
} from '../src/gameplay/objectives/objective-system.ts';
import {
    MelodyFileError,
    parseMelodyFile,
    parseMelodyFiles,
    type Melody,
} from '../src/gameplay/objectives/schema.ts';
import { unionProgress } from '../src/world/document/progress-union.ts';
import { emptyProgress } from '../src/world/document/schema.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
function test(name: string, fn: () => void): void {
    try {
        __resetAuthoredEntitiesForTests();
        __resetObjectiveSignalsForTests();
        fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err instanceof Error ? err.stack : String(err)}`);
    }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const RHYTHM: Melody = parseMelodyFile('rhythm.json', {
    id: 'rhythm',
    title: 'Rhythm',
    steps: [
        { id: 'go', text: 'Go to the caves.', trigger: { kind: 'visit', biome: 'sugar_caves' } },
        {
            id: 'clap',
            text: 'Clap on the beat twice.',
            trigger: { kind: 'play-on-beat', action: 'clap', count: 2 },
        },
        {
            id: 'build',
            text: 'Place two mushrooms.',
            trigger: { kind: 'build', count: 2, type: 'mushroom' },
        },
    ],
    reward: { items: [{ item: 'fern_core', count: 2 }] },
});

const WINTER: Melody = parseMelodyFile('winter.json', {
    id: 'winter',
    title: 'Winter',
    season: 'winter',
    steps: [
        { id: 'a', text: 'Visit the market.', trigger: { kind: 'visit', biome: 'night_market' } },
        { id: 'b', text: 'Visit the caves.', trigger: { kind: 'visit', biome: 'sugar_caves' } },
    ],
    reward: { items: [{ item: 'vibrato_nectar', count: 1 }] },
});

const AFTER_WINTER: Melody = parseMelodyFile('after.json', {
    id: 'after',
    title: 'After',
    prereq: ['winter'],
    steps: [{ id: 'a', text: 'Place anything.', trigger: { kind: 'build', count: 1 } }],
});

function harness(
    melodies: readonly Melody[],
    opts: { initial?: { completed: string[]; step: Record<string, number> } } = {}
) {
    let season = 'spring';
    const streaks = new Map<string, number>();
    const inventory: Record<string, number> = {};
    const calls: Array<[MelodyEvent, string]> = [];
    const grants: Array<[string, number]> = [];
    // `system` is assigned below; grant re-enters it the way harvest -> onHarvest does in the game.
    let system: ObjectiveSystem;
    system = createObjectiveSystem({
        melodies,
        snapshot: {
            itemCount: (id) => inventory[id] ?? 0,
            isDiscovered: () => false,
            awakenedCount: () => 0,
            builtCount: (type) => placedEntityCount(type),
            currentBiome: () => getCurrentBiome(),
            beatStreak: (a) => streaks.get(a) ?? 0,
            season: () => season,
        },
        announce: (event, title) => calls.push([event, title]),
        initial: opts.initial,
        grant: (item, count) => {
            grants.push([item, count]);
            inventory[item] = (inventory[item] ?? 0) + count;
            system.evaluate();
        },
    });
    // The chunk wiring: any cue means "evaluate".
    const off = onObjectiveCue(() => system.evaluate());
    return {
        system,
        calls,
        grants,
        inventory,
        off,
        setSeason(name: string) {
            season = name;
            emitObjectiveCue({ kind: 'season' });
        },
        /** One press of `action`, on or off the beat, as `index.ts` does it. */
        press(action: string, onBeat: boolean) {
            const n = onBeat ? (streaks.get(action) ?? 0) + 1 : 0;
            streaks.set(action, n);
            if (n > 0) system.evaluate();
        },
    };
}

const stepOf = (s: ObjectiveSystem, id: string) => s.getProgress().step[id];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function refusal(json: unknown): MelodyFileError {
    try {
        parseMelodyFile('bad.json', json);
    } catch (err) {
        assert.ok(err instanceof MelodyFileError, String(err));
        return err;
    }
    assert.fail('expected the file to be refused');
}

const base = () => structuredClone(RHYTHM) as unknown as Record<string, any>;

test('schema: malformed trigger and reward fields are refused with the file and the field path', () => {
    const cases: Array<[(m: Record<string, any>) => void, RegExp]> = [
        [(m) => (m.steps[0].trigger.biome = 'Sugar Caves'), /steps\.0\.trigger\.biome/],
        [(m) => delete m.steps[0].trigger.biome, /steps\.0\.trigger\.biome/],
        [(m) => (m.steps[0].trigger.radius = 4), /steps\.0\.trigger\.radius/],
        [(m) => (m.steps[1].trigger.action = 'teleport'), /steps\.1\.trigger\.action/],
        [(m) => (m.steps[1].trigger.count = 0), /steps\.1\.trigger\.count/],
        [(m) => (m.steps[1].trigger.count = 65), /steps\.1\.trigger\.count/],
        [(m) => (m.steps[2].trigger.count = 1.5), /steps\.2\.trigger\.count/],
        [(m) => (m.steps[2].trigger.type = 'bad type!'), /steps\.2\.trigger\.type/],
        [(m) => (m.reward = { items: [] }), /reward\.items/],
        [(m) => (m.reward.items[0].count = -1), /reward\.items\.0\.count/],
        [(m) => (m.reward.items[0].item = 'Fern Core'), /reward\.items\.0\.item/],
        [(m) => (m.reward.unlock = 'dash'), /reward\.unlock/],
        [(m) => (m.season = 'monsoon'), /season/],
    ];
    for (const [mutate, path] of cases) {
        const m = base();
        mutate(m);
        const err = refusal(m);
        assert.match(err.message, /"bad\.json"/);
        assert.match(err.path ?? '', path, err.message);
    }
});

test('schema: the shipped Melodies use every new trigger and a season, and parse with the rest', () => {
    const dir = join(ROOT, 'assets', 'melodies');
    const files: Record<string, unknown> = {};
    for (const name of ['meadow.json', 'garden-rhythm.json', 'winter-song.json']) {
        files[name] = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    }
    const shipped = parseMelodyFiles(files);
    const kinds = new Set(shipped.flatMap((m) => m.steps.map((s) => s.trigger.kind)));
    for (const k of ['visit', 'play-on-beat', 'build']) assert.ok(kinds.has(k as never), k);
    assert.ok(
        shipped.some((m) => m.season),
        'a seasonal Melody ships'
    );
    assert.ok(
        shipped.some((m) => m.reward),
        'a Melody with a reward ships'
    );
});

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

test('signals: reportBiome cues only on a change; isOnBeat wraps around the beat', () => {
    const seen: ObjectiveCue[] = [];
    onObjectiveCue((c) => seen.push(c));
    reportBiome('global');
    reportBiome('sugar_caves');
    reportBiome('sugar_caves');
    reportBiome('global');
    assert.deepEqual(seen, [
        { kind: 'visit', biome: 'sugar_caves' },
        { kind: 'visit', biome: 'global' },
    ]);
    assert.ok(isOnBeat(0.02) && isOnBeat(0.97) && !isOnBeat(0.5));
});

test('visit: present-tense, passes only as the current step, and is remembered after leaving', () => {
    const h = harness([WINTER]);
    h.setSeason('winter');
    reportBiome('sugar_caves'); // step b's biome, but step a is current: sequential
    assert.equal(stepOf(h.system, 'winter'), 0);
    reportBiome('night_market');
    assert.equal(stepOf(h.system, 'winter'), 1);
    reportBiome('global'); // walking away keeps the step
    assert.equal(stepOf(h.system, 'winter'), 1);
    reportBiome('sugar_caves');
    assert.deepEqual(h.system.getProgress().completed, ['winter']);
});

test('play-on-beat: a streak of on-beat presses passes; an off-beat press resets it', () => {
    const h = harness([RHYTHM]);
    reportBiome('sugar_caves');
    assert.equal(stepOf(h.system, 'rhythm'), 1);
    h.press('clap', true);
    h.press('clap', false);
    h.press('clap', true);
    assert.equal(stepOf(h.system, 'rhythm'), 1, 'the streak was broken');
    h.press('strike', true); // another action does not count
    h.press('clap', true);
    assert.equal(stepOf(h.system, 'rhythm'), 2);
});

test('build: counts placed authored entities by id; a replayed log cannot inflate it, an undo cannot regress the step', () => {
    const h = harness([RHYTHM], { initial: { completed: [], step: { rhythm: 2 } } });
    markPlacedEntity('authored:1', 'mushroom');
    markPlacedEntity('authored:1', 'mushroom'); // replay of the same PlaceCommand
    markPlacedEntity('authored:2', 'accordion_palm'); // wrong type
    assert.equal(placedEntityCount('mushroom'), 1);
    assert.equal(stepOf(h.system, 'rhythm'), 2);
    unmarkPlacedEntity('authored:1');
    markPlacedEntity('authored:1', 'mushroom');
    markPlacedEntity('authored:3', 'mushroom');
    assert.deepEqual(h.system.getProgress().completed, ['rhythm']);
    unmarkPlacedEntity('authored:3');
    assert.deepEqual(h.system.getProgress().completed, ['rhythm'], 'undo does not un-complete');
});

test('build: the source is PlaceCommand (apply marks, revert unmarks)', () => {
    const src = readFileSync(
        join(ROOT, 'src', 'systems', 'authoring', 'world-commands.ts'),
        'utf8'
    );
    const place = src.slice(src.indexOf('export class PlaceCommand'), src.indexOf('serialize()'));
    assert.match(
        place,
        /apply\(\)[\s\S]*markPlacedEntity\(this\.snapshot\.id, this\.snapshot\.entity\.type\)/
    );
    assert.match(place, /revert\(\)[\s\S]*unmarkPlacedEntity\(this\.snapshot\.id\)/);
});

test('replayed cues: the same cue many times announces and grants once', () => {
    const h = harness([RHYTHM], { initial: { completed: [], step: { rhythm: 2 } } });
    markPlacedEntity('a', 'mushroom');
    markPlacedEntity('b', 'mushroom');
    for (let i = 0; i < 5; i++) emitObjectiveCue({ kind: 'build' });
    assert.deepEqual(h.grants, [['fern_core', 2]]);
    assert.equal(h.calls.filter(([e]) => e === 'completed').length, 1);
});

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

test('season: dormant out of season, active in it, keeps its step across a season change', () => {
    const h = harness([WINTER]);
    assert.equal(h.system.getViews()[0].status, 'dormant');
    assert.equal(h.system.getViews()[0].season, 'winter');
    reportBiome('night_market');
    assert.equal(stepOf(h.system, 'winter'), undefined, 'not evaluated out of season');
    assert.deepEqual(h.calls, []);

    h.setSeason('winter');
    assert.deepEqual(h.calls, [['step', 'Winter']], 'standing in the market as winter arrives');
    h.setSeason('spring');
    assert.equal(stepOf(h.system, 'winter'), 1);
    assert.equal(h.system.getViews()[0].status, 'dormant');
    reportBiome('sugar_caves');
    assert.equal(stepOf(h.system, 'winter'), 1, 'paused out of season');

    h.setSeason('winter');
    h.setSeason('winter');
    assert.deepEqual(h.system.getProgress().completed, ['winter']);
    h.setSeason('spring');
    assert.equal(h.system.getViews()[0].status, 'completed', 'completed stays completed');
    assert.deepEqual(h.grants, [['vibrato_nectar', 1]]);
});

test('season: a completed seasonal Melody opens its dependants in any season', () => {
    const h = harness([WINTER, AFTER_WINTER], { initial: { completed: ['winter'], step: {} } });
    assert.equal(h.system.getViews()[1].status, 'active');
    markPlacedEntity('x', 'grass');
    assert.ok(h.system.getProgress().completed.includes('after'));
});

// ---------------------------------------------------------------------------
// Rewards, reloads, late loads and merges
// ---------------------------------------------------------------------------

test('rewards: granted once, even though the grant re-enters evaluate', () => {
    const h = harness([RHYTHM], { initial: { completed: [], step: { rhythm: 2 } } });
    markPlacedEntity('a', 'mushroom');
    markPlacedEntity('b', 'mushroom');
    assert.deepEqual(h.grants, [['fern_core', 2]]);
    assert.equal(h.inventory.fern_core, 2);
    h.system.evaluate();
    assert.deepEqual(h.grants, [['fern_core', 2]]);
});

test('save/reload: restored progress does not re-grant or re-announce', () => {
    const first = harness([RHYTHM], { initial: { completed: [], step: { rhythm: 2 } } });
    markPlacedEntity('a', 'mushroom');
    markPlacedEntity('b', 'mushroom');
    const saved = first.system.getProgress();
    first.off();

    const second = harness([RHYTHM], { initial: saved });
    second.system.evaluate();
    emitObjectiveCue({ kind: 'build' });
    assert.deepEqual(second.grants, []);
    assert.deepEqual(second.calls, []);
});

test('late load: a chunk that starts after the world is satisfied still grants exactly once', () => {
    markPlacedEntity('a', 'mushroom');
    markPlacedEntity('b', 'mushroom');
    // The visit and the streak are present-tense, so the saved step carries them.
    const h = harness([RHYTHM], { initial: { completed: [], step: { rhythm: 2 } } });
    h.system.evaluate();
    assert.deepEqual(h.grants, [['fern_core', 2]]);
});

test('shared-world merge: completion that arrives by apply grants nothing', () => {
    const h = harness([RHYTHM]);
    h.system.apply({ completed: ['rhythm'], step: {} });
    assert.deepEqual(h.grants, []);
    assert.deepEqual(h.calls, []);
    assert.equal(h.system.getViews()[0].status, 'completed');
});

test('shared-world merge: a step from a peer is kept, and never lost to a lower local one', () => {
    const h = harness([RHYTHM]);
    reportBiome('sugar_caves');
    assert.equal(stepOf(h.system, 'rhythm'), 1);
    h.system.apply({ completed: [], step: { rhythm: 2 } });
    assert.equal(stepOf(h.system, 'rhythm'), 2);
    h.system.apply({ completed: [], step: { rhythm: 0 } });
    assert.equal(stepOf(h.system, 'rhythm'), 2);
});

test('shared-world merge: two clients completing apart do not double the reward', () => {
    const a = emptyProgress();
    const b = emptyProgress();
    // Both had 1 fern core, each completed the Melody locally and was granted 2.
    a.inventory = { fern_core: 3 };
    b.inventory = { fern_core: 3 };
    a.melodies = { completed: ['rhythm'], step: {} };
    b.melodies = { completed: ['rhythm'], step: {} };
    const u = unionProgress(a, b);
    assert.equal(u.inventory.fern_core, 3);
    assert.deepEqual(u.melodies.completed, ['rhythm']);
});

if (failures > 0) {
    console.error(`\n${failures} objectives-triggers test(s) failed`);
    process.exit(1);
}
console.log('\nobjectives-triggers: all tests passed');
