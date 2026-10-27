/**
 * WorldDocument replay round trip (#1974 acceptance): edit the world through
 * the shared EditHistory, save the document, take every edit back out (the
 * generated base world), load the document and replay it. The authored
 * entities must come back as an identical entity snapshot.
 *
 * Real registration (`processMapEntity`) and teardown (`despawnEntity`) paths,
 * in plain Node with the asset stubs.
 *
 * Run: npx tsx --import ./tests/support/register-wasm-hooks.mjs tests/world-document-replay.test.ts
 */

import assert from 'node:assert/strict';
import { mushroomBatcher } from '../src/foliage/mushroom-batcher/index.ts';
import { EditHistory, type WorldCommand } from '../src/systems/edit-history.ts';
import {
    CURRENT_SNAPSHOT_VERSION,
    type EntitySnapshot,
} from '../src/systems/entity-snapshot-core.ts';
import { serializeEntitySnapshots } from '../src/systems/save-system/entity-snapshot.ts';
import {
    BatchCommand,
    MoveCommand,
    PaintCommand,
    PlaceCommand,
    RemoveCommand,
} from '../src/systems/world-commands.ts';
import type * as THREE from 'three';
import { isAuthoredEntity } from '../src/world/authored-entities.ts';
import { ChunkStreamer } from '../src/world/chunk-streamer.ts';
import { despawnEntity } from '../src/world/entity-despawn.ts';
import { decodeCandyWorld, encodeCandyWorld } from '../src/world/document/codec.ts';
import { compactCommands } from '../src/world/document/compaction.ts';
import { createEmptyDocument, emptyProgress } from '../src/world/document/schema.ts';
import { WorldDocumentSession } from '../src/world/document/session.ts';
import { MemoryDocumentStore } from '../src/world/document/store.ts';
import { animatedFoliage } from '../src/world/state.ts';

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

function snap(
    id: string,
    type: string,
    position: [number, number, number],
    extra = {}
): EntitySnapshot {
    return {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id,
        entity: {
            type,
            position,
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            placement: 'absolute',
            params: {},
            ...extra,
        },
    };
}

/** Authored entities in the live world, canonical and id-sorted. */
function authoredWorld(): string {
    const snaps = serializeEntitySnapshots().sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify(snaps);
}

const TYPES = ['mushroom', 'mushroom', 'kick_drum_geyser', 'mushroom'];

function newSession(
    history: EditHistory,
    store: MemoryDocumentStore,
    doc = createEmptyDocument({ seed: 12345, mapVersion: '1.0', id: 'replay-doc', now: 1 })
) {
    return new WorldDocumentSession(doc, {
        history,
        store,
        readProgress: emptyProgress,
        readPlayer: () => ({ position: [4, 2, -3], yaw: 0.75 }),
    });
}

const store = new MemoryDocumentStore();
const baseMushrooms = mushroomBatcher.count;
const baseLive = animatedFoliage.length;
let edited = '';

await test('20 places, 5 undos, a move, a paint and a batch remove land in the log', async () => {
    const history = new EditHistory();
    const session = newSession(history, store);

    for (let i = 0; i < 20; i++) {
        const type = TYPES[i % TYPES.length];
        const extra = type === 'mushroom' ? { variant: 'regular', hasFace: false } : {};
        assert.equal(
            history.execute(
                new PlaceCommand(snap(`rp-${i}`, type, [i * 3 - 30, 0.5, (i % 5) * 4 - 10], extra))
            ),
            true,
            `place ${i}`
        );
    }
    for (let i = 0; i < 5; i++) assert.equal(history.undo(), true, `undo ${i}`);

    const from = snap('rp-1', 'mushroom', [-27, 0.5, -6], { variant: 'regular', hasFace: false });
    const to = snap('rp-1', 'mushroom', [12, 1.5, 14], {
        variant: 'regular',
        hasFace: false,
        rotation: { quat: [0, 0.382683, 0, 0.92388] },
        scale: 1.6,
    });
    assert.equal(history.execute(new MoveCommand(from, to)), true, 'move');

    const p0 = snap('rp-0', 'mushroom', [-30, 0.5, -10], { variant: 'regular', hasFace: false });
    const painted = { ...p0, entity: { ...p0.entity, params: { color: 0x98fb98 } } };
    assert.equal(history.execute(new PaintCommand(p0, painted)), true, 'paint');

    const batch: WorldCommand[] = [
        new RemoveCommand(snap('rp-2', 'kick_drum_geyser', [-24, 0.5, -2])),
        new RemoveCommand(
            snap('rp-3', 'mushroom', [-21, 0.5, 2], { variant: 'regular', hasFace: false })
        ),
    ];
    assert.equal(history.execute(new BatchCommand(batch, 'remove')), true, 'batch remove');

    edited = authoredWorld();
    const world = JSON.parse(edited) as EntitySnapshot[];
    assert.equal(world.length, 13, '15 placed − 2 removed');
    const byId = new Map(world.map((s) => [s.id, s.entity]));
    assert.deepEqual(byId.get('rp-1')?.position, [12, 1.5, 14], 'moved');
    assert.equal(byId.get('rp-1')?.scale, 1.6, 'rescaled');
    assert.equal((byId.get('rp-0')?.params as { color?: number })?.color, 0x98fb98, 'painted');
    assert.ok(!byId.has('rp-2') && !byId.has('rp-19'), 'removed and undone ids are gone');

    const saved = await session.save();
    assert.deepEqual(
        saved.commands.map((c) => c.type),
        [...Array(15).fill('place'), 'move', 'paint', 'batch']
    );
    assert.deepEqual(saved.player, { position: [4, 2, -3], yaw: 0.75 });
    assert.ok(isAuthoredEntity('rp-2'), 'a removed id stays claimed from the streamer');

    // "Regenerate from seed": every authored edit comes back out of the world.
    assert.equal(session.revertAll(), 0, 'every command reverts');
    assert.equal(JSON.parse(authoredWorld()).length, 0);
    assert.equal(mushroomBatcher.count, baseMushrooms, 'no batcher slot leaked');
    assert.equal(animatedFoliage.length, baseLive, 'no live object leaked');
    session.dispose();
});

await test('reload + replay rebuilds an identical entity snapshot', async () => {
    const loaded = await store.load('replay-doc');
    assert.ok(loaded, 'document round-trips through the store');
    const session = newSession(new EditHistory(), store, loaded);
    const result = session.replay();
    assert.deepEqual(result, { applied: 18, failed: 0 });
    assert.equal(authoredWorld(), edited);
    session.revertAll();
    session.dispose();
});

await test('the compacted log replays to the same world', async () => {
    const loaded = (await store.load('replay-doc'))!;
    const compacted = compactCommands(loaded.commands);
    assert.ok(
        compacted.length < loaded.commands.length,
        `${compacted.length} < ${loaded.commands.length}`
    );
    const session = newSession(new EditHistory(), store, { ...loaded, commands: compacted });
    assert.equal(session.replay().failed, 0);
    assert.equal(authoredWorld(), edited);
    session.revertAll();
    session.dispose();
});

await test('a .candyworld file opens to the same world', async () => {
    const loaded = (await store.load('replay-doc'))!;
    const bytes = await encodeCandyWorld(loaded);
    assert.equal(bytes[0], 0x1f, 'gzip magic');
    const decoded = await decodeCandyWorld(bytes);
    assert.ok(decoded.ok, decoded.ok ? '' : decoded.error.message);
    const session = newSession(new EditHistory(), store, decoded.doc);
    session.replay();
    assert.equal(authoredWorld(), edited);
    session.revertAll();
    session.dispose();
    assert.equal(mushroomBatcher.count, baseMushrooms);
});

await test('the streamer never re-spawns an authored id, and never tears an object down twice', () => {
    const streamer = new ChunkStreamer(
        { getEntityById: () => undefined } as never,
        null as never,
        null,
        {
            chunkSize: 32,
        }
    );
    const record = { evictable: [] as THREE.Object3D[], permanentCount: 0 };
    const spawn = (id: string) =>
        (
            streamer as unknown as { spawnEntity(e: unknown, r: unknown, s: boolean): void }
        ).spawnEntity(
            {
                id,
                type: 'mushroom',
                position: [40, 0.5, 40],
                placement: 'absolute',
                variant: 'regular',
            },
            record,
            false
        );

    const before = mushroomBatcher.count;
    spawn('map-free'); // an ordinary map entity streams in
    assert.equal(mushroomBatcher.count, before + 1);
    assert.ok(isAuthoredEntity('rp-2'));
    spawn('rp-2'); // a removed-by-command id must stay removed
    assert.equal(mushroomBatcher.count, before + 1, 'claimed id skipped');

    // A command tears the streamed object down; a later eviction must not again.
    const [obj] = record.evictable;
    assert.equal(despawnEntity(obj), true);
    assert.equal(mushroomBatcher.count, before);
    (streamer as unknown as { evictObject(o: THREE.Object3D): void }).evictObject(obj);
    assert.equal(mushroomBatcher.count, before, 'no second removeInstance');
});

if (failures > 0) {
    console.error(`\n${failures} world-document replay test(s) failed`);
    process.exit(1);
}
console.log('\nAll world-document replay tests passed');
