/**
 * Shared-world co-editing protocol (#1975): src/systems/net/world-sync-protocol.ts.
 *
 * Two (and three) replicas exchange commands through in-memory channels that
 * reorder and duplicate delivery. Each peer also keeps a simulated world that
 * applies commands with the real WorldCommand semantics (despawn by id, then
 * place; a place onto a live id is a no-op), so the test checks both that the
 * replicas converge (equal snapshot hash) and that each world shows what its
 * replica holds.
 *
 * Run: npx tsx tests/world-sync-protocol.test.ts
 */

import assert from 'node:assert/strict';
import {
    MAX_REV_JUMP,
    PeerRateLimiter,
    SeqTracker,
    SharedWorldReplica,
    WORLD_SYNC_LIMITS,
    clampCommandPalette,
    compareStamps,
    electHost,
    parseCmdMessage,
    parseCursorMessage,
    parseProgressMessage,
    parseSyncMessage,
    type CmdMessage,
    type WorldEffect,
} from '../src/systems/net/world-sync-protocol.ts';
import type { EntitySnapshot } from '../src/systems/entity-snapshot-types.ts';
import {
    documentStateHash,
    entityStateHash,
    invertCommand,
    isUnchanged,
    netEntityChanges,
    type EntityState,
} from '../src/world/document/entity-state.ts';
import { CANDY_PAINT_PALETTE, isCandyPaint } from '../src/world/document/paint-palette.ts';
import { createEmptyDocument, type DocumentCommand } from '../src/world/document/schema.ts';
import { validateSharedWorld } from '../src/world/document/shared-validation.ts';

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

/** mulberry32: deterministic runs. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function snap(id: string, x: number, z: number, color?: number): EntitySnapshot {
    const params: Record<string, unknown> = {};
    if (color !== undefined) params.color = color;
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

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The base world every peer generates from the seed: ten map mushrooms. */
function baseWorld(): Map<string, EntityState> {
    const out = new Map<string, EntityState>();
    for (let i = 0; i < 10; i++) out.set(`map-${i}`, snap(`map-${i}`, i * 4 - 20, 6));
    return out;
}
const BASE = baseWorld();

/** Authored states of a simulated world: what differs from the base world. */
function worldHash(world: Map<string, EntityState>): string {
    const authored = new Map<string, EntityState>();
    for (const id of new Set([...world.keys(), ...BASE.keys()])) {
        const state = world.get(id) ?? null;
        if (!isUnchanged(state, BASE.get(id) ?? null)) authored.set(id, state);
    }
    return entityStateHash(authored);
}

/** Apply a command to a simulated world the way world-commands.ts does. */
function applyToWorld(world: Map<string, EntityState>, cmd: DocumentCommand): void {
    for (const [id, change] of netEntityChanges([cmd])) {
        const live = world.get(id) ?? null;
        if (change.before === null && live !== null) continue; // PlaceCommand.apply on a live id
        world.set(id, change.after);
    }
}

function applyEffects(world: Map<string, EntityState>, effects: readonly WorldEffect[]): void {
    for (const e of effects) world.set(e.id, e.to);
}

interface Peer {
    id: string;
    replica: SharedWorldReplica;
    world: Map<string, EntityState>;
    inbox: CmdMessage[];
    sent: CmdMessage[];
    own: DocumentCommand[];
    nextId: number;
    rejected: number;
}

function newPeer(id: string, doc = { commands: [] as DocumentCommand[] }): Peer {
    const world = baseWorld();
    for (const cmd of doc.commands) applyToWorld(world, cmd);
    return {
        id,
        replica: new SharedWorldReplica(id, doc),
        world,
        inbox: [],
        sent: [],
        own: [],
        nextId: 0,
        rejected: 0,
    };
}

/** Edit locally: the command runs in the world, then the replica stamps it. */
function edit(peer: Peer, cmd: DocumentCommand, peers: Peer[]): CmdMessage {
    applyToWorld(peer.world, cmd);
    const { message, effects } = peer.replica.local(cmd);
    applyEffects(peer.world, effects);
    const wire = clone(message);
    peer.sent.push(wire);
    peer.own.push(cmd);
    for (const other of peers) if (other !== peer) other.inbox.push(wire);
    return message;
}

function deliver(peer: Peer, message: CmdMessage): void {
    const parsed = parseCmdMessage(clone(message));
    assert.ok(parsed.ok, `a peer's own message parses: ${parsed.ok ? '' : parsed.detail}`);
    const outcome = peer.replica.receive(parsed.message);
    if (outcome.status === 'applied') applyEffects(peer.world, outcome.effects);
    if (outcome.status === 'rejected') peer.rejected++;
}

/** Deliver up to `n` inbox messages in random order, sometimes twice. */
function pump(peer: Peer, random: () => number, n: number, dupRate = 0.3): void {
    for (let i = 0; i < n && peer.inbox.length > 0; i++) {
        const k = Math.floor(random() * peer.inbox.length);
        const [msg] = peer.inbox.splice(k, 1);
        deliver(peer, msg);
        if (random() < dupRate) peer.inbox.push(msg);
    }
}

function flush(peers: Peer[], random: () => number): void {
    while (peers.some((p) => p.inbox.length > 0)) for (const p of peers) pump(p, random, 4, 0.1);
}

/** One random edit from `peer`'s current view of the world. */
function randomEdit(peer: Peer, random: () => number): DocumentCommand {
    const live = [...peer.world.entries()].filter(([, s]) => s !== null) as Array<
        [string, EntitySnapshot]
    >;
    const pick = (): EntitySnapshot => live[Math.floor(random() * live.length)][1];
    const moved = (s: EntitySnapshot): EntitySnapshot => {
        const c = clone(s);
        c.entity.position = [
            Math.round((random() * 60 - 30) * 10) / 10,
            0.5,
            Math.round((random() * 60 - 30) * 10) / 10,
        ];
        return c;
    };
    const r = random();
    if (live.length === 0 || r < 0.3) {
        return {
            type: 'place',
            snapshot: snap(`${peer.id}-${peer.nextId++}`, random() * 40 - 20, random() * 40 - 20),
        };
    }
    if (r < 0.5) {
        const s = pick();
        return { type: 'move', from: s, to: moved(s) };
    }
    if (r < 0.62) return { type: 'remove', snapshot: pick() };
    if (r < 0.74) {
        const s = pick();
        const to = clone(s);
        to.entity.params = {
            ...to.entity.params,
            color: CANDY_PAINT_PALETTE[Math.floor(random() * 8)].hex,
        };
        return { type: 'paint', from: s, to };
    }
    if (r < 0.86 && peer.own.length > 0) {
        // Undo one of this peer's earlier edits: the inverse, as EditHistory reverts it.
        return invertCommand(peer.own[Math.floor(random() * peer.own.length)]);
    }
    const a = pick();
    const b = pick();
    if (a.id === b.id) return { type: 'move', from: a, to: moved(a) };
    return {
        type: 'batch',
        label: 'move',
        commands: [
            { type: 'move', from: a, to: moved(a) },
            { type: 'move', from: b, to: moved(b) },
        ],
    };
}

function assertConverged(peers: Peer[], label: string): void {
    const hashes = peers.map((p) => p.replica.hash());
    for (const p of peers) {
        assert.equal(
            p.replica.hash(),
            hashes[0],
            `${label}: ${p.id} holds the same world as ${peers[0].id}`
        );
        assert.equal(
            worldHash(p.world),
            p.replica.hash(),
            `${label}: ${p.id}'s world shows what its replica holds`
        );
    }
}

// ---------------------------------------------------------------------------

test('two peers, 50 interleaved place/move/remove/paint/undo ops, reordered + duplicated, converge', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const random = rng(seed);
        const a = newPeer('peer-a');
        const b = newPeer('peer-b');
        const peers = [a, b];
        for (let op = 0; op < 50; op++) {
            const author = random() < 0.5 ? a : b;
            edit(author, randomEdit(author, random), peers);
            for (const p of peers) pump(p, random, Math.floor(random() * 3));
        }
        flush(peers, random);
        assertConverged(peers, `seed ${seed}`);
        assert.equal(a.rejected + b.rejected, 0, `seed ${seed}: nothing refused`);
    }
});

test('reversed delivery with every message twice converges', () => {
    const random = rng(99);
    const a = newPeer('peer-a');
    const b = newPeer('peer-b');
    const peers = [a, b];
    for (let op = 0; op < 50; op++) {
        const author = op % 2 === 0 ? a : b;
        edit(author, randomEdit(author, random), peers);
    }
    for (const p of peers) {
        const queue = [...p.inbox].reverse();
        p.inbox.length = 0;
        for (const m of queue) {
            deliver(p, m);
            deliver(p, m);
        }
    }
    assertConverged(peers, 'reversed');
});

test('the merged document replays to the same world, validates, and a late joiner catches up', () => {
    const random = rng(7);
    const a = newPeer('peer-a');
    const b = newPeer('peer-b');
    const peers = [a, b];
    for (let op = 0; op < 30; op++) {
        const author = random() < 0.5 ? a : b;
        edit(author, randomEdit(author, random), peers);
        for (const p of peers) pump(p, random, 2);
    }
    // Host (a) writes back what it holds right now; b still has messages in flight.
    const written = {
        commands: a.replica.documentCommands(),
        rev: a.replica.rev,
        entityClock: a.replica.exportClock(),
    };
    assert.equal(
        documentStateHash(written.commands),
        a.replica.hash(),
        'document hash = replica hash'
    );
    const replayed = baseWorld();
    for (const cmd of written.commands) applyToWorld(replayed, cmd);
    assert.equal(
        worldHash(replayed),
        a.replica.hash(),
        'replaying the document rebuilds the world'
    );

    const doc = createEmptyDocument({
        seed: 12345,
        mapVersion: '1.0',
        id: '0b0b0b0b-0000-4000-8000-000000000001',
    });
    doc.commands = written.commands;
    const check = validateSharedWorld(clone(doc));
    assert.ok(check.ok, `merged document validates: ${check.ok ? '' : check.message}`);

    // Late joiner: opens the written document, then gets every message sent so
    // far (some already folded into the document) plus everything after.
    const c = newPeer('peer-c', clone(written));
    for (const m of [...a.sent, ...b.sent]) c.inbox.push(m);
    const all = [a, b, c];
    for (let op = 0; op < 20; op++) {
        const author = all[Math.floor(random() * 3)];
        edit(author, randomEdit(author, random), all);
        for (const p of all) pump(p, random, 3);
    }
    flush(all, random);
    assertConverged(all, 'late joiner');
});

test('a lost message is repaired by the host sync: reconcile adopts and re-sends', () => {
    const random = rng(3);
    const a = newPeer('peer-a'); // host
    const b = newPeer('peer-b');
    const peers = [a, b];
    for (let op = 0; op < 12; op++) edit(b, randomEdit(b, random), peers);
    // The network drops b's 5th and 9th messages on their way to a.
    a.inbox = a.inbox.filter((m) => m.seq !== 5 && m.seq !== 9);
    for (let op = 0; op < 8; op++) edit(a, randomEdit(a, random), peers);
    flush(peers, random);
    assert.notEqual(a.replica.hash(), b.replica.hash(), 'the drop made them differ');

    // a writes back and announces; b's hash differs, so b fetches and reconciles.
    const stored = {
        commands: a.replica.documentCommands(),
        rev: a.replica.rev,
        entityClock: a.replica.exportClock(),
    };
    const { effects, resend } = b.replica.reconcile(clone(stored));
    applyEffects(b.world, effects);
    assert.ok(resend.length > 0, 'b re-sends what a missed');
    for (const m of resend) deliver(a, clone(m));
    assertConverged(peers, 'after repair');
});

test('chaos: three peers, 15% loss, duplicates and reordering converge after host syncs', () => {
    for (let seed = 100; seed < 160; seed++) {
        const random = rng(seed);
        const peers = [newPeer('peer-a'), newPeer('peer-b'), newPeer('peer-c')];
        const [host] = peers;
        for (let op = 0; op < 60; op++) {
            const author = peers[Math.floor(random() * peers.length)];
            edit(author, randomEdit(author, random), peers);
            // The network loses some messages outright.
            for (const p of peers) p.inbox = p.inbox.filter(() => random() > 0.15 / peers.length);
            for (const p of peers) pump(p, random, Math.floor(random() * 4));
        }
        flush(peers, random);
        // Anti-entropy: the host writes back, the others reconcile and re-send
        // what it missed; their re-sends are broadcasts, so everyone hears them.
        for (let round = 0; round < 4; round++) {
            const stored = clone({
                commands: host.replica.documentCommands(),
                rev: host.replica.rev,
                entityClock: host.replica.exportClock(),
            });
            for (const p of peers) {
                if (p === host || p.replica.hash() === host.replica.hash()) continue;
                const { effects, resend } = p.replica.reconcile(stored);
                applyEffects(p.world, effects);
                for (const m of resend)
                    for (const other of peers) if (other !== p) other.inbox.push(clone(m));
            }
            flush(peers, random);
            if (peers.every((p) => p.replica.hash() === host.replica.hash())) break;
        }
        assertConverged(peers, `chaos seed ${seed}`);
    }
});

test('caps: concurrent placements at the limit are refused, then the host sync converges', () => {
    const a = newPeer('peer-a');
    const b = newPeer('peer-b');
    a.replica = new SharedWorldReplica('peer-a', { commands: [] }, { total: 3, perChunk: 48 });
    b.replica = new SharedWorldReplica('peer-b', { commands: [] }, { total: 3, perChunk: 48 });
    const peers = [a, b];
    edit(a, { type: 'place', snapshot: snap('a-0', 0, 0) }, peers);
    edit(a, { type: 'place', snapshot: snap('a-1', 2, 0) }, peers);
    flush(peers, rng(1));
    // Both place the third piece before hearing of the other's.
    edit(a, { type: 'place', snapshot: snap('a-2', 4, 0) }, peers);
    edit(b, { type: 'place', snapshot: snap('b-0', 6, 0) }, peers);
    flush(peers, rng(2));
    assert.equal(a.rejected, 1, 'host refused the fourth piece');
    assert.equal(b.rejected, 1, 'b refused the fourth piece too');
    assert.ok(
        !b.world.has('a-2') || b.world.get('a-2') === null,
        'a refused command never reaches the world'
    );

    // Host a answers its refusal with a compensating write: b takes b-0 back out.
    const refused = a.inbox.length === 0 ? b.sent[b.sent.length - 1] : null;
    assert.ok(refused, 'the refused message is b-0');
    const comp = a.replica.compensation(refused);
    assert.ok(comp, 'a compensation exists');
    const { message } = a.replica.local(comp);
    deliver(b, clone(message));
    // b also refused a's a-2 and only learns of it from the host's document.
    const stored = {
        commands: a.replica.documentCommands(),
        rev: a.replica.rev,
        entityClock: a.replica.exportClock(),
    };
    applyEffects(b.world, b.replica.reconcile(clone(stored)).effects);
    assertConverged(peers, 'at the cap');
    assert.equal([...a.replica.materialize().values()].filter(Boolean).length, 3, 'three pieces');
});

test('a chunk cap refuses a move into a full chunk', () => {
    const r = new SharedWorldReplica('self', { commands: [] }, { total: 600, perChunk: 2 });
    const msg = (seq: number, command: DocumentCommand): CmdMessage => ({
        author: 'other',
        seq,
        rev: seq,
        baseRev: 0,
        command,
    });
    assert.equal(r.receive(msg(1, { type: 'place', snapshot: snap('x', 1, 1) })).status, 'applied');
    assert.equal(r.receive(msg(2, { type: 'place', snapshot: snap('y', 2, 2) })).status, 'applied');
    const far = snap('z', 100, 100);
    assert.equal(r.receive(msg(3, { type: 'place', snapshot: far })).status, 'applied');
    const into = r.receive(msg(4, { type: 'move', from: far, to: snap('z', 3, 3) }));
    assert.equal(into.status, 'rejected', 'third piece in one chunk refused');
    const out = r.receive(msg(5, { type: 'move', from: snap('x', 1, 1), to: snap('x', 200, 200) }));
    assert.equal(out.status, 'applied', 'moving out of a full chunk is fine');
});

test('inbound validation: malformed, oversized, too many entities, mismatched ids are refused', () => {
    const ok: CmdMessage = {
        author: 'peer-a',
        seq: 1,
        rev: 1,
        baseRev: 0,
        command: { type: 'place', snapshot: snap('p', 0, 0) },
    };
    assert.ok(parseCmdMessage(clone(ok)).ok, 'a good command parses');
    const bad = (payload: unknown, reason: string, label: string) => {
        const r = parseCmdMessage(payload);
        assert.ok(
            !r.ok && r.reason === reason,
            `${label}: ${r.ok ? 'accepted' : r.reason + ' ' + r.detail}`
        );
    };
    bad({ ...ok, seq: 0 }, 'malformed', 'seq 0');
    bad({ ...ok, author: 'has spaces' }, 'malformed', 'bad author');
    bad({ ...ok, command: { type: 'explode' } }, 'malformed', 'unknown command');
    bad(
        { ...ok, command: { type: 'place', snapshot: { id: 'x' } } },
        'malformed',
        'snapshot without entity'
    );
    const huge = snap('h', 0, 0);
    huge.entity.params = { blob: 'x'.repeat(WORLD_SYNC_LIMITS.maxCmdChars) };
    bad({ ...ok, command: { type: 'place', snapshot: huge } }, 'too_large', 'oversized payload');
    const many: DocumentCommand = {
        type: 'batch',
        commands: Array.from({ length: 70 }, (_, i) => ({
            type: 'place' as const,
            snapshot: snap(`m${i}`, i, 0),
        })),
    };
    bad({ ...ok, command: many }, 'over_cap', '70 entities in one command');
    bad(
        { ...ok, command: { type: 'move', from: snap('a', 0, 0), to: snap('b', 1, 1) } },
        'malformed',
        'move across ids'
    );
    bad({ ...ok, command: { type: 'batch', commands: [] } }, 'malformed', 'empty batch');

    assert.ok(
        parseProgressMessage({
            author: 'peer-a',
            kind: 'awakened',
            id: '123456',
            type: 'luminous_plant',
        }).ok
    );
    assert.ok(
        !parseProgressMessage({ author: 'peer-a', kind: 'cheat', id: 'x' }).ok,
        'unknown progress kind'
    );
    assert.ok(
        !parseProgressMessage({ author: 'peer-a', kind: 'discovery', id: '<script>' }).ok,
        'odd id'
    );
    assert.ok(
        parseCursorMessage({ author: 'peer-a', pos: [1, 2, 3], selection: ['a'], tool: 'place' }).ok
    );
    assert.ok(
        !parseCursorMessage({ author: 'peer-a', pos: [1, 2, Infinity], selection: [] }).ok,
        'non-finite cursor'
    );
    assert.ok(
        parseSyncMessage({ author: 'peer-a', rev: 3, hash: '00112233445566', updatedAt: 'now' }).ok
    );
});

test('palette clamp: off-palette paint becomes the nearest candy colour', () => {
    const from = snap('p', 0, 0, 0xff69b4);
    const cmd: DocumentCommand = { type: 'paint', from, to: snap('p', 0, 0, 0x808080) };
    const clamped = clampCommandPalette(cmd);
    const color = (clamped as { to: EntitySnapshot }).to.entity.params?.color;
    assert.ok(isCandyPaint(color), `clamped to a candy paint (${String(color)})`);
    const nearPink = clampCommandPalette({ type: 'paint', from, to: snap('p', 0, 0, 0xff6ab5) });
    assert.equal(
        (nearPink as { to: EntitySnapshot }).to.entity.params?.color,
        0xff69b4,
        'nearest is hot pink'
    );
    const wire = parseCmdMessage({ author: 'peer-a', seq: 1, rev: 1, baseRev: 0, command: cmd });
    assert.ok(
        wire.ok &&
            isCandyPaint((wire.message.command as { to: EntitySnapshot }).to.entity.params?.color)
    );
    const inBatch = clampCommandPalette({ type: 'batch', commands: [cmd] });
    assert.ok(
        isCandyPaint(
            (inBatch as { commands: Array<{ to: EntitySnapshot }> }).commands[0].to.entity.params
                ?.color
        )
    );
});

test('rate limit, dedupe, clock guard, stamps and host election', () => {
    const limiter = new PeerRateLimiter({ perSecond: 2, burst: 3 });
    assert.deepEqual(
        [0, 0, 0, 0].map(() => limiter.allow('p', 1000)),
        [true, true, true, false],
        'burst of 3'
    );
    assert.equal(limiter.allow('p', 1500), true, 'refilled after 500 ms');
    assert.equal(limiter.allow('q', 1500), true, 'per peer');

    const seen = new SeqTracker(4);
    assert.equal(seen.add('a', 1), true);
    assert.equal(seen.add('a', 1), false, 'duplicate');
    assert.equal(seen.add('a', 3), true, 'gap');
    assert.equal(seen.add('a', 2), true, 'gap filled');
    assert.equal(seen.add('a', 3), false, 'still seen after folding');
    for (let s = 10; s < 20; s++) seen.add('a', s);
    assert.equal(seen.add('a', 4), false, 'old gaps are given up once the window is full');

    const r = new SharedWorldReplica('self', { commands: [], rev: 10 });
    const jump = r.receive({
        author: 'x',
        seq: 1,
        rev: 10 + MAX_REV_JUMP + 1,
        baseRev: 0,
        command: { type: 'place', snapshot: snap('j', 0, 0) },
    });
    assert.equal(jump.status, 'rejected', 'a forged clock jump is refused');

    assert.ok(compareStamps(null, [0, 'a']) < 0, 'the base sorts first');
    assert.ok(compareStamps([2, 'a'], [1, 'z']) > 0, 'rev first');
    assert.ok(compareStamps([2, 'b'], [2, 'a']) > 0, 'then author');

    assert.equal(
        electHost([
            { id: 'v', joinedAt: 1, canEdit: false },
            { id: 'b', joinedAt: 5, canEdit: true },
            { id: 'a', joinedAt: 5, canEdit: true },
            { id: 'c', joinedAt: 9, canEdit: true },
        ]),
        'a',
        'earliest editor, ties to the smaller id; viewers never host'
    );
    assert.equal(electHost([{ id: 'v', joinedAt: 1, canEdit: false }]), null);
});

test('a place onto an id a remote write already filled is corrected', () => {
    const a = newPeer('peer-a');
    const b = newPeer('peer-b');
    const peers = [a, b];
    const s1 = snap('shared', 0, 0);
    edit(a, { type: 'place', snapshot: s1 }, peers);
    edit(a, { type: 'remove', snapshot: s1 }, peers);
    flush(peers, rng(5));
    // b re-places the same id (an undo of the remove), a moves it meanwhile.
    edit(b, { type: 'place', snapshot: s1 }, peers);
    edit(a, { type: 'place', snapshot: snap('shared', 9, 9) }, peers);
    flush(peers, rng(6));
    assertConverged(peers, 'same-id race');
});

if (failures > 0) {
    console.error(`\n${failures} world-sync-protocol test(s) failed`);
    process.exit(1);
}
console.log('\nworld-sync-protocol: all tests passed');
