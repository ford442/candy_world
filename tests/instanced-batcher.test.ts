/**
 * InstancedBatcher base (#2108, extended in #2166): slots, linked meshes,
 * registered attributes, dirty-range uploads, keyed removal, LOD and dispose.
 *
 * Run: npm run test:batchers
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import * as THREE from 'three';
import {
    InstancedBatcher,
    addMergedRange,
    liveInstancedBatchers,
    updateInstancedBatchers,
} from '../src/core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../src/core/scheduler/types.ts';

const ctx = { dt: 0.016, rawDt: 0.016, time: 1 } as unknown as FrameContext;

interface Rec {
    p: THREE.Vector3;
    tag: number;
}

class FakeBatcher extends InstancedBatcher<Rec> {
    stem!: THREE.InstancedMesh;
    params!: THREE.InstancedBufferAttribute;
    lods: number[] = [];
    steps = 0;
    swaps: [number, number][] = [];

    constructor(capacity = 8, ranged = false) {
        super('fake-batcher', 'animate', capacity);
        this.rangedUploads = ranged;
    }

    protected createMesh(capacity: number) {
        const top = new THREE.InstancedMesh(
            new THREE.BoxGeometry(),
            new THREE.MeshBasicMaterial(),
            capacity
        );
        top.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this.stem = this.linkMesh(
            new THREE.InstancedMesh(
                new THREE.BoxGeometry(),
                new THREE.MeshBasicMaterial(),
                capacity
            )
        );
        this.params = this.registerAttribute(
            new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2)
        );
        top.geometry.setAttribute('instanceParams', this.params);
        new THREE.Group().add(top, this.stem);
        return top;
    }

    protected writeRecord(r: Rec, slot: number, array: Float32Array) {
        array[slot * 16 + 12] = r.p.x;
        array[slot * 16 + 13] = r.p.y;
        array[slot * 16 + 14] = r.p.z;
        this.stem.instanceMatrix.array[slot * 16 + 12] = r.p.x;
        this.params.setXY(slot, r.tag, r.tag * 10);
        this.mesh!.instanceColor!.setXYZ(slot, r.tag, 0, 0);
    }

    protected onSwap(from: number, to: number) {
        this.swaps.push([from, to]);
    }

    protected onLod(f: number) {
        this.lods.push(f);
    }

    protected step() {
        this.steps++;
    }

    touch(slot: number) {
        this.markSlotDirty(slot);
    }
}

const rec = (tag: number): Rec => ({ p: new THREE.Vector3(tag, tag + 0.5, -tag), tag });

test('add and remove keep mesh.count equal to the live count on every mesh', () => {
    const b = new FakeBatcher();
    const h1 = b.add(rec(1))!;
    const h2 = b.add(rec(2))!;
    assert.equal(h1, 1);
    assert.equal(h2, 2);
    assert.equal(b.mesh!.count, 2, 'primary mesh count (was never set on add before #2166)');
    assert.equal(b.stem.count, 2, 'linked mesh count');

    b.remove(h1);
    assert.equal(b.mesh!.count, 1);
    assert.equal(b.stem.count, 1);
    assert.equal(b.mesh!.instanceMatrix.array[12], 2, 'slot 0 now holds record 2');
    assert.equal(b.stem.instanceMatrix.array[12], 2, 'linked mesh swapped too');
    assert.equal(b.params.getX(0), 2, 'registered attribute swapped');
    assert.equal(b.mesh!.instanceColor!.getX(0), 2, 'instanceColor swapped');
    assert.deepEqual(b.swaps, [[1, 0]]);
});

test('removing the last slot does not swap; unknown handles are ignored', () => {
    const b = new FakeBatcher();
    b.add(rec(1));
    const h2 = b.add(rec(2))!;
    b.remove(h2);
    b.remove(h2);
    b.remove(999);
    assert.equal(b.instanceCount, 1);
    assert.deepEqual(b.swaps, []);
});

test('add past capacity returns null and allocates nothing new', () => {
    const b = new FakeBatcher(3);
    for (let i = 0; i < 3; i++) assert.notEqual(b.add(rec(i)), null);
    const mesh = b.mesh;
    const matrix = b.mesh!.instanceMatrix;
    assert.equal(b.add(rec(9)), null);
    assert.equal(b.mesh, mesh, 'no new InstancedMesh on a full add');
    assert.equal(b.mesh!.instanceMatrix, matrix);
    assert.equal(b.instanceCount, 3);
});

test('keyed add/remove: a repeated key is one instance; removeKeyed finds it after swaps', () => {
    const b = new FakeBatcher();
    assert.equal(b.addKeyed(10, rec(1)), b.addKeyed(10, rec(1)));
    b.addKeyed(20, rec(2));
    b.addKeyed(30, rec(3));
    assert.equal(b.instanceCount, 3);
    assert.ok(b.removeKeyed(10));
    assert.equal(b.slotOfKey(30), 0, 'key 30 moved into the hole');
    assert.ok(!b.removeKeyed(10));
    assert.ok(b.removeKeyed(30));
    assert.equal(b.recordAt(0)!.tag, 2);
    assert.equal(b.instanceCount, 1);
});

test('a key removed by handle can be added again', () => {
    const b = new FakeBatcher();
    const h = b.addKeyed(7, rec(1))!;
    b.remove(h);
    assert.notEqual(b.addKeyed(7, rec(2)), null);
    assert.equal(b.instanceCount, 1);
    assert.equal(b.recordAt(0)!.tag, 2);
});

test('the culling sphere is dropped whenever the instance set changes', () => {
    const b = new FakeBatcher();
    b.add(rec(1));
    b.mesh!.computeBoundingSphere();
    b.flush();
    assert.equal(b.mesh!.boundingSphere, null, 'after add');
    b.mesh!.computeBoundingSphere();
    b.flush();
    assert.notEqual(b.mesh!.boundingSphere, null, 'unchanged set keeps it');
});

test('update() runs step then uploads every stream once', () => {
    const b = new FakeBatcher();
    b.add(rec(1));
    const versions = () => [
        b.mesh!.instanceMatrix.version,
        b.stem.instanceMatrix.version,
        b.mesh!.instanceColor!.version,
        b.params.version,
    ];
    const before = versions();
    b.update(ctx);
    assert.equal(b.steps, 1);
    assert.deepEqual(
        versions(),
        before.map((v) => v + 1)
    );
    b.update(ctx);
    assert.deepEqual(
        versions(),
        before.map((v) => v + 1),
        'nothing dirty, nothing uploaded'
    );
});

test('ranged uploads cover only the dirty slots and merge adjacent flushes', () => {
    const b = new FakeBatcher(16, true);
    for (let i = 0; i < 6; i++) b.add(rec(i));
    b.update(ctx);
    b.mesh!.instanceMatrix.clearUpdateRanges();
    b.params.clearUpdateRanges();

    b.touch(3);
    b.flush();
    b.touch(4);
    b.flush();
    assert.deepEqual(b.mesh!.instanceMatrix.updateRanges, [{ start: 48, count: 32 }]);
    assert.deepEqual(b.params.updateRanges, [{ start: 6, count: 4 }]);
});

test('addMergedRange merges touching ranges and collapses a long list', () => {
    const a = new THREE.BufferAttribute(new Float32Array(1000), 1);
    addMergedRange(a, 0, 10);
    addMergedRange(a, 10, 5);
    assert.deepEqual(a.updateRanges, [{ start: 0, count: 15 }]);
    for (let i = 0; i < 20; i++) addMergedRange(a, 100 + i * 20, 2);
    assert.ok(a.updateRanges.length <= 16);
    const end = Math.max(...a.updateRanges.map((r) => r.start + r.count));
    assert.equal(end, 100 + 19 * 20 + 2);
});

test('setLod calls onLod only when the clamped factor changes', () => {
    const b = new FakeBatcher();
    b.setLod(0.5);
    b.setLod(0.5);
    b.setLod(2);
    assert.deepEqual(b.lods, [0.5, 1]);
    assert.equal(b.lod, 1);
});

test('dispose frees every mesh, geometry, material and detaches; the batcher refills', () => {
    const b = new FakeBatcher();
    b.add(rec(1));
    const meshes = b.meshes;
    const disposed: string[] = [];
    for (const m of meshes) {
        m.addEventListener('dispose', () => disposed.push('mesh'));
        m.geometry.addEventListener('dispose', () => disposed.push('geometry'));
        (m.material as THREE.Material).addEventListener('dispose', () => disposed.push('material'));
    }
    b.dispose();
    assert.deepEqual(disposed.sort(), [
        'geometry',
        'geometry',
        'material',
        'material',
        'mesh',
        'mesh',
    ]);
    assert.ok(
        meshes.every((m) => m.parent === null),
        'meshes detached'
    );
    assert.equal(b.mesh, null);
    assert.equal(b.instanceCount, 0);
    b.add(rec(2));
    assert.equal(b.meshes.length, 2, 'createMesh relinks on refill');
    assert.equal(b.mesh!.count, 1);
});

test('a shared material (userData.preventMaterialDispose) survives dispose', () => {
    const b = new FakeBatcher();
    b.add(rec(1));
    b.mesh!.userData.preventMaterialDispose = true;
    let freed = false;
    (b.mesh!.material as THREE.Material).addEventListener('dispose', () => (freed = true));
    b.dispose();
    assert.equal(freed, false);
});

test('updateInstancedBatchers drives every live batcher', () => {
    const b = new FakeBatcher();
    assert.ok(liveInstancedBatchers().includes(b));
    updateInstancedBatchers(ctx);
    assert.equal(b.steps, 1);
});
