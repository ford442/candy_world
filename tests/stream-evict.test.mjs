import * as THREE from 'three';
import assert from 'node:assert';

// Mocks to allow module imports to succeed without full DOM/WebGPU
global.window = {};
global.document = {
    createElement: () => ({ style: {} }),
};
global.performance = { now: () => Date.now() };

// We use dynamic imports so we can bypass some missing imports from tsl via tsx for simple tests if possible.
// Wait, the project provides a way to test without failing on imports using tsx. Let's just mock what we need.
// We'll write the test to execute correctly with tsx by importing properly.
// Mock foliageGroup to avoid uninitialized errors from batchers referencing it
global.foliageGroup = new THREE.Group();

import { waterfallBatcher } from '../src/foliage/waterfall-batcher.ts';
import { dandelionBatcher } from '../src/foliage/dandelion-batcher.ts';
import { subwooferLotusBatcher } from '../src/foliage/subwoofer-lotus-batcher.ts';
import { glowingFlowerBatcher } from '../src/foliage/glowing-flower-batcher.ts';
import { luminousPlantBatcher } from '../src/foliage/luminous-plant-batcher.ts';
import { gemFruitBatcher } from '../src/foliage/gem-fruit-batcher.ts';
import { sugarCaveBatcher } from '../src/foliage/sugar-cave-batcher.ts';

// Test runner function
async function runTests() {
    console.log('🍬 Candy World Streamer Evict Parity Test');
    console.log('=========================================\n');
    let passed = 0;

    try {
        // 1. WaterfallBatcher
        const wfId = THREE.MathUtils.generateUUID();
        const wfObj = new THREE.Object3D();
        wfObj.uuid = wfId;

        waterfallBatcher.init();
        waterfallBatcher.add(wfId, new THREE.Vector3(), 5, 2);
        assert.equal(waterfallBatcher.count, 1, 'Waterfall should have 1 count');

        waterfallBatcher.removeInstance(wfObj);
        assert.equal(waterfallBatcher.count, 0, 'Waterfall should have 0 count after remove');
        console.log('  ✓ WaterfallBatcher swap-with-last successful');
        passed++;

        // 2. DandelionBatcher
        const danObj1 = new THREE.Object3D();
        const danObj2 = new THREE.Object3D();

        dandelionBatcher.init();
        dandelionBatcher.register(danObj1);
        dandelionBatcher.register(danObj2);
        assert.equal(dandelionBatcher.count, 2, 'Dandelion should have 2 counts');

        dandelionBatcher.removeInstance(danObj1);
        assert.equal(dandelionBatcher.count, 1, 'Dandelion should have 1 count after swap-with-last');
        assert.equal(danObj2.userData.batchIndex, 0, 'Swapped object should update its batchIndex');
        console.log('  ✓ DandelionBatcher swap-with-last successful');
        passed++;

        // 3. SubwooferLotusBatcher
        const lotusObj1 = new THREE.Object3D();
        const lotusObj2 = new THREE.Object3D();

        subwooferLotusBatcher.register(lotusObj1);
        subwooferLotusBatcher.register(lotusObj2);
        // subwooferLotusBatcher logic replaces proxy with interactiveGroup, let's use the proxy
        assert.equal(subwooferLotusBatcher['_count'], 2, 'Lotus should have 2 counts');

        subwooferLotusBatcher.removeInstance(lotusObj1);
        assert.equal(subwooferLotusBatcher['_count'], 1, 'Lotus should have 1 count after swap');
        assert.equal(lotusObj2.userData.batchIndex, 0, 'Swapped proxy should update batchIndex');
        console.log('  ✓ SubwooferLotusBatcher swap-with-last successful');
        passed++;

        // 4. GlowingFlowerBatcher
        const gfObj1 = new THREE.Object3D();
        const gfObj2 = new THREE.Object3D();
        gfObj1.uuid = 'gf1';
        gfObj2.uuid = 'gf2';

        glowingFlowerBatcher.init();
        glowingFlowerBatcher.register(gfObj1);
        glowingFlowerBatcher.register(gfObj2);
        assert.equal(glowingFlowerBatcher.count, 2, 'GlowingFlower should have 2 counts');

        glowingFlowerBatcher.removeInstance(gfObj1);
        assert.equal(glowingFlowerBatcher.count, 1, 'GlowingFlower should have 1 count after swap');
        assert.equal(glowingFlowerBatcher['indexMap'].get('gf2'), 0, 'Swapped indexMap updated');
        console.log('  ✓ GlowingFlowerBatcher swap-with-last successful');
        passed++;

        // 5. LuminousPlantBatcher
        // Note: group is used directly
        const lpObj1 = new THREE.Group();
        const lpObj2 = new THREE.Group();

        luminousPlantBatcher.register(lpObj1);
        luminousPlantBatcher.register(lpObj2);

        // Wait, mesh might need init. Luminous initialized in constructor.
        assert.equal(luminousPlantBatcher['count'], 2, 'Luminous should have 2 counts');

        luminousPlantBatcher.removeInstance(lpObj1);
        assert.equal(luminousPlantBatcher['count'], 1, 'Luminous should have 1 count after swap');
        console.log('  ✓ LuminousPlantBatcher swap-with-last successful');
        passed++;

        // 6. GemFruitBatcher
        // GemFruit logic attachToTree sets gemRefs on tree
        const treeObj1 = new THREE.Group();
        const treeObj2 = new THREE.Group();

        gemFruitBatcher.attachToTree(treeObj1, { gemCount: 2 });
        gemFruitBatcher.attachToTree(treeObj2, { gemCount: 1 });

        let totalGems = gemFruitBatcher['_counts'].reduce((a, b) => a + b, 0);
        assert.ok(totalGems > 0, 'GemFruit should have spawned gems');

        const tree2RefsBefore = JSON.parse(JSON.stringify(treeObj2.userData.gemRefs));

        gemFruitBatcher.removeInstance(treeObj1);

        let remainingGems = gemFruitBatcher['_counts'].reduce((a, b) => a + b, 0);
        assert.equal(remainingGems, tree2RefsBefore.length, 'GemFruit should only leave tree2 gems');
        console.log('  ✓ GemFruitBatcher swap-with-last successful');
        passed++;

        // 7. SugarCaveBatcher
        const scObj1 = new THREE.Object3D();
        const scObj2 = new THREE.Object3D();

        sugarCaveBatcher.init();
        sugarCaveBatcher.register(scObj1);
        sugarCaveBatcher.register(scObj2);

        assert.equal(sugarCaveBatcher['_count'], 2, 'SugarCave should have 2 counts');

        sugarCaveBatcher.removeInstance(scObj1);
        assert.equal(sugarCaveBatcher['_count'], 1, 'SugarCave should have 1 count after swap');
        assert.equal(scObj2.userData.batchIndex, 0, 'Swapped SugarCave batchIndex updated');
        console.log('  ✓ SugarCaveBatcher swap-with-last successful');
        passed++;

    } catch (err) {
        console.error('❌ Test failed!', err);
        process.exit(1);
    }

    console.log(`\n✅ All ${passed} tests passed!`);
}

runTests();
