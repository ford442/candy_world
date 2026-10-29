import * as THREE from 'three';
import assert from 'node:assert';

// Mocks to allow module imports to succeed without full DOM/WebGPU
global.window = {};
global.document = {
    createElement: () => ({ style: {} }),
};
global.performance = { now: () => Date.now() };

import { waterfallBatcher } from '../src/foliage/waterfall-batcher.ts';
import { EcosystemManager } from '../src/systems/weather/weather-ecosystem.ts';

// Column instance translation: add() stores the column mid point,
// i.e. position.y - height / 2.
function columnTranslation(id) {
    const index = waterfallBatcher.idToIndex.get(id);
    const m = new THREE.Matrix4().fromArray(waterfallBatcher.mesh.instanceMatrix.array, index * 16);
    return new THREE.Vector3().setFromMatrixPosition(m);
}

function assertClose(actual, expected, label) {
    assert.ok(
        actual.distanceTo(expected) < 1e-5,
        `${label}: expected ${expected.toArray()}, got ${actual.toArray()}`
    );
}

function runTests() {
    console.log('💧 Waterfall Batcher Test');
    console.log('=========================\n');
    let passed = 0;

    {
        const before = waterfallBatcher.count;
        const posA = new THREE.Vector3(1, 6, 2);
        const posB = new THREE.Vector3(50, 9, -40);
        waterfallBatcher.add('dup', posA, 4, 2);
        waterfallBatcher.add('dup', posB, 4, 2);
        assert.equal(waterfallBatcher.count, before + 1, 'second add with the same id is ignored');
        assertClose(columnTranslation('dup'), new THREE.Vector3(1, 6 - 2, 2), 'first add wins');
        waterfallBatcher.remove('dup');
        assert.equal(waterfallBatcher.count, before, 'remove returns to baseline');
        console.log('  ✓ add() keeps the first position for a repeated id');
        passed++;
    }

    {
        const eco = new EcosystemManager({});
        const mushroom = new THREE.Object3D();
        mushroom.position.set(12, 3, -7);
        mushroom.userData = { size: 'giant', capRadius: 4, capHeight: 10 };
        const falls = new Set();
        const before = waterfallBatcher.count;

        eco.updateMushroomWaterfalls(0, 0, 'rain', 0.5, [mushroom], falls);
        assert.equal(waterfallBatcher.count, before + 1, 'one waterfall per giant mushroom');
        assert.ok(falls.has(mushroom.uuid), 'mushroom tracked');
        // Anchor: (x + radius * 0.8, capHeight * 0.8, z), column height capHeight * 0.8.
        const top = 10 * 0.8;
        assertClose(
            columnTranslation(mushroom.uuid),
            new THREE.Vector3(12 + 4 * 0.8, top - top / 2, -7),
            'anchor unchanged'
        );

        eco.updateMushroomWaterfalls(0, 0, 'clear', 0, [mushroom], falls);
        assert.equal(waterfallBatcher.count, before, 'clear weather removes it');
        assert.equal(falls.size, 0, 'tracking cleared');
        console.log('  ✓ Rain adds exactly one waterfall at the cap edge; clear removes it');
        passed++;
    }

    console.log(`\n✅ All ${passed} tests passed!`);
}

try {
    runTests();
} catch (err) {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
}
