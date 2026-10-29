/**
 * WorldDocument unit tests: schema validation (and its player-facing errors),
 * the migration table (one test per hop), the `.candyworld` codec, command
 * compaction, the memory store, and the session's command log against a fake
 * history.
 *
 * Run: npx tsx --import ./tests/support/register-wasm-hooks.mjs tests/world-document.test.ts
 */

import assert from 'node:assert/strict';
import { EditHistory, type WorldCommand } from '../src/systems/edit-history.ts';
import {
    CURRENT_SNAPSHOT_VERSION,
    type EntitySnapshot,
} from '../src/systems/entity-snapshot-core.ts';
import { NIGHT_MARKET_STAMP_PREFIX } from '../src/systems/night-market-stamps.ts';
import {
    decodeCandyWorld,
    encodeCandyWorld,
    candyWorldFileName,
} from '../src/world/document/codec.ts';
import { compactCommands, compactLog } from '../src/world/document/compaction.ts';
import { STAMP_PREFIX } from '../src/world/document/legacy-records.ts';
import {
    detectSchema,
    migrateWorldDocument,
    parseWorldDocument,
} from '../src/world/document/migrations.ts';
import { unionProgress } from '../src/world/document/progress-bridge.ts';
import {
    WORLD_DOCUMENT_SCHEMA,
    WorldDocumentError,
    createEmptyDocument,
    emptyProgress,
    newDocumentId,
    validateWorldDocument,
    type DocumentCommand,
    type WorldDocumentV1,
} from '../src/world/document/schema.ts';
import { WorldDocumentSession } from '../src/world/document/session.ts';
import { MemoryDocumentStore } from '../src/world/document/store.ts';

let failures = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err instanceof Error ? err.stack : String(err)}`);
    }
}

function quiet<T>(fn: () => T): T {
    const original = console.warn;
    console.warn = () => {};
    try {
        return fn();
    } finally {
        console.warn = original;
    }
}

function snap(id: string, x = 0, extra: Record<string, unknown> = {}): EntitySnapshot {
    return {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id,
        entity: { type: 'mushroom', position: [x, 0, 0], params: {}, ...extra },
    };
}

function doc(overrides: Partial<WorldDocumentV1> = {}): WorldDocumentV1 {
    return {
        ...createEmptyDocument({ seed: 7, mapVersion: '1.0', id: 'doc-1', now: 100 }),
        ...overrides,
    };
}

/** The pre-document save-slot export (`SaveData` 1.0.0). */
const LEGACY_SAVE = {
    metadata: {
        version: '1.0.0',
        timestamp: 1700000000000,
        playtime: 42,
        slotId: 'manual-1',
        slotName: 'My Grove',
        isAutoSave: false,
    },
    player: {
        position: { x: 5, y: 3, z: -2 },
        rotation: { x: 0, y: 1.25, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        unlockedAbilities: ['dash'],
        energy: 10,
        maxEnergy: 10,
        currentState: 'default',
        airJumpsLeft: 1,
        hasShield: false,
        isPhasing: false,
        isInvisible: false,
    },
    world: {
        timeOfDay: 0.5,
        weatherState: 'clear',
        weatherIntensity: 0,
        stormCharge: 0,
        season: 'spring',
        seasonProgress: 0,
        moonPhase: 0,
        entitySnapshots: [
            snap('placed-a', 3),
            { id: 'flat', type: 'mushroom', position: [0, 0, 0] },
        ],
    },
    progress: {
        discoveredEntities: ['tremolo_tulip', 'night_market_stamp:stall_1'],
        collectionCounts: {},
        milestones: [],
        playtime: 42,
        unlocks: ['arpeggio_shield'],
        inventory: { fern_core: 3 },
        awakenedFlora: [
            {
                persistentId: 99,
                entityId: '99',
                type: 'luminous_plant',
                awakenedAt: 5,
                emissiveScale: 1.4,
            },
        ],
    },
    settings: {},
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

await test('an empty document validates', () => {
    const result = validateWorldDocument(doc());
    assert.ok(result.ok);
    assert.equal(result.doc.schema, WORLD_DOCUMENT_SCHEMA);
});

await test('ids are v4 UUIDs', () => {
    assert.match(
        newDocumentId(),
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
});

await test('every command shape validates, including nested batches', () => {
    const commands: DocumentCommand[] = [
        { type: 'place', snapshot: snap('a') },
        { type: 'remove', snapshot: snap('b') },
        { type: 'move', from: snap('a'), to: snap('a', 4) },
        { type: 'paint', from: snap('a'), to: snap('a', 0, { params: { color: 0xff69b4 } }) },
        {
            type: 'batch',
            label: 'x',
            commands: [{ type: 'batch', commands: [{ type: 'remove', snapshot: snap('c') }] }],
        },
    ];
    assert.ok(validateWorldDocument(doc({ commands })).ok);
});

await test('malformed documents are refused with a message a player can read', () => {
    const cases: Array<[unknown, RegExp]> = [
        [{ ...doc(), commands: [{ type: 'teleport' }] }, /commands\.0/],
        [
            {
                ...doc(),
                commands: [
                    {
                        type: 'place',
                        snapshot: {
                            ...snap('a'),
                            entity: { type: 'mushroom', position: [0, 'x', 0] },
                        },
                    },
                ],
            },
            /commands\.0\.snapshot\.entity\.position\.1/,
        ],
        [{ ...doc(), seed: 1.5 }, /seed/],
        [
            { ...doc(), progress: { ...emptyProgress(), discoveries: [42] } },
            /progress\.discoveries\.0/,
        ],
        [
            { ...doc(), player: { position: [0, 0, 0], yaw: 0, season: 'monsoon' } },
            /player\.season/,
        ],
    ];
    for (const [raw, where] of cases) {
        const result = parseWorldDocument(raw);
        assert.equal(result.ok, false, JSON.stringify(raw).slice(0, 80));
        if (result.ok) continue;
        assert.ok(result.error instanceof WorldDocumentError);
        assert.match(result.error.userMessage, /damaged or from an unsupported build/);
        assert.match(result.error.userMessage, where);
    }
});

await test('a newer schema asks the player to update', () => {
    const result = parseWorldDocument({ ...doc(), schema: WORLD_DOCUMENT_SCHEMA + 1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.userMessage, /newer version of Candy World/);
});

await test('something that is not a world says so', () => {
    for (const raw of [null, 3, 'hi', [], { hello: 'world' }]) {
        const result = parseWorldDocument(raw);
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.error.userMessage, /isn't a Candy World world/);
    }
});

// ---------------------------------------------------------------------------
// Migrations (one test per hop)
// ---------------------------------------------------------------------------

await test('detectSchema: number field, else a legacy save is schema 0', () => {
    assert.equal(detectSchema(doc()), 1);
    assert.equal(detectSchema(LEGACY_SAVE), 0);
});

await test('hop 0 → 1: a legacy save-slot export becomes a v1 document', () => {
    const { doc: raw, fromSchema } = quiet(() =>
        migrateWorldDocument(LEGACY_SAVE, { seed: 4242, mapVersion: '1.0', now: 9 })
    );
    assert.equal(fromSchema, 0);
    const result = validateWorldDocument(raw);
    assert.ok(result.ok, result.ok ? '' : result.error.message);
    const v1 = result.doc;
    assert.equal(v1.id, 'legacy-save-manual-1');
    assert.equal(v1.seed, 4242);
    assert.equal(v1.meta.title, 'My Grove');
    assert.equal(v1.meta.createdAt, 1700000000000);
    assert.deepEqual(v1.player, { position: [5, 3, -2], yaw: 1.25 });
    assert.deepEqual(
        v1.commands.map((c) => c.type === 'place' && c.snapshot.id),
        ['placed-a'],
        'flat pre-v2 record skipped'
    );
    assert.deepEqual(v1.progress.discoveries, ['tremolo_tulip']);
    assert.deepEqual(v1.progress.stamps, ['night_market_stamp:stall_1']);
    assert.deepEqual(v1.progress.unlocks.sort(), ['arpeggio_shield', 'dash']);
    assert.deepEqual(v1.progress.inventory, { fern_core: 3 });
    assert.deepEqual(
        v1.progress.awakened.map((a) => a.persistentId),
        [99]
    );
});

await test('the stamp prefix matches the Night Market module', () => {
    assert.equal(STAMP_PREFIX, NIGHT_MARKET_STAMP_PREFIX);
});

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

await test('.candyworld: gzip round trip, plain JSON, and a legacy save file all open', async () => {
    const original = doc({ commands: [{ type: 'place', snapshot: snap('a', 2) }] });
    original.meta.title = 'Pastel Grove!';
    const bytes = await encodeCandyWorld(original);
    assert.deepEqual([bytes[0], bytes[1]], [0x1f, 0x8b]);
    const back = await decodeCandyWorld(bytes);
    assert.ok(back.ok);
    assert.deepEqual(back.doc, original);
    assert.equal(candyWorldFileName(original), 'pastel-grove.candyworld');

    const plain = await decodeCandyWorld(new TextEncoder().encode(JSON.stringify(original)));
    assert.ok(plain.ok && plain.fromSchema === 1);

    const legacy = await decodeCandyWorld(JSON.stringify(LEGACY_SAVE));
    assert.ok(legacy.ok && legacy.fromSchema === 0);
});

await test('.candyworld: damaged bytes are refused, not thrown', async () => {
    const notJson = await decodeCandyWorld(new TextEncoder().encode('{"schema": 1, '));
    assert.equal(notJson.ok, false);
    if (!notJson.ok) assert.match(notJson.error.userMessage, /damaged and can't be read/);
    const badGzip = await decodeCandyWorld(new Uint8Array([0x1f, 0x8b, 1, 2, 3]));
    assert.equal(badGzip.ok, false);
    const huge = await decodeCandyWorld(new Uint8Array(9 * 1024 * 1024));
    assert.equal(huge.ok, false);
    if (!huge.ok) assert.match(huge.error.userMessage, /too large/);
});

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

await test('compaction folds each entity to its net change', () => {
    const a1 = snap('a', 1);
    const a2 = snap('a', 2);
    const b = snap('b', 5);
    const base = snap('base', 9);
    const moved = snap('base', 10);
    const commands: DocumentCommand[] = [
        { type: 'place', snapshot: a1 },
        { type: 'move', from: a1, to: a2 },
        { type: 'place', snapshot: b },
        { type: 'remove', snapshot: b },
        { type: 'move', from: base, to: moved },
        {
            type: 'batch',
            commands: [
                { type: 'paint', from: moved, to: snap('base', 10, { params: { color: 1 } }) },
            ],
        },
        { type: 'remove', snapshot: snap('gone', 0) },
    ];
    assert.deepEqual(compactCommands(commands), [
        { type: 'place', snapshot: a2 },
        { type: 'move', from: base, to: snap('base', 10, { params: { color: 1 } }) },
        { type: 'remove', snapshot: snap('gone', 0) },
    ]);
    // A move that ends where it started is no change at all.
    assert.deepEqual(
        compactCommands([
            { type: 'move', from: a1, to: a2 },
            { type: 'move', from: a2, to: a1 },
        ]),
        []
    );
});

await test('compactLog keeps the undoable tail one-for-one', () => {
    const log: DocumentCommand[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'place' as const,
        snapshot: snap('same', i),
    }));
    const out = compactLog(log, 3, 5);
    assert.equal(out.length, 4, 'the 7-command prefix folds to one place');
    assert.deepEqual(out.slice(1), log.slice(7));
    assert.deepEqual(compactLog(log, 3, 64), log, 'below the threshold nothing folds');
});

// ---------------------------------------------------------------------------
// Store + session
// ---------------------------------------------------------------------------

await test('MemoryDocumentStore validates on load and lists newest first', async () => {
    const store = new MemoryDocumentStore();
    await store.save(doc({ id: 'old', meta: { createdAt: 1, updatedAt: 1, title: 'Old' } }));
    await store.save(doc({ id: 'new', meta: { createdAt: 1, updatedAt: 5 } }));
    assert.deepEqual(
        (await store.list()).map((s) => s.id),
        ['new', 'old']
    );
    assert.equal((await store.load('old'))?.meta.title, 'Old');
    assert.equal(await store.load('missing'), null);
    await store.delete('old');
    assert.deepEqual(
        (await store.list()).map((s) => s.id),
        ['new']
    );
});

class FakeCommand implements WorldCommand {
    applied = 0;
    constructor(
        readonly id: string,
        private readonly opts: { failRevert?: boolean } = {}
    ) {}
    apply(): void {
        this.applied++;
    }
    revert(): void {
        if (this.opts.failRevert) throw new Error('no removal path');
        this.applied--;
    }
    serialize(): DocumentCommand {
        return { type: 'place', snapshot: snap(this.id) };
    }
}

function ids(session: WorldDocumentSession): string[] {
    return session.commands().map((c) => (c.type === 'place' ? c.snapshot.id : c.type));
}

function session(history: EditHistory, store = new MemoryDocumentStore(), start = doc()) {
    return new WorldDocumentSession(start, {
        history,
        store,
        readProgress: emptyProgress,
        saveDelayMs: 60_000,
    });
}

await test('session log follows execute / undo / redo by identity', () => {
    const history = new EditHistory();
    const s = session(history);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => new FakeCommand(id));
    history.execute(a);
    history.execute(b);
    history.execute(c);
    assert.deepEqual(ids(s), ['a', 'b', 'c']);
    history.undo();
    history.undo();
    assert.deepEqual(ids(s), ['a']);
    history.redo();
    assert.deepEqual(ids(s), ['a', 'b']);
    s.dispose();
});

await test('a command whose undo fails stays in the log (its effect is still live)', () => {
    const history = new EditHistory();
    const s = session(history);
    history.execute(new FakeCommand('ok'));
    history.execute(new FakeCommand('stuck', { failRevert: true }));
    assert.equal(
        quiet(() => history.undo()),
        false
    );
    assert.deepEqual(ids(s), ['ok', 'stuck']);
    // The next undo reverts 'ok', not 'stuck'.
    history.undo();
    assert.deepEqual(ids(s), ['stuck']);
    s.dispose();
});

await test('commands pushed past the history cap stay in the document', () => {
    const history = new EditHistory(3);
    const s = session(history);
    for (let i = 0; i < 6; i++) history.execute(new FakeCommand(`c${i}`));
    assert.equal(history.undoCount, 3);
    assert.deepEqual(ids(s), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
    while (history.undo());
    assert.deepEqual(ids(s), ['c0', 'c1', 'c2'], 'only undoable steps leave the log');
    s.dispose();
});

await test('replayed commands are not undo steps', () => {
    const history = new EditHistory();
    const s = session(history, new MemoryDocumentStore(), doc({ commands: [] }));
    assert.deepEqual(s.replay(), { applied: 0, failed: 0 });
    history.execute(new FakeCommand('later'));
    assert.equal(history.undoCount, 1);
    s.dispose();
});

await test('save writes once per change and carries the title', async () => {
    const store = new MemoryDocumentStore();
    let writes = 0;
    const counting = Object.assign(Object.create(store) as MemoryDocumentStore, {
        save: (d: WorldDocumentV1) => {
            writes++;
            return store.save(d);
        },
    });
    const history = new EditHistory();
    const s = session(history, counting);
    await s.save();
    await s.save();
    assert.equal(writes, 1, 'unchanged document is not rewritten');
    history.execute(new FakeCommand('x'));
    s.setTitle('Lollipop Hill');
    await s.save();
    assert.equal(writes, 2);
    const stored = await store.load('doc-1');
    assert.equal(stored?.meta.title, 'Lollipop Hill');
    assert.deepEqual(
        stored?.commands.map((c) => c.type),
        ['place']
    );
    s.dispose();
});

await test('progress only grows when documents and live state meet', () => {
    const a = {
        ...emptyProgress(),
        discoveries: ['x'],
        inventory: { gem: 2 },
        partII: { sugarCavesUnlocked: true },
    };
    const b = {
        ...emptyProgress(),
        discoveries: ['y'],
        inventory: { gem: 5, nectar: 1 },
        awakened: [{ persistentId: 1, type: 't', awakenedAt: 3 }],
    };
    const u = unionProgress(a, b);
    assert.deepEqual(u.discoveries, ['x', 'y']);
    assert.deepEqual(u.inventory, { gem: 5, nectar: 1 });
    assert.equal(u.partII.sugarCavesUnlocked, true);
    assert.equal(u.awakened.length, 1);
});

if (failures > 0) {
    console.error(`\n${failures} world-document test(s) failed`);
    process.exit(1);
}
console.log('\nAll world-document tests passed');
