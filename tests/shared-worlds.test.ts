/**
 * Shared worlds (#1975): the validator, the validate-world edge handler, the
 * RemoteDocumentStore and the offline-first sync, against an in-memory
 * backend that applies the table's RLS rules (tests/support/memory-worlds-backend.ts).
 * The SQL policies themselves are tested on Postgres by `npm run test:supabase-rls`.
 *
 * Run: npx tsx --import ./tests/support/register-wasm-hooks.mjs tests/shared-worlds.test.ts
 */

import assert from 'node:assert/strict';
import {
    handleValidateWorld,
    type WorldRow,
    type WorldWriteStore,
    WorldStoreError,
} from '../supabase/functions/validate-world/handler.ts';
import type { EntitySnapshot } from '../src/systems/entity-snapshot-types.ts';
import { SYSTEM_BUDGETS } from '../src/systems/performance-budget/systems-budget.ts';
import { computeSeasonState, createSeasonState } from '../src/systems/season-core.ts';
import { SEASON_DEFAULTS } from '../src/core/config/season.ts';
import { authoredEntityStates, documentStateHash } from '../src/world/document/entity-state.ts';
import { RemoteDocumentStore, SharedWorldError } from '../src/world/document/remote-store.ts';
import {
    createEmptyDocument,
    type DocumentCommand,
    type WorldDocumentV1,
} from '../src/world/document/schema.ts';
import {
    MemorySyncMetaStore,
    SharedWorldSync,
    changedSince,
    entityHashes,
    mergeSharedDocuments,
} from '../src/world/document/shared-sync.ts';
import {
    SHARED_WORLD_LIMITS,
    validateSharedWorld,
} from '../src/world/document/shared-validation.ts';
import { MemoryDocumentStore } from '../src/world/document/store.ts';
import { buildWorldShareUrl, readWorldInviteFromURL } from '../src/systems/net/share-links.ts';
import { readSharedWorldIdFromURL } from '../src/world/world-seed.ts';
import { MemoryWorldsBackend, MemoryWorldsDb } from './support/memory-worlds-backend.ts';

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

let uuidCounter = 0;
function uuid(): string {
    uuidCounter++;
    return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`;
}

function snap(
    id: string,
    x: number,
    z: number,
    params: Record<string, unknown> = {}
): EntitySnapshot {
    return {
        schemaVersion: 2,
        id,
        entity: {
            type: 'mushroom',
            position: [x, 0.5, z],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            variant: 'regular',
            hasFace: false,
            placement: 'absolute',
            params,
        },
    };
}

function doc(commands: DocumentCommand[] = [], id = uuid(), title = 'Grove'): WorldDocumentV1 {
    const d = createEmptyDocument({ seed: 12345, mapVersion: '1.0', id, title, now: 1 });
    d.commands = commands;
    return d;
}

const places = (n: number, at: (i: number) => [number, number]): DocumentCommand[] =>
    Array.from({ length: n }, (_, i) => ({
        type: 'place' as const,
        snapshot: snap(`p${i}`, ...at(i)),
    }));

const spread = (i: number): [number, number] => [(i % 20) * 33, Math.floor(i / 20) * 33];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------

await test('shared-world caps are the build-mode budget caps', () => {
    const caps = SYSTEM_BUDGETS.authoring.caps as { perChunk: number; total: number };
    assert.equal(SHARED_WORLD_LIMITS.maxEntities, caps.total);
    assert.equal(SHARED_WORLD_LIMITS.maxEntitiesPerChunk, caps.perChunk);
});

await test('validateSharedWorld: schema, identity, caps, palette, size', () => {
    assert.ok(validateSharedWorld(doc(places(10, spread))).ok, 'a small world passes');
    const ok = validateSharedWorld(doc(places(600, spread)));
    assert.ok(ok.ok && ok.stats.entities === 600, '600 pieces is the limit');

    const expect = (raw: unknown, code: string, label: string) => {
        const r = validateSharedWorld(raw);
        assert.ok(
            !r.ok && r.code === code,
            `${label}: ${r.ok ? 'passed' : r.code + ' ' + r.message}`
        );
    };
    expect(doc(places(601, spread)), 'over_cap', '601 pieces');
    expect(doc(places(49, (i) => [i * 0.5, 1])), 'over_cap', '49 pieces in one chunk');
    expect({ ...doc(), schema: 2 }, 'schema', 'future schema');
    expect({ ...doc(), id: 'not-a-uuid' }, 'identity', 'non-uuid id');
    const p = snap('paint', 0, 0, { color: 0xff69b4 });
    expect(
        doc([{ type: 'paint', from: p, to: snap('paint', 0, 0, { color: 0x123456 }) }]),
        'palette',
        'grey paint'
    );
    const big = snap('big', 0, 0, { blob: 'x'.repeat(SHARED_WORLD_LIMITS.maxDocumentChars) });
    expect(doc([{ type: 'place', snapshot: big }]), 'too_large', '8 MB of params');

    // Removing pieces and moving pieces back don't count against the caps.
    const churn: DocumentCommand[] = [...places(600, spread)];
    for (let i = 0; i < 50; i++)
        churn.push({ type: 'remove', snapshot: snap(`p${i}`, ...spread(i)) });
    churn.push(
        ...Array.from({ length: 50 }, (_, i) => ({
            type: 'place' as const,
            snapshot: snap(`q${i}`, ...spread(i)),
        }))
    );
    assert.ok(validateSharedWorld(doc(churn)).ok, '600 live after churn');

    // A no-op move is still a piece replay places: it counts.
    const noop = (i: number): DocumentCommand => {
        const at = snap(`m${i}`, i * 0.5, 1);
        return { type: 'move', from: at, to: clone(at) };
    };
    expect(doc(Array.from({ length: 49 }, (_, i) => noop(i))), 'over_cap', '49 no-op moves');
    expect(
        doc([
            { type: 'place', snapshot: snap('c', 0, 0) },
            { type: 'move', from: snap('c', 0, 0), to: snap('c', 0, 0, { color: 0x123456 }) },
        ]),
        'palette',
        'a recolouring move is a paint'
    );
    expect(
        doc([{ type: 'place', snapshot: snap('c', 0, 0, { color: 0x123456 }) }]),
        'palette',
        'an off-palette placement'
    );
});

// ---------------------------------------------------------------------------
// The edge handler
// ---------------------------------------------------------------------------

function fakeStore(
    rows = new Map<string, WorldRow>(),
    caller: { id: string; anonymous: boolean } | null = { id: 'u1', anonymous: false },
    members = new Map<string, 'editor' | 'viewer'>()
): WorldWriteStore & { rows: Map<string, WorldRow> } {
    let t = 0;
    return {
        rows,
        async caller() {
            return caller;
        },
        async get(id) {
            return rows.get(id) ? clone(rows.get(id)!) : null;
        },
        async memberRole(_world, user) {
            return members.get(user) ?? null;
        },
        async insert(row) {
            const r: WorldRow = { ...row, created_at: `t${++t}`, updated_at: `t${t}` };
            rows.set(row.id, r);
            return clone(r);
        },
        async update(id, patch, expected) {
            const r = rows.get(id);
            if (!r || (expected && r.updated_at !== expected)) return null;
            Object.assign(r, patch, { updated_at: `t${++t}` });
            return clone(r);
        },
    };
}

const post = (body: unknown) =>
    new Request('http://edge/validate-world', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });

const codeOf = async (res: Response) => ((await res.json()) as { code: string }).code;

await test('validate-world: methods, bad bodies and invalid documents', async () => {
    const store = fakeStore();
    assert.equal(
        (await handleValidateWorld(new Request('http://edge', { method: 'OPTIONS' }), store))
            .status,
        204
    );
    assert.equal(
        (await handleValidateWorld(new Request('http://edge', { method: 'GET' }), store)).status,
        405
    );
    assert.equal((await handleValidateWorld(post('{nope'), store)).status, 400);
    const res = await handleValidateWorld(post({ doc: { ...doc(), schema: 7 } }), store);
    assert.equal(res.status, 422);
    assert.equal(await codeOf(res), 'schema');
    const over = await handleValidateWorld(post({ doc: doc(places(601, spread)) }), store);
    assert.equal(over.status, 422, 'over-cap world refused server-side');
    assert.equal(
        (await handleValidateWorld(post({ doc: doc(), visibility: 'everyone' }), store)).status,
        400,
        'unknown visibility'
    );
    assert.equal(
        (await handleValidateWorld(post({ doc: doc(), entityClock: { e: [1] } }), store)).status,
        422,
        'malformed clock'
    );
    assert.equal(store.rows.size, 0, 'nothing written');
    const dry = await handleValidateWorld(
        post({ doc: doc(places(3, spread)), dryRun: true }),
        store
    );
    assert.equal(dry.status, 200);
    assert.equal(((await dry.json()) as { stats: { entities: number } }).stats.entities, 3);
    assert.equal(store.rows.size, 0, 'a dry run writes nothing');
    assert.equal(dry.headers.get('Access-Control-Allow-Origin'), '*', 'CORS for the browser');
    const nobody = fakeStore(new Map(), null);
    const anon = await handleValidateWorld(post({ doc: doc() }), nobody);
    assert.equal(anon.status, 401, 'no signed-in caller, no write');
    assert.equal(nobody.rows.size, 0);
});

await test('validate-world: insert, update, conflict, terrain, database errors', async () => {
    const store = fakeStore();
    const d = doc(places(2, spread), uuid(), '  A   grove  ');
    const created = await handleValidateWorld(post({ doc: d, visibility: 'private' }), store);
    assert.equal(created.status, 201);
    const row = store.rows.get(d.id)!;
    assert.equal(row.owner, 'u1', 'the caller owns what they publish');
    assert.equal(row.title, 'A grove', 'title tidied');
    assert.equal(row.visibility, 'private');
    const body = (await created.json()) as { world: Record<string, unknown> };
    assert.ok(!('doc' in body.world), 'the response leaves the document out');

    const updated = await handleValidateWorld(
        post({
            doc: d,
            rev: 4,
            entityClock: { p0: [4, 'peer-a'] },
            expectedUpdatedAt: row.updated_at,
        }),
        store
    );
    assert.equal(updated.status, 200);
    assert.equal(store.rows.get(d.id)!.rev, 4);

    const stale = await handleValidateWorld(post({ doc: d, expectedUpdatedAt: 'long ago' }), store);
    assert.equal(stale.status, 409);
    assert.equal(await codeOf(stale), 'conflict');

    const blind = await handleValidateWorld(post({ doc: d }), store);
    assert.equal(blind.status, 409, 'an existing world is never overwritten blind');
    assert.equal(await codeOf(blind), 'exists');

    const current = store.rows.get(d.id)!.updated_at;
    const elsewhere = { ...d, seed: 999 };
    assert.equal(
        (await handleValidateWorld(post({ doc: elsewhere, expectedUpdatedAt: current }), store))
            .status,
        409,
        'terrain mismatch'
    );

    let deleted = false;
    const vanishing: WorldWriteStore = {
        ...store,
        get: async (id) => (deleted ? null : store.get(id)),
        update: async () => {
            deleted = true;
            return null;
        },
    };
    assert.equal(
        (await handleValidateWorld(post({ doc: d, expectedUpdatedAt: current }), vanishing)).status,
        404,
        'deleted while saving'
    );

    const failing = (sqlstate: string): WorldWriteStore => ({
        ...fakeStore(),
        insert: async () => {
            throw new WorldStoreError('refused', sqlstate);
        },
    });
    assert.equal((await handleValidateWorld(post({ doc: doc() }), failing('42501'))).status, 403);
    assert.equal((await handleValidateWorld(post({ doc: doc() }), failing('23505'))).status, 409);
    assert.equal((await handleValidateWorld(post({ doc: doc() }), failing('22023'))).status, 422);
    assert.equal((await handleValidateWorld(post({ doc: doc() }), failing('08006'))).status, 502);
});

await test('validate-world: who may write what', async () => {
    const rows = new Map<string, WorldRow>();
    const members = new Map<string, 'editor' | 'viewer'>([
        ['ed', 'editor'],
        ['view', 'viewer'],
    ]);
    const as = (id: string, anonymous = false) => fakeStore(rows, { id, anonymous }, members);
    const d = doc(places(2, spread), uuid(), 'Grove');
    assert.equal((await handleValidateWorld(post({ doc: d }), as('owner'))).status, 201);
    const at = () => rows.get(d.id)!.updated_at;
    const edit = (extra: Record<string, unknown> = {}) =>
        post({ doc: { ...d, commands: places(3, spread) }, expectedUpdatedAt: at(), ...extra });

    for (const user of ['view', 'stranger']) {
        const res = await handleValidateWorld(edit(), as(user));
        assert.equal(res.status, 403, `${user} cannot write the document`);
        assert.equal(await codeOf(res), 'forbidden');
    }
    assert.equal(
        (await handleValidateWorld(edit(), as('ed', true))).status,
        200,
        'an editor saves, anonymous or not'
    );
    assert.equal(
        (await handleValidateWorld(edit({ title: 'Grove' }), as('ed'))).status,
        200,
        'naming the current title is no rename'
    );
    assert.equal((await handleValidateWorld(edit({ title: 'Mine now' }), as('ed'))).status, 403);
    assert.equal(
        (await handleValidateWorld(edit({ visibility: 'public' }), as('ed'))).status,
        403,
        'an editor cannot change who sees it'
    );
    assert.equal(rows.get(d.id)!.title, 'Grove');

    const anonPublic = await handleValidateWorld(edit({ visibility: 'public' }), as('owner', true));
    assert.equal(anonPublic.status, 403);
    assert.equal(await codeOf(anonPublic), 'account_needed', 'public needs a permanent account');
    const fresh = doc([], uuid());
    assert.equal(
        await codeOf(
            await handleValidateWorld(post({ doc: fresh, visibility: 'public' }), as('a', true))
        ),
        'account_needed'
    );
    assert.equal(
        (await handleValidateWorld(edit({ visibility: 'public', title: 'Big grove' }), as('owner')))
            .status,
        200
    );
    assert.equal(rows.get(d.id)!.visibility, 'public');
    assert.equal(rows.get(d.id)!.title, 'Big grove');
});

await test('validate-world: the co-editing clock is bounded', async () => {
    const store = fakeStore();
    const d = doc(places(1, spread));
    assert.equal((await handleValidateWorld(post({ doc: d, rev: 0 }), store)).status, 201);
    const at = () => store.rows.get(d.id)!.updated_at;
    const jump = await handleValidateWorld(
        post({ doc: d, rev: SHARED_WORLD_LIMITS.maxRevJump + 1, expectedUpdatedAt: at() }),
        store
    );
    assert.equal(jump.status, 422, 'rev cannot leap');
    assert.equal(await codeOf(jump), 'clock');
    const ahead = await handleValidateWorld(
        post({ doc: d, rev: 5, entityClock: { p0: [6, 'peer'] }, expectedUpdatedAt: at() }),
        store
    );
    assert.equal(ahead.status, 422, 'no stamp past the rev it is written with');
    assert.equal(
        (
            await handleValidateWorld(
                post({ doc: d, rev: 6, entityClock: { p0: [6, 'peer'] }, expectedUpdatedAt: at() }),
                store
            )
        ).status,
        200
    );
    assert.equal(
        (await handleValidateWorld(post({ doc: d, rev: 2, expectedUpdatedAt: at() }), store))
            .status,
        200
    );
    assert.equal(store.rows.get(d.id)!.rev, 6, 'rev never goes back');
    assert.equal(store.rows.size, 1);
});

await test('validate-world: remix_of only points at a public world', async () => {
    const store = fakeStore();
    const open = doc([], uuid());
    const hidden = doc([], uuid());
    await handleValidateWorld(post({ doc: open, visibility: 'public' }), store);
    await handleValidateWorld(post({ doc: hidden, visibility: 'unlisted' }), store);
    const a = doc([], uuid());
    const b = doc([], uuid());
    const c = doc([], uuid());
    await handleValidateWorld(post({ doc: a, remixOf: open.id }), store);
    await handleValidateWorld(post({ doc: b, remixOf: hidden.id }), store);
    await handleValidateWorld(post({ doc: c, remixOf: uuid() }), store);
    assert.equal(store.rows.get(a.id)!.remix_of, open.id);
    assert.equal(store.rows.get(b.id)!.remix_of, null, 'an unlisted source stays unnamed');
    assert.equal(store.rows.get(c.id)!.remix_of, null, 'an unknown source is dropped');
});

// ---------------------------------------------------------------------------
// RemoteDocumentStore
// ---------------------------------------------------------------------------

await test('RemoteDocumentStore: publish, open by id, lists, remix, delete', async () => {
    const db = new MemoryWorldsDb();
    const alice = new RemoteDocumentStore(new MemoryWorldsBackend(db, 'alice'));
    const stranger = new RemoteDocumentStore(new MemoryWorldsBackend(db, 'carol'));

    const grove = doc(places(4, spread), uuid(), 'Grove');
    const published = await alice.publish(grove, { visibility: 'unlisted' });
    assert.ok(published.ok && published.created);

    const opened = await stranger.fetch(grove.id);
    assert.ok(opened, 'an unlisted world opens by its link');
    assert.equal(
        documentStateHash(opened.doc.commands),
        documentStateHash(grove.commands),
        'same entities'
    );
    assert.equal(opened.role, null, 'a stranger is no member');
    assert.equal((await alice.load(grove.id))?.id, grove.id, 'DocumentStore.load');
    assert.deepEqual(
        (await alice.list()).map((s) => s.id),
        [grove.id],
        'DocumentStore.list = mine'
    );
    assert.equal((await alice.list())[0].commandCount, 4);

    const bad = await alice.publish(doc(places(601, spread)));
    assert.ok(!bad.ok && bad.code === 'over_cap', 'refused before it leaves the client');

    for (let i = 0; i < 5; i++)
        await alice.publish(doc([], uuid(), `Public ${i}`), { visibility: 'public' });
    const page1 = await stranger.listPublic(null, 3);
    assert.equal(page1.worlds.length, 3);
    assert.ok(page1.next);
    const page2 = await stranger.listPublic(page1.next, 3);
    assert.equal(page2.worlds.length, 2);
    assert.equal(page2.next, null);
    assert.equal(
        new Set([...page1.worlds, ...page2.worlds].map((w) => w.id)).size,
        5,
        'no repeats'
    );
    assert.ok(
        ![...page1.worlds, ...page2.worlds].some((w) => w.id === grove.id),
        'unlisted stays off the gallery'
    );

    const remix = await stranger.remix(grove.id, { now: 5 });
    assert.ok(remix.ok, 'remix');
    assert.notEqual(remix.world.id, grove.id);
    assert.equal(remix.world.remixOf, null, "a remix doesn't name an unlisted source");
    assert.equal(remix.world.owner, 'carol');
    const credited = await stranger.remix(page1.worlds[0].id, { now: 6 });
    assert.ok(credited.ok);
    assert.equal(credited.world.remixOf, page1.worlds[0].id, 'a public source is credited');
    const remixed = await stranger.fetch(remix.world.id);
    assert.equal(
        documentStateHash(remixed!.doc.commands),
        documentStateHash(grove.commands),
        'remix keeps the edits'
    );

    await assert.rejects(stranger.fetch('nope'), SharedWorldError, 'not a world id');
    await stranger.delete(grove.id);
    assert.ok(await alice.fetch(grove.id), "a stranger can't delete it");
    await alice.delete(grove.id);
    assert.equal(await alice.fetch(grove.id), null, 'the owner can');
});

await test('a stored row that fails validation is refused on fetch, never replayed', async () => {
    const db = new MemoryWorldsDb();
    const alice = new RemoteDocumentStore(new MemoryWorldsBackend(db, 'alice'));
    const d = doc(places(2, spread));
    assert.ok((await alice.publish(d)).ok);
    // Someone wrote past the edge function straight into the table.
    (db.rows.get(d.id)!.doc as WorldDocumentV1).commands = places(601, spread);
    await assert.rejects(
        alice.fetch(d.id),
        (err: unknown) => err instanceof SharedWorldError && err.code === 'over_cap'
    );
    assert.equal(await alice.load(d.id), null, 'load() reports it unreadable');
});

await test('editors update the document; only the owner renames', async () => {
    const db = new MemoryWorldsDb();
    const alice = new RemoteDocumentStore(new MemoryWorldsBackend(db, 'alice'));
    const bob = new RemoteDocumentStore(new MemoryWorldsBackend(db, 'bob'));
    const d = doc(places(1, spread));
    assert.ok((await alice.publish(d)).ok);
    const denied = await bob.publish({ ...d, commands: places(2, spread) });
    assert.ok(!denied.ok && denied.code === 'forbidden', 'not a member yet');
    db.addEditor(d.id, 'bob');
    const rec = await bob.fetch(d.id);
    assert.equal(rec?.role, 'editor');
    const saved = await bob.publish(
        { ...d, commands: places(2, spread) },
        { expectedUpdatedAt: rec!.summary.updatedAt }
    );
    assert.ok(saved.ok, 'an editor saves edits');
    const rename = await bob.publish(d, {
        title: 'Bob world',
        expectedUpdatedAt: saved.world.updatedAt,
    });
    assert.ok(!rename.ok && rename.code === 'forbidden', 'an editor cannot rename');
    assert.deepEqual(
        (await bob.listShared()).map((w) => w.id),
        [d.id],
        'shared with me'
    );
});

// ---------------------------------------------------------------------------
// Offline-first sync
// ---------------------------------------------------------------------------

function device(db: MemoryWorldsDb, user: string) {
    const backend = new MemoryWorldsBackend(db, user);
    const local = new MemoryDocumentStore();
    const meta = new MemorySyncMetaStore();
    const remote = new RemoteDocumentStore(backend);
    return {
        backend,
        local,
        meta,
        remote,
        sync: new SharedWorldSync({ local, remote, meta, now: () => 42 }),
    };
}

await test('open: remote only, then local edits survive a reopen; offline uses the local copy', async () => {
    const db = new MemoryWorldsDb();
    const owner = device(db, 'alice');
    const d = doc(places(3, spread));
    assert.equal((await owner.sync.push(d)).status, 'synced', 'first publish');

    const guest = device(db, 'carol');
    const first = await guest.sync.open(d.id);
    assert.equal(first.source, 'remote');
    assert.equal(documentStateHash(first.doc.commands), documentStateHash(d.commands));
    assert.ok(await guest.local.load(d.id), 'kept locally');

    guest.backend.offline = true;
    const offline = await guest.sync.open(d.id);
    assert.equal(offline.source, 'offline');
    assert.equal(offline.doc.id, d.id);

    const fresh = device(db, 'dave');
    fresh.backend.offline = true;
    await assert.rejects(fresh.sync.open(d.id), /Offline/);
});

await test('push: unchanged is a no-op; edits stamp the co-editing clock', async () => {
    const db = new MemoryWorldsDb();
    const owner = device(db, 'alice');
    const d = doc(places(2, spread));
    await owner.sync.push(d);
    assert.equal((await owner.sync.push(d)).status, 'unchanged');
    const moved = clone(d);
    moved.commands.push({ type: 'move', from: snap('p0', ...spread(0)), to: snap('p0', 7, 7) });
    const pushed = await owner.sync.push(moved);
    assert.equal(pushed.status, 'synced');
    const row = db.rows.get(d.id)!;
    assert.equal(row.rev, 1, 'rev bumped');
    assert.deepEqual(row.entity_clock.p0, [1, 'sync-alice'], 'the changed entity is stamped');
    assert.equal(row.entity_clock.p1, undefined, 'an untouched one is not');
    owner.backend.offline = true;
    const later = clone(moved);
    later.commands.push({ type: 'remove', snapshot: snap('p1', ...spread(1)) });
    assert.equal((await owner.sync.push(later)).status, 'offline', 'offline keeps the local copy');
});

await test('two devices edit offline: the second push merges per entity', async () => {
    const db = new MemoryWorldsDb();
    const laptop = device(db, 'alice');
    const base = doc(places(4, spread));
    await laptop.sync.push(base);
    const phone = device(db, 'alice');
    await phone.sync.open(base.id);

    // Laptop moves p0 and p1; the phone moves p1 elsewhere and removes p2. The
    // laptop pushes first, so p1 (changed on both since the phone's base) keeps
    // the laptop's move: a stale copy never reverts what others already have.
    const onLaptop = clone(base);
    onLaptop.commands.push({ type: 'move', from: snap('p0', ...spread(0)), to: snap('p0', 1, 1) });
    onLaptop.commands.push({ type: 'move', from: snap('p1', ...spread(1)), to: snap('p1', 2, 2) });
    const onPhone = clone(base);
    onPhone.commands.push({ type: 'move', from: snap('p1', ...spread(1)), to: snap('p1', 9, 9) });
    onPhone.commands.push({ type: 'remove', snapshot: snap('p2', ...spread(2)) });
    onPhone.progress.discoveries.push('tremolo_tulip');

    assert.equal((await laptop.sync.push(onLaptop)).status, 'synced');
    const merged = await phone.sync.push(onPhone);
    assert.equal(merged.status, 'merged');
    const states = authoredEntityStates(merged.doc.commands);
    assert.deepEqual(states.get('p0')?.entity.position, [1, 0.5, 1], "the laptop's edit is kept");
    assert.deepEqual(
        states.get('p1')?.entity.position,
        [2, 0.5, 2],
        'an entity both changed keeps the version already shared'
    );
    assert.equal(states.get('p2') ?? null, null, "the phone's remove is kept");
    assert.ok(merged.doc.progress.discoveries.includes('tremolo_tulip'), 'progress unions');
    const stored = await laptop.remote.fetch(base.id);
    assert.equal(
        documentStateHash(stored!.doc.commands),
        documentStateHash(merged.doc.commands),
        'what was stored'
    );

    // The laptop reopens: nothing unsynced, so it takes the merged copy.
    const reopened = await laptop.sync.open(base.id);
    assert.equal(reopened.source, 'remote');
    assert.equal(documentStateHash(reopened.doc.commands), documentStateHash(merged.doc.commands));
});

await test("a co-editor's stale copy never reverts later edits when they reopen", async () => {
    const db = new MemoryWorldsDb();
    const alice = device(db, 'alice');
    const base = doc([
        { type: 'place', snapshot: snap('x', 0, 0) },
        { type: 'place', snapshot: snap('y', 40, 0) },
    ]);
    await alice.sync.push(clone(base));
    db.addEditor(base.id, 'bob');
    const bob = device(db, 'bob');
    assert.equal((await bob.sync.open(base.id)).source, 'remote');
    const at = () => db.rows.get(base.id)!.updated_at;
    const withX = (x: number, z: number): WorldDocumentV1 => ({
        ...clone(base),
        commands: [
            { type: 'place', snapshot: snap('x', x, z) },
            { type: 'place', snapshot: snap('y', 40, 0) },
        ],
    });

    // A live room: alice (host) moves x and writes back; bob's autosave keeps
    // the room's log locally without touching his sync meta.
    assert.ok(
        (
            await alice.remote.publish(withX(5, 5), {
                rev: 3,
                entityClock: { x: [3, 'peer-alice'] },
                expectedUpdatedAt: at(),
            })
        ).ok
    );
    await bob.local.save(withX(5, 5));
    // Bob leaves; alice keeps going.
    assert.ok(
        (
            await alice.remote.publish(withX(20, 20), {
                rev: 7,
                entityClock: { x: [7, 'peer-alice'] },
                expectedUpdatedAt: at(),
            })
        ).ok
    );

    const again = await bob.sync.open(base.id);
    assert.deepEqual(
        authoredEntityStates(again.doc.commands).get('x')?.entity.position,
        [20, 0.5, 20],
        'reopening takes the newer shared move'
    );
    await bob.sync.push(again.doc);
    const row = db.rows.get(base.id)!;
    assert.deepEqual(
        authoredEntityStates((row.doc as WorldDocumentV1).commands).get('x')?.entity.position,
        [20, 0.5, 20],
        "alice's later move survives bob's reopen"
    );
    assert.deepEqual(row.entity_clock.x, [7, 'peer-alice'], 'and keeps its stamp');
});

await test('a push after a reload keeps the stored clock (no blind overwrite)', async () => {
    const db = new MemoryWorldsDb();
    const owner = device(db, 'alice');
    const d = doc(places(3, spread));
    await owner.sync.push(d);
    const moved = clone(d);
    moved.commands.push({ type: 'move', from: snap('p0', ...spread(0)), to: snap('p0', 7, 7) });
    await owner.sync.push(moved);
    const clockBefore = clone(db.rows.get(d.id)!.entity_clock);

    // A reload: a new SharedWorldSync over the same stores (meta survives).
    const reloaded = new SharedWorldSync({
        local: owner.local,
        remote: owner.remote,
        meta: owner.meta,
        now: () => 43,
    });
    const later = clone(moved);
    later.commands.push({ type: 'move', from: snap('p1', ...spread(1)), to: snap('p1', 8, 8) });
    assert.equal((await reloaded.push(later)).status, 'synced');
    const clock = db.rows.get(d.id)!.entity_clock;
    assert.deepEqual(clock.p0, clockBefore.p0, "p0's stamp is kept");
    assert.deepEqual(clock.p1, [2, 'sync-alice'], 'only the new edit is stamped');

    // A copy that never synced from here (no meta) reads the row first.
    const other = device(db, 'alice');
    await other.local.save(clone(d));
    const first = await other.sync.push(clone(d));
    assert.notEqual(first.status, 'failed');
    assert.deepEqual(db.rows.get(d.id)!.entity_clock.p1, [2, 'sync-alice'], 'nothing lost');
    assert.deepEqual(
        authoredEntityStates((db.rows.get(d.id)!.doc as WorldDocumentV1).commands).get('p1')?.entity
            .position,
        [8, 0.5, 8]
    );
});

await test('a room-confirmed state is the base of the next offline merge', async () => {
    const db = new MemoryWorldsDb();
    const alice = device(db, 'alice');
    const d = doc(places(2, spread));
    await alice.sync.push(d);
    db.addEditor(d.id, 'bob');
    const bob = device(db, 'bob');
    await bob.sync.open(d.id);

    // In the room, alice's host wrote p0's move; bob's replica holds the same.
    const roomDoc = clone(d);
    roomDoc.commands.push({ type: 'move', from: snap('p0', ...spread(0)), to: snap('p0', 3, 3) });
    const written = await alice.remote.publish(roomDoc, {
        rev: 2,
        entityClock: { p0: [2, 'peer-a'] },
        expectedUpdatedAt: db.rows.get(d.id)!.updated_at,
    });
    assert.ok(written.ok);
    await bob.local.save(roomDoc);
    bob.sync.noteRoomState(d.id, {
        updatedAt: written.world.updatedAt,
        rev: 2,
        commands: roomDoc.commands,
        clock: { p0: [2, 'peer-a'] },
    });
    assert.equal(
        (await bob.sync.push(roomDoc)).status,
        'unchanged',
        'what the room confirmed is not a local edit'
    );
    const reopened = await bob.sync.open(d.id);
    assert.equal(reopened.source, 'local', 'nothing new on the server');
});

await test('three-way merge helpers', () => {
    const base = doc(places(3, spread));
    const hashes = entityHashes(base.commands);
    assert.equal(changedSince(base.commands, hashes).size, 0);
    const local = clone(base);
    local.commands.push({ type: 'move', from: snap('p0', ...spread(0)), to: snap('p0', 3, 3) });
    local.commands.push({ type: 'move', from: snap('p0', 3, 3), to: snap('p0', ...spread(0)) });
    assert.equal(changedSince(local.commands, hashes).size, 0, 'moved back is unchanged');
    const put = clone(base);
    put.commands.push({ type: 'remove', snapshot: snap('p1', ...spread(1)) });
    const remote = clone(base);
    remote.commands.push({ type: 'move', from: snap('p2', ...spread(2)), to: snap('p2', 5, 5) });
    const { doc: m, localWins } = mergeSharedDocuments(put, remote, hashes, 1);
    assert.deepEqual([...localWins], ['p1']);
    const states = authoredEntityStates(m.commands);
    assert.equal(states.get('p1') ?? null, null, 'the local remove wins');
    assert.deepEqual(states.get('p2')?.entity.position, [5, 0.5, 5]);
    assert.ok(validateSharedWorld(m).ok, 'a merge is a valid shared world');
});

await test('share links carry the world and its seed: same terrain, season and weather', () => {
    const id = '0a0b0c0d-0000-4000-8000-000000000123';
    const url = buildWorldShareUrl(id, 777, {
        base: 'https://candy.example/play/?graphics=low#x',
        invite: 'ffffffff-0000-4000-8000-000000000001',
    });
    const search = new URL(url).search;
    assert.equal(readSharedWorldIdFromURL(search), id);
    assert.equal(new URLSearchParams(search).get('seed'), '777');
    assert.equal(readWorldInviteFromURL(search), 'ffffffff-0000-4000-8000-000000000001');
    assert.equal(readSharedWorldIdFromURL('?world=../../etc'), null, 'not a world id');
    // Two clients with the same seed agree on the season for the same instant.
    const t = Date.UTC(2026, 9, 27, 18, 30);
    const a = computeSeasonState(t, 777, SEASON_DEFAULTS, -1, createSeasonState());
    const b = computeSeasonState(t, 777, SEASON_DEFAULTS, -1, createSeasonState());
    assert.deepEqual(a, b);
});

if (failures > 0) {
    console.error(`\n${failures} shared-worlds test(s) failed`);
    process.exit(1);
}
console.log('\nshared-worlds: all tests passed');
