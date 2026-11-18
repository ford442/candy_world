/**
 * TreeBatcher on InstancedBatcher (#2166): each tree part mesh is a
 * TreePartBatcher, a tree owns one handle per sub-mesh, and removal is the
 * base swap-remove. Run: npm run test:batchers
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import * as THREE from 'three';
import { updateInstancedBatchers } from '../src/core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../src/core/scheduler/types.ts';
import { ANIMATION_TYPES } from '../src/foliage/animation-nodes.ts';
import { TreeBatcher } from '../src/foliage/tree-batcher/index.ts';
import { buildTestTree, TEST_TREE_LEAF_Y } from './support/tree-fixture.ts';

const ctx = { dt: 0.016, rawDt: 0.016, time: 1, audio: {} } as unknown as FrameContext;
const HEX = [0xff0000, 0x00ff00, 0x0000ff, 0xffa500, 0x8b4513];

function spawn(b: TreeBatcher, i: number, animationType = 'vineSway'): THREE.Group {
    const obj = new THREE.Object3D();
    obj.position.set(i * 4 + 1, 0, -i);
    obj.userData.animationType = animationType;
    obj.userData.animationOffset = i * 0.5;
    const tree = buildTestTree(obj, HEX[i]);
    b.register(tree, 'floweringTree');
    return tree;
}

function translationAt(mesh: THREE.InstancedMesh, slot: number): number[] {
    const a = mesh.instanceMatrix.array;
    return [a[slot * 16 + 12], a[slot * 16 + 13], a[slot * 16 + 14]];
}

test('removing a middle tree moves the last tree into its slots, streams aligned', () => {
    const b = new TreeBatcher(16);
    const trees = HEX.map((_, i) => spawn(b, i));
    updateInstancedBatchers(ctx);
    assert.equal(b.trunks.count, 5);
    assert.equal(b.spheres.count, 5);

    b.removeInstance(trees[1]);
    updateInstancedBatchers(ctx);
    assert.equal(b.trunks.count, 4);
    assert.equal(b.spheres.count, 4);
    assert.ok(!b.has(trees[1]));

    // Slot 1 now holds tree 4 (the last) in every stream.
    const last = trees[4];
    assert.deepEqual(translationAt(b.trunks, 1), [last.position.x, 0, last.position.z]);
    assert.deepEqual(translationAt(b.spheres, 1), [last.position.x, TEST_TREE_LEAF_Y, last.position.z]);
    const c = new THREE.Color(HEX[4]);
    const col = b.trunks.instanceColor!;
    for (const [k, want] of [c.r, c.g, c.b].entries()) {
        assert.ok(Math.abs(col.array[3 + k] - want) < 1e-6, `trunk color ${k}`);
    }
    const attrs = b.trunks.geometry.attributes;
    assert.equal(attrs.instanceAnimType.getX(1), ANIMATION_TYPES.VINE_SWAY, 'vine sway type moved');
    assert.equal(attrs.instanceAnimOffset.getX(1), 4 * 0.5, 'anim offset moved');

    // The moved tree's handles still resolve: removing it frees its slots, not another tree's.
    b.removeInstance(last);
    updateInstancedBatchers(ctx);
    assert.equal(b.trunks.count, 3);
    const xs = [0, 1, 2].map((s) => translationAt(b.trunks, s)[0]).sort((x, y) => x - y);
    assert.deepEqual(xs, [trees[0], trees[2], trees[3]].map((t) => t.position.x));
    b.dispose();
});

test('a full part drops the sub-mesh: add returns null and the drop is counted', () => {
    const b = new TreeBatcher(2);
    spawn(b, 0);
    spawn(b, 1);
    const extra = spawn(b, 2);
    assert.equal(b.trunks.count, 2);
    assert.equal(b.dropped, 2, 'trunk and leaf ball of the third tree');
    assert.equal(b.parts.trunks.add({ matrix: new Float32Array(16), r: 0, g: 0, b: 0, animType: 0, animOffset: 0 }), null);
    // Removing a tree that got no slots is a no-op.
    b.removeInstance(extra);
    assert.equal(b.trunks.count, 2);
    b.dispose();
});

test('dispose then re-init refills the same part batchers', () => {
    const b = new TreeBatcher(8);
    spawn(b, 0);
    b.dispose();
    assert.equal(b.initialized, false);
    spawn(b, 1);
    assert.equal(b.trunks.count, 1);
    assert.equal(b.trunks.parent !== null, true);
    b.dispose();
});
