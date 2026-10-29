import * as THREE from 'three';
import assert from 'node:assert';

// Mocks to allow module imports to succeed without full DOM/WebGPU
global.window = {};
global.document = {
    createElement: () => ({ style: {} }),
};
global.performance = { now: () => Date.now() };

import { gemFruitBatcher } from '../src/foliage/gem-fruit-batcher.ts';

// One instance per hang point: every slot attachToTree spends must be a
// distinct jewel. stream-evict only checks mesh.count against refs.length,
// which a duplicated register satisfies, so this test checks positions.

const total = () => gemFruitBatcher.meshes.reduce((n, m) => n + m.count, 0);

function translationOf(ref) {
    const m = new THREE.Matrix4().fromArray(
        gemFruitBatcher.meshes[ref.gemType].instanceMatrix.array,
        ref.instanceIndex * 16
    );
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    return `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
}

function makeTree(x, z) {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    return tree;
}

// Constant 0.75 gives every branch two gems (4 branches x 2 >= 8), so the
// requested count is always reachable and the result is deterministic.
function withFixedRandom(fn) {
    const real = Math.random;
    Math.random = () => 0.75;
    try {
        return fn();
    } finally {
        Math.random = real;
    }
}

function runTests() {
    console.log('💎 Gem Fruit Batcher Test');
    console.log('=========================\n');
    let passed = 0;

    for (const gemCount of [6, 5]) {
        const before = total();
        const tree = makeTree(10, -20);
        const { placed, refs } = withFixedRandom(() =>
            gemFruitBatcher.attachToTree(tree, { gemCount })
        );
        const delta = total() - before;

        assert.equal(delta, gemCount, `gemCount ${gemCount}: slots spent`);
        assert.equal(refs.length, gemCount, `gemCount ${gemCount}: refs`);
        assert.equal(placed, gemCount, `gemCount ${gemCount}: placed`);
        assert.equal(
            new Set(refs.map(translationOf)).size,
            delta,
            `gemCount ${gemCount}: every slot is a distinct position`
        );
        assert.deepEqual(
            refs.map((r) => r.gemType),
            Array.from({ length: gemCount }, (_, i) => i % 3),
            `gemCount ${gemCount}: jewel types cycle 0,1,2`
        );

        gemFruitBatcher.removeInstance(tree);
        assert.equal(total(), before, `gemCount ${gemCount}: remove returns to baseline`);
        assert.equal(tree.userData.gemRefs, null, `gemCount ${gemCount}: gemRefs nulled`);
        console.log(`  ✓ gemCount ${gemCount}: ${gemCount} distinct jewels, removed cleanly`);
        passed++;
    }

    {
        const before = gemFruitBatcher.meshes.map((m) => m.count);
        const a = makeTree(-30, 5);
        const b = makeTree(40, 12);
        withFixedRandom(() => {
            gemFruitBatcher.attachToTree(a, { gemCount: 6 });
            gemFruitBatcher.attachToTree(b, { gemCount: 6 });
        });
        const bRefs = b.userData.gemRefs;
        const bPositions = bRefs.map(translationOf).sort();

        gemFruitBatcher.removeInstance(a);
        assert.equal(
            total(),
            before.reduce((n, c) => n + c, 0) + bRefs.length,
            'second tree keeps its slots'
        );
        assert.deepEqual(
            bRefs.map(translationOf).sort(),
            bPositions,
            'second tree keeps its matrices after swap-with-last'
        );

        gemFruitBatcher.removeInstance(b);
        assert.deepEqual(
            gemFruitBatcher.meshes.map((m) => m.count),
            before,
            'both trees removed'
        );
        console.log("  ✓ Removing one tree leaves the other tree's jewels intact");
        passed++;
    }

    {
        // Real randomness: a short branch roll may place fewer than requested,
        // but never more, and never two slots at one hang point.
        const before = total();
        for (let i = 0; i < 50; i++) {
            const gemCount = 5 + (i % 4);
            const tree = makeTree(i * 3, -i * 2);
            const { placed, refs } = gemFruitBatcher.attachToTree(tree, { gemCount });
            const delta = total() - before;
            assert.ok(
                placed > 0 && placed <= gemCount,
                `trial ${i}: placed ${placed} within 1..${gemCount}`
            );
            assert.equal(refs.length, placed, `trial ${i}: refs match placed`);
            assert.equal(delta, placed, `trial ${i}: slots match placed`);
            assert.equal(
                new Set(refs.map(translationOf)).size,
                placed,
                `trial ${i}: distinct positions`
            );
            gemFruitBatcher.removeInstance(tree);
            assert.equal(total(), before, `trial ${i}: back to baseline`);
        }
        console.log('  ✓ 50 random trees: slots == placed <= gemCount, all distinct');
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
