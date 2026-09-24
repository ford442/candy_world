/**
 * Test for save system snapshot restoration (`applyEntitySnapshots`).
 */
import assert from 'node:assert/strict';
import { applyEntitySnapshots } from '../src/systems/save-system/entity-snapshot.ts';
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

test('applyEntitySnapshots gracefully skips unknown types without crashing', () => {
    const initialLen = animatedFoliage.length;

    // We provide an array with an invalid type, and a valid type
    const snapshots = [
        {
            id: 'save-restored-prop-invalid',
            type: 'not-a-real-type-gummybutterfly',
            position: [1, 2, 3]
        },
        {
            id: 'save-restored-prop-valid',
            type: 'starflower',
            position: [12.5, 3.25, -7.75],
            rotation: [0, 0.3827, 0, 0.9239],
            scale: 1.75,
            placement: 'absolute',
            params: {}
        }
    ];

    applyEntitySnapshots(snapshots);

    // Check if the valid one got restored by finding it in the array
    const found = animatedFoliage.find(obj => obj.userData?.mapEntityId === 'save-restored-prop-valid');
    assert.ok(found, 'Valid restored object should exist in animatedFoliage with the given mapEntityId');
    assert.equal(found.userData.mapEntityType, 'starflower', 'Restored object should have the correct type');
});

if (failures > 0) {
    console.error(`\n${failures} save-entity-snapshot test(s) failed`);
    process.exit(1);
}
console.log('\nAll save-entity-snapshot tests passed 🎉');
