/**
 * Round-trip tests for the typed EntitySnapshot primitive.
 *
 * Runs in plain Node (tsx + the asset stubs in tests/support) — no
 * WebGPURenderer, no browser. Entities are restored through the REAL
 * `processMapEntity` registration path, and instance transforms are read from
 * the batcher's CPU mirror `Object3D`, never from `instanceMatrix` after a GPU
 * upload and never via `mapAsync`.
 *
 * Run: npm run test:entity-snapshot
 */

import assert from 'node:assert/strict';
import {
    CURRENT_SNAPSHOT_VERSION,
    canonicalizeEntity,
    migrateSnapshot,
    snapshotEntity,
} from '../src/systems/entity-snapshot-core.ts';
import { restoreEntity } from '../src/systems/entity-snapshot.ts';
import { mergeSnapshotLayers } from '../src/systems/entity-snapshot-store.ts';
import { animatedFoliage } from '../src/world/state.ts';

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err && err.stack ? err.stack : err}`);
    }
}

/** Build the first snapshot for an authored map record, without a live object. */
function seedSnapshot(entity, id) {
    return { schemaVersion: CURRENT_SNAPSHOT_VERSION, id, entity, tags: [] };
}

/**
 * restore(snapshot) → live object → snapshot again.
 * Returns { created, snapshot } for the restored entity.
 */
function roundTrip(snapshot) {
    const created = restoreEntity(snapshot);
    assert.ok(created.length > 0, `restore produced no object for ${snapshot.entity.type}`);
    const mirror = created[0];
    // CPU mirror only: these are plain Object3Ds tracked by animatedFoliage.
    assert.ok(
        !mirror.isInstancedMesh,
        'snapshot source must be the CPU mirror, not an InstancedMesh'
    );
    assert.ok(
        animatedFoliage.includes(mirror),
        'restored object must be registered in animatedFoliage'
    );
    const next = snapshotEntity(mirror, { id: snapshot.id });
    assert.ok(next, `re-snapshot failed for ${snapshot.entity.type}`);
    return { created, snapshot: next };
}

// ---------------------------------------------------------------------------
// (a) static prop — not batched, authored scale/rotation
// ---------------------------------------------------------------------------
test('static prop round-trips to the same canonical CandyMapEntity', () => {
    const seed = seedSnapshot(
        {
            type: 'starflower',
            position: [12.5, 3.25, -7.75],
            rotation: { quat: [0, 0.3827, 0, 0.9239] },
            scale: 1.75,
            placement: 'absolute',
            params: {},
        },
        'snap-static-prop'
    );

    const first = roundTrip(seed).snapshot;
    const second = roundTrip(first).snapshot;

    assert.equal(first.schemaVersion, CURRENT_SNAPSHOT_VERSION);
    assert.equal(first.id, 'snap-static-prop');
    assert.equal(first.entity.type, 'starflower');
    assert.deepEqual(first.entity.position, [12.5, 3.25, -7.75]);
    assert.equal(first.entity.scale, 1.75);
    assert.deepEqual(first.entity.rotation, { quat: [0, 0.3827, 0, 0.9239] });
    assert.deepEqual(canonicalizeEntity(second.entity), canonicalizeEntity(first.entity));
});

// ---------------------------------------------------------------------------
// (b) instanced-batcher entity — one logical instance, read from the CPU mirror
// ---------------------------------------------------------------------------
test('instanced-batcher instance round-trips per logical instance', () => {
    const seed = seedSnapshot(
        {
            type: 'mushroom',
            position: [10, 0.5, -5],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1.5,
            variant: 'regular',
            placement: 'absolute',
            params: {},
        },
        'snap-batched-mushroom'
    );

    const { created, snapshot: first } = roundTrip(seed);
    const mirror = created[0];

    assert.equal(mirror.userData.isBatched, true, 'fixture must exercise the batched path');
    // The CPU mirror's own scale is identity — the batcher baked it into geometry.
    assert.deepEqual(mirror.scale.toArray(), [1, 1, 1]);
    // ...so the authored transform is what makes the round-trip lossless.
    assert.equal(first.entity.params.batched, true);
    assert.equal(first.entity.scale, 1.5, 'authored scale survives the batcher');
    assert.deepEqual(
        first.entity.rotation,
        { quat: [0, 0, 0, 1] },
        'authored rotation survives the batcher'
    );
    assert.deepEqual(first.entity.position, [10, 0.5, -5]);

    const second = roundTrip(first).snapshot;
    assert.deepEqual(canonicalizeEntity(second.entity), canonicalizeEntity(first.entity));
});

// ---------------------------------------------------------------------------
// (c) music-reactive entity — note fields + derived tags
// ---------------------------------------------------------------------------
test('music-reactive entity round-trips note fields and tags', () => {
    const seed = seedSnapshot(
        {
            type: 'vibrato_violet',
            position: [-2, 1.5, 3],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            note: 'C4',
            noteIndex: 0,
            biome: 'arpeggio_grove',
            music: { biomeTag: 'arpeggio_grove', trackerChannel: 2, reactivityProfile: 'lead' },
            placement: 'absolute',
            params: {},
        },
        'snap-music-violet'
    );

    const first = roundTrip(seed).snapshot;

    assert.equal(first.entity.note, 'C4');
    assert.equal(first.entity.noteIndex, 0);
    assert.equal(first.entity.biome, 'arpeggio_grove');
    assert.deepEqual(first.entity.music, {
        biomeTag: 'arpeggio_grove',
        trackerChannel: 2,
        reactivityProfile: 'lead',
    });
    assert.deepEqual(first.tags, [
        'biome:arpeggio_grove',
        'channel:2',
        'music:arpeggio_grove',
        'note:C4',
        'profile:lead',
        'reactivity:flora',
    ]);

    const second = roundTrip(first).snapshot;
    assert.deepEqual(canonicalizeEntity(second.entity), canonicalizeEntity(first.entity));
});

// ---------------------------------------------------------------------------
// ids & legacy position hash
// ---------------------------------------------------------------------------
test('snapshot ids are generated, never the position hash', () => {
    const seed = seedSnapshot(
        {
            type: 'starflower',
            position: [4, 2, 4],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            placement: 'absolute',
            params: {},
        },
        'snap-id-check'
    );

    const created = restoreEntity(seed);
    const a = snapshotEntity(created[0]);
    const b = snapshotEntity(created[0]);

    assert.notEqual(a.id, b.id, 'each snapshot gets a fresh generated id');
    assert.match(a.id, /^snap_/);
    assert.ok(a.legacyPositionHash, 'position hash is retained for legacy lookup');
    assert.equal(
        a.legacyPositionHash,
        b.legacyPositionHash,
        'position hash depends only on position + type'
    );
    assert.notEqual(a.id, a.legacyPositionHash, 'the id is not the position hash');
});

// ---------------------------------------------------------------------------
// migrations
// ---------------------------------------------------------------------------
test('v1 snapshot migrates to the current shape', () => {
    const v1 = {
        schemaVersion: 1,
        id: 'legacy-id-1',
        positionHash: 3141592653,
        entity: {
            type: 'starflower',
            position: [0, 0, 0],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            params: {},
        },
    };

    const migrated = migrateSnapshot(v1);
    assert.equal(migrated.schemaVersion, CURRENT_SNAPSHOT_VERSION);
    assert.equal(migrated.id, 'legacy-id-1');
    assert.equal(migrated.entity.type, 'starflower');
    assert.equal(migrated.legacyPositionHash, '3141592653');
    assert.equal(migrated.positionHash, undefined, 'v1 positionHash is demoted, not kept');
    assert.deepEqual(migrated.tags, []);
});

test('a current-version snapshot migrates to itself', () => {
    const snapshot = seedSnapshot(
        {
            type: 'starflower',
            position: [1, 2, 3],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            params: {},
        },
        'snap-current'
    );
    assert.deepEqual(migrateSnapshot(snapshot), snapshot);
});

test('a future-version snapshot is rejected', () => {
    assert.throws(
        () =>
            migrateSnapshot({
                schemaVersion: CURRENT_SNAPSHOT_VERSION + 1,
                id: 'x',
                entity: { type: 'starflower', position: [0, 0, 0] },
            }),
        /future version/
    );
});

// ---------------------------------------------------------------------------
// sidecar merge order: map.json base → overrides
// ---------------------------------------------------------------------------
test('sidecar overrides replace matching base entities and append new ones', () => {
    const base = [
        { id: 'e1', type: 'starflower', position: [0, 0, 0] },
        { id: 'e2', type: 'mushroom', position: [1, 0, 1] },
    ];
    const committed = [seedSnapshot({ type: 'mushroom', position: [5, 0, 5] }, 'e2')];
    const dev = [
        seedSnapshot({ type: 'mushroom', position: [9, 0, 9] }, 'e2'),
        seedSnapshot({ type: 'flower', position: [2, 0, 2] }, 'e3'),
    ];

    const merged = mergeSnapshotLayers(base, committed, dev);
    assert.deepEqual(
        merged.map((e) => e.id),
        ['e1', 'e2', 'e3']
    );
    assert.deepEqual(merged[1].position, [9, 0, 9], 'the later layer wins');
    assert.equal(merged[2].type, 'flower');
});

// ---------------------------------------------------------------------------
// objects with no exportable map type
// ---------------------------------------------------------------------------
test('snapshotEntity returns null for a non-map object', () => {
    assert.equal(snapshotEntity({ userData: {} }), null);
});

if (failures > 0) {
    console.error(`\n${failures} entity-snapshot test(s) failed`);
    process.exit(1);
}
console.log('\nAll entity-snapshot tests passed 🎉');
