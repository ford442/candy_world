import assert from 'node:assert/strict';
import * as THREE from 'three';
import { snapshotEntity, migrateSnapshot, applyEntitySnapshot, CURRENT_SNAPSHOT_VERSION } from '../src/systems/entity-snapshot-core.ts';

function runTests() {
    console.log('Running entity-snapshot tests...');

    // 1. Static Prop Capture
    const rock = new THREE.Object3D();
    rock.userData = { type: 'rock', mapExport: { type: 'rock', provenance: 'test' } };
    rock.position.set(10, 0, -5);
    rock.scale.set(1.5, 1.5, 1.5);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    rock.quaternion.copy(q);

    const rockSnap = snapshotEntity(rock, 'snap-rock-1');
    assert.ok(rockSnap, 'Static prop snapshot failed');
    assert.equal(rockSnap.schemaVersion, CURRENT_SNAPSHOT_VERSION);
    assert.equal(rockSnap.id, 'snap-rock-1');
    assert.equal(rockSnap.entity.type, 'rock');
    assert.deepEqual(rockSnap.entity.position, [10, 0, -5]);
    assert.equal(rockSnap.entity.scale, 1.5);
    assert.equal(rockSnap.entity.params.provenance, 'test');
    console.log('✅ Static Prop Capture passed');

    // 2. Music-tagged entity
    const lily = new THREE.Object3D();
    lily.userData = {
        type: 'vibrato_violet',
        note: 'C4',
        noteIndex: 0,
        mapExport: {
            type: 'vibrato_violet',
            provenance: 'map',
            note: 'C4',
            noteIndex: 0
        }
    };
    lily.position.set(-2, 1, 3);

    const lilySnap = snapshotEntity(lily, 'snap-lily-2');
    assert.ok(lilySnap, 'Music entity snapshot failed');
    assert.equal(lilySnap.entity.type, 'vibrato_violet');
    assert.equal(lilySnap.entity.note, 'C4');
    assert.equal(lilySnap.entity.noteIndex, 0);
    console.log('✅ Music-tagged Entity Capture passed');

    // 3. CPU mirror instanced instance
    const cpuMirror = new THREE.Object3D();
    cpuMirror.userData = {
        type: 'mushroom',
        isBatched: true,
        mapExport: {
            type: 'mushroom',
            provenance: 'instanced-test',
        }
    };
    cpuMirror.position.set(5, 5, 5);
    cpuMirror.scale.set(1, 2, 3);

    const cpuSnap = snapshotEntity(cpuMirror, 'snap-cpu-3');
    assert.ok(cpuSnap, 'CPU mirror snapshot failed');
    assert.equal(cpuSnap.entity.type, 'mushroom');
    assert.deepEqual(cpuSnap.entity.scale, [1, 2, 3]);
    assert.equal(cpuSnap.entity.params.batched, true);
    console.log('✅ CPU Mirror Capture passed');

    // 4. Migration v1 -> current
    const v1Data = {
        schemaVersion: 1,
        id: 'legacy-id-1',
        entity: {
            type: 'tree',
            position: [0, 0, 0],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            params: {}
        }
    };

    const migrated = migrateSnapshot(v1Data);
    assert.equal(migrated.schemaVersion, CURRENT_SNAPSHOT_VERSION);
    assert.equal(migrated.id, 'legacy-id-1');
    assert.equal(migrated.entity.type, 'tree');
    console.log('✅ Migration v1 passed');


    // 5. Apply Entity Snapshot
    const targetObj = new THREE.Object3D();
    applyEntitySnapshot(lilySnap, targetObj);
    assert.deepEqual(targetObj.position.toArray(), [-2, 1, 3]);
    assert.equal(targetObj.userData.type, 'vibrato_violet');
    assert.equal(targetObj.userData.note, 'C4');
    console.log('✅ Apply Entity Snapshot passed');

    console.log('All tests passed! 🎉');
}

runTests();
