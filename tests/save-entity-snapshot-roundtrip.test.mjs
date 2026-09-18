/**
 * Save/load round-trip for src/systems/save-system/entity-snapshot.ts.
 *
 * applyEntitySnapshots() used to be a documented no-op (logged a warning and
 * returned) — a save/reload cycle silently dropped every dynamically-placed
 * entity. This exercises the real path: spawn via processMapEntity (the same
 * production spawn path world-gen uses) -> serializeEntitySnapshots() ->
 * simulate a reload by dropping the live object -> applyEntitySnapshots() ->
 * assert a matching entity is back in animatedFoliage.
 *
 * Run: npm run test:save-entity-snapshot (tsx --import ./tests/support/register-hooks.mjs tests/save-entity-snapshot-roundtrip.test.mjs)
 */

import assert from 'node:assert/strict';
import { processMapEntity } from '../src/world/generation-entities.ts';
import {
    applyEntitySnapshots,
    serializeEntitySnapshots,
} from '../src/systems/save-system/entity-snapshot.ts';
import { animatedFoliage } from '../src/world/state.ts';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (err) {
        console.error(`❌ ${name}\n   ${err && err.stack ? err.stack : err}`);
        failed++;
    }
}

const TEST_ID = 'roundtrip-test-mushroom';
const TEST_POSITION = [700, 42, 700]; // far from LAKE_BOUNDS; placement 'absolute' skips the ground query anyway

test('static entity round-trips through save/load via applyEntitySnapshots', () => {
    // Spawn via the real map-gen entry point, same as world-gen and the editor.
    processMapEntity(
        {
            id: TEST_ID,
            type: 'mushroom',
            position: TEST_POSITION,
            placement: 'absolute',
            persistentId: TEST_ID,
        },
        null
    );

    const spawned = animatedFoliage.find((o) => o.userData?.mapEntityId === TEST_ID);
    assert.ok(spawned, 'processMapEntity should register the entity in animatedFoliage');

    const snapshots = serializeEntitySnapshots();
    const snapshot = snapshots.find((s) => s.id === TEST_ID);
    assert.ok(snapshot, 'serializeEntitySnapshots should capture the spawned entity');
    assert.equal(snapshot.type, 'mushroom');
    assert.ok(
        Math.abs(snapshot.position[0] - TEST_POSITION[0]) < 1e-6 &&
            Math.abs(snapshot.position[2] - TEST_POSITION[2]) < 1e-6,
        `captured position should match spawn position, got ${snapshot.position}`
    );

    // Simulate a reload: drop the live object, keep only the snapshot.
    const idx = animatedFoliage.indexOf(spawned);
    animatedFoliage.splice(idx, 1);
    assert.ok(
        !animatedFoliage.some((o) => o.userData?.mapEntityId === TEST_ID),
        'test setup: entity should be gone before applying the snapshot'
    );

    applyEntitySnapshots([snapshot]);

    const restored = animatedFoliage.find((o) => o.userData?.mapEntityId === TEST_ID);
    assert.ok(restored, 'applyEntitySnapshots should respawn the entity into animatedFoliage');
    assert.equal(restored.userData.mapEntityType, 'mushroom');
    assert.ok(
        Math.abs(restored.position.x - TEST_POSITION[0]) < 1e-6 &&
            Math.abs(restored.position.z - TEST_POSITION[2]) < 1e-6,
        `restored position should match, got (${restored.position.x}, ${restored.position.z})`
    );
});

test('applyEntitySnapshots is a safe no-op for an empty/undefined snapshot list', () => {
    const before = animatedFoliage.length;
    applyEntitySnapshots([]);
    applyEntitySnapshots(undefined);
    assert.equal(animatedFoliage.length, before, 'no entities should be added or removed');
});

console.log(`\n---\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
