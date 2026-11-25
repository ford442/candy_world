/**
 * Music Garden slice B, iteration 1: the chime tulip and the drum puffball are plain map entities
 * that ride the existing command log. Place them, move one, undo, redo, save the WorldDocument,
 * export `.candyworld`, take every edit back out, load the file again and replay it: the same
 * plants must be standing with the same params. No second persistence path.
 *
 * Real registration (`processMapEntity` via `restoreEntity`) and teardown (`despawnEntity`), in
 * plain Node with the asset stubs, as tests/grove-composer-replay.test.ts.
 *
 * Run: npx tsx --import ./tests/support/register-wasm-hooks.mjs tests/garden-flora-replay.test.ts
 */

import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { EditHistory } from '../src/systems/authoring/edit-history.ts';
import { buildPalette } from '../src/systems/authoring/palette.ts';
import {
    MoveCommand,
    PlaceCommand,
    RemoveCommand,
    deserializeWorldCommand,
} from '../src/systems/authoring/world-commands.ts';
import { parseCmdMessage } from '../src/systems/net/world-sync-protocol.ts';
import {
    CURRENT_SNAPSHOT_VERSION,
    snapshotEntity,
    type EntitySnapshot,
} from '../src/systems/entity-snapshot/entity-snapshot-core.ts';
import { decodeCandyWorld, encodeCandyWorld } from '../src/world/document/codec.ts';
import {
    CHIME_TULIP_TYPE,
    DRUM_PUFFBALL_TYPE,
    chimeHitsOn,
    defaultChimeTulip,
    defaultDrumPuffball,
    drumHitsOn,
    gardenFloraIssue,
    resolveChimeTulip,
    resolveDrumPuffball,
} from '../src/world/document/garden-flora.ts';
import {
    createEmptyDocument,
    emptyProgress,
    validateWorldDocument,
    type DocumentCommand,
} from '../src/world/document/schema.ts';
import { WorldDocumentSession } from '../src/world/document/session.ts';
import { validateSharedWorld } from '../src/world/document/shared-validation.ts';
import { MemoryDocumentStore } from '../src/world/document/store.ts';
import {
    getRegisteredTypes,
    getTypeMeta,
    registerBuiltinWorldObjectTypes,
} from '../src/world/foliage-registry.ts';
import { inferCategory } from '../src/world/map-entity-record.ts';
import { animatedFoliage, entities } from '../src/world/state.ts';

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

const TULIP_ID = 'garden-tulip-1';
const PUFF_ID = 'garden-puff-1';

function plant(
    id: string,
    type: string,
    x: number,
    z: number,
    params: Record<string, unknown> = {}
): EntitySnapshot {
    return {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id,
        entity: {
            type,
            position: [x, 0.5, z],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            placement: 'ground',
            params,
        },
    } as EntitySnapshot;
}

const tulip = (params?: Record<string, unknown>) =>
    plant(TULIP_ID, CHIME_TULIP_TYPE, 3, -4, params);
const puff = (params?: Record<string, unknown>) =>
    plant(PUFF_ID, DRUM_PUFFBALL_TYPE, -5, 6, params);

function liveGarden(id: string): THREE.Object3D[] {
    return entities.byKey(id).filter((o) => o.userData.isGardenFlora === true);
}

function doc(commands: DocumentCommand[]) {
    const d = createEmptyDocument({
        seed: 7,
        mapVersion: '1.0',
        id: '6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
        now: 1,
    });
    d.commands = commands;
    return d;
}

const baseLive = animatedFoliage.length;
const store = new MemoryDocumentStore();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

await test('both kinds are registered, classified, and offered in the build palette', () => {
    registerBuiltinWorldObjectTypes();
    const types = getRegisteredTypes();
    assert.ok(types.includes(CHIME_TULIP_TYPE));
    assert.ok(types.includes(DRUM_PUFFBALL_TYPE));
    assert.equal(getTypeMeta(CHIME_TULIP_TYPE)?.supportsMusic, true);
    assert.equal(inferCategory(CHIME_TULIP_TYPE), 'musical-flora');
    assert.equal(inferCategory(DRUM_PUFFBALL_TYPE), 'musical-flora');
    const palette = buildPalette(types, (t) => getTypeMeta(t)?.supportsMusic === true);
    const byType = new Map(palette.map((e) => [e.type, e]));
    assert.equal(byType.get(CHIME_TULIP_TYPE)?.category, 'music');
    assert.equal(byType.get(DRUM_PUFFBALL_TYPE)?.category, 'music');
    assert.equal(byType.get(CHIME_TULIP_TYPE)?.label, 'Chime tulip');
});

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

await test('a plant with no params plays the figure rolled from its id, the same everywhere', () => {
    assert.deepEqual(resolveChimeTulip('a', undefined), defaultChimeTulip('a'));
    assert.deepEqual(resolveChimeTulip('a', {}), defaultChimeTulip('a'));
    assert.deepEqual(resolveDrumPuffball('a', {}), defaultDrumPuffball('a'));
    let differs = false;
    for (let i = 0; i < 20 && !differs; i++) {
        const a = defaultChimeTulip(`t${i}`);
        const b = defaultChimeTulip(`t${i + 1}`);
        differs = a.degree !== b.degree || a.step !== b.step;
        assert.ok(a.degree >= 0 && a.degree <= 13 && a.step >= 0 && a.step <= 15);
    }
    assert.ok(differs, 'ids roll different figures');
});

await test('own params win, a bad param falls back to the roll', () => {
    assert.deepEqual(resolveChimeTulip('a', { degree: 5, step: 3 }), { degree: 5, step: 3 });
    assert.deepEqual(resolveChimeTulip('a', { degree: 99 }), defaultChimeTulip('a'));
    assert.deepEqual(resolveDrumPuffball('a', { drum: 'snare', shift: 2 }), {
        drum: 'snare',
        shift: 2,
    });
    assert.deepEqual(resolveDrumPuffball('a', { drum: 'tuba' }), defaultDrumPuffball('a'));
});

await test('figures: a tulip chimes twice a bar, drums keep their grid', () => {
    const hits = (f: (s: number) => boolean) => [...Array(16).keys()].filter(f);
    assert.deepEqual(
        hits((s) => chimeHitsOn({ degree: 0, step: 3 }, s)),
        [3, 11]
    );
    assert.deepEqual(
        hits((s) => drumHitsOn({ drum: 'kick', shift: 0 }, s)),
        [0, 8]
    );
    assert.deepEqual(
        hits((s) => drumHitsOn({ drum: 'snare', shift: 0 }, s)),
        [4, 12]
    );
    assert.deepEqual(
        hits((s) => drumHitsOn({ drum: 'hat', shift: 0 }, s)),
        [2, 6, 10, 14]
    );
    assert.deepEqual(
        hits((s) => drumHitsOn({ drum: 'kick', shift: 1 }, s)),
        [1, 9]
    );
});

// ---------------------------------------------------------------------------
// Validation at every boundary
// ---------------------------------------------------------------------------

await test('the document schema, shared-world validator and room parser refuse bad params', () => {
    const good = tulip({ degree: 4, step: 6 });
    assert.equal(gardenFloraIssue(good), null);
    assert.equal(validateWorldDocument(doc([{ type: 'place', snapshot: good }])).ok, true);
    assert.equal(
        validateWorldDocument(doc([{ type: 'place', snapshot: tulip() }])).ok,
        true,
        'no params at all is fine'
    );

    for (const bad of [
        tulip({ degree: 14 }),
        tulip({ step: 1.5 }),
        tulip({ step: 'one' }),
        puff({ drum: 'tuba' }),
        puff({ shift: 9 }),
    ]) {
        assert.ok(gardenFloraIssue(bad), JSON.stringify(bad.entity.params));
        assert.equal(validateWorldDocument(doc([{ type: 'place', snapshot: bad }])).ok, false);
        const nested: DocumentCommand = {
            type: 'batch',
            commands: [{ type: 'place', snapshot: bad }],
        };
        assert.equal(validateWorldDocument(doc([nested])).ok, false, 'also inside a batch');
        const moved: DocumentCommand = {
            type: 'move',
            from: plant(bad.id, bad.entity.type, 0, 0),
            to: bad,
        };
        assert.equal(validateWorldDocument(doc([moved])).ok, false, '...and on a move');
        const shared = validateSharedWorld(doc([{ type: 'place', snapshot: bad }]));
        assert.equal(shared.ok, false);
        if (!shared.ok) assert.equal(shared.code, 'schema');
    }

    const extra = tulip({ degree: 2, provenance: 'authored', persistentId: 'x' });
    assert.equal(gardenFloraIssue(extra), null, 'other params ride along');

    const message = (snapshot: EntitySnapshot): unknown => ({
        author: 'peer-b',
        seq: 1,
        rev: 1,
        baseRev: 0,
        command: { type: 'place', snapshot },
    });
    assert.equal(parseCmdMessage(message(good)).ok, true, 'a real tulip parses');
    assert.equal(
        parseCmdMessage(message(tulip({ degree: 40 }))).ok,
        false,
        'a forged tulip is a malformed room message'
    );
});

await test('another entity type with a "degree" param is not touched', () => {
    const rose = plant('rose-1', 'prism_rose_bush', 0, 0, { degree: 99, drum: 'tuba' });
    assert.equal(gardenFloraIssue(rose), null);
    assert.equal(validateWorldDocument(doc([{ type: 'place', snapshot: rose }])).ok, true);
});

// ---------------------------------------------------------------------------
// Place, undo, redo, save, export, reload, replay
// ---------------------------------------------------------------------------

await test('placing a plant spawns the real object, interaction-free, and undo removes it', () => {
    const history = new EditHistory();
    assert.equal(history.execute(new PlaceCommand(tulip({ degree: 4, step: 6 }))), true);
    assert.equal(history.execute(new PlaceCommand(puff({ drum: 'hat' }))), true);
    const t = liveGarden(TULIP_ID);
    const p = liveGarden(PUFF_ID);
    assert.equal(t.length, 1);
    assert.equal(p.length, 1);
    assert.equal(t[0].userData.mapEntityType, CHIME_TULIP_TYPE);
    assert.equal(p[0].userData.gardenKind, DRUM_PUFFBALL_TYPE);
    assert.deepEqual(
        { degree: t[0].userData.gardenParams.degree, step: t[0].userData.gardenParams.step },
        { degree: 4, step: 6 }
    );
    assert.ok(t[0].userData.gardenPulse, 'something to swell when the note is heard');
    assert.ok(animatedFoliage.includes(t[0] as never));
    assert.equal(history.undo(), true);
    assert.equal(history.undo(), true);
    assert.equal(liveGarden(TULIP_ID).length + liveGarden(PUFF_ID).length, 0);
    assert.equal(animatedFoliage.length, baseLive, 'nothing left behind');
});

let saved: Uint8Array | null = null;

await test('place, move, remove, undo, redo: the live plants follow every step', async () => {
    const history = new EditHistory();
    const session = new WorldDocumentSession(
        createEmptyDocument({ seed: 4242, mapVersion: '1.0', id: 'garden-doc', now: 1 }),
        {
            history,
            store,
            readProgress: emptyProgress,
            readPlayer: () => ({ position: [0, 2, 0], yaw: 0 }),
        }
    );
    assert.equal(history.execute(new PlaceCommand(tulip({ degree: 4, step: 6 }))), true);
    assert.equal(history.execute(new PlaceCommand(puff({ drum: 'snare', shift: 2 }))), true);

    const from = snapshotEntity(liveGarden(TULIP_ID)[0], {
        id: TULIP_ID,
        includeLegacyHash: false,
    })!;
    const to = {
        ...from,
        entity: { ...from.entity, position: [12, from.entity.position[1], 9] },
    } as EntitySnapshot;
    assert.equal(history.execute(new MoveCommand(from, to)), true);
    const moved = liveGarden(TULIP_ID);
    assert.equal(moved.length, 1, 'a move never duplicates');
    assert.ok(Math.abs(moved[0].position.x - 12) < 1e-6);
    assert.deepEqual(
        { d: moved[0].userData.gardenParams.degree, s: moved[0].userData.gardenParams.step },
        { d: 4, s: 6 },
        'params survive a move'
    );

    assert.equal(history.undo(), true);
    assert.ok(Math.abs(liveGarden(TULIP_ID)[0].position.x - 3) < 1e-6, 'undo walks it back');
    assert.equal(history.redo(), true);
    assert.ok(Math.abs(liveGarden(TULIP_ID)[0].position.x - 12) < 1e-6);

    const extra = plant('garden-puff-2', DRUM_PUFFBALL_TYPE, 1, 1, { drum: 'kick' });
    assert.equal(history.execute(new PlaceCommand(extra)), true);
    const extraSnap = snapshotEntity(liveGarden('garden-puff-2')[0], {
        id: 'garden-puff-2',
        includeLegacyHash: false,
    })!;
    assert.equal(history.execute(new RemoveCommand(extraSnap)), true);
    assert.equal(liveGarden('garden-puff-2').length, 0);

    assert.deepEqual(
        session.commands().map((c) => c.type),
        ['place', 'place', 'move', 'place', 'remove']
    );
    const document = await session.save(true);
    assert.equal(validateWorldDocument(document).ok, true);
    saved = await encodeCandyWorld(document);

    session.revertAll();
    assert.equal(liveGarden(TULIP_ID).length + liveGarden(PUFF_ID).length, 0, 'revertAll');
    assert.equal(animatedFoliage.length, baseLive);
    session.dispose();
});

await test('reload from .candyworld: the same plants with the same params, twice over', async () => {
    const result = await decodeCandyWorld(saved!);
    assert.ok(result.ok, result.ok ? '' : result.error.message);
    const decoded = result.doc;
    const history = new EditHistory();
    const session = new WorldDocumentSession(decoded, {
        history,
        store,
        readProgress: emptyProgress,
    });
    const r = session.replay();
    assert.deepEqual(r, { applied: 5, failed: 0 });

    const t = liveGarden(TULIP_ID);
    const p = liveGarden(PUFF_ID);
    assert.equal(t.length, 1);
    assert.equal(p.length, 1);
    assert.equal(liveGarden('garden-puff-2').length, 0, 'the removed one stays removed');
    assert.ok(Math.abs(t[0].position.x - 12) < 1e-6 && Math.abs(t[0].position.z - 9) < 1e-6);
    assert.deepEqual(
        { d: t[0].userData.gardenParams.degree, s: t[0].userData.gardenParams.step },
        { d: 4, s: 6 }
    );
    assert.deepEqual(
        { drum: p[0].userData.gardenParams.drum, shift: p[0].userData.gardenParams.shift },
        { drum: 'snare', shift: 2 }
    );
    const snap = snapshotEntity(t[0], { id: TULIP_ID, includeLegacyHash: false })!;
    assert.equal((snap.entity.params as Record<string, unknown>).degree, 4);

    for (const data of decoded.commands) deserializeWorldCommand(data).apply();
    assert.equal(liveGarden(TULIP_ID).length, 1, 'replaying over a live world is idempotent');
    assert.equal(liveGarden(PUFF_ID).length, 1);
    session.revertAll();
    assert.equal(liveGarden(TULIP_ID).length + liveGarden(PUFF_ID).length, 0);
    assert.equal(animatedFoliage.length, baseLive);
    session.dispose();
});

if (failures > 0) {
    console.error(`\n${failures} garden flora test(s) failed`);
    process.exit(1);
}
console.log('\nAll garden flora tests passed');
process.exit(0);
