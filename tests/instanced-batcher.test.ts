import { test } from 'node:test';
import * as assert from 'node:assert';
import * as THREE from 'three';
import { InstancedBatcher } from '../src/core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../src/core/scheduler/types.ts';

class FakeBatcher extends InstancedBatcher<THREE.Vector3> {
    constructor(id = 'fake-batcher') {
        super(id, 'animate');
    }

    createMesh(capacity: number) {
        return new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), capacity);
    }

    writeRecord(record: THREE.Vector3, slot: number, array: Float32Array) {
        array[slot * 16 + 12] = record.x;
        array[slot * 16 + 13] = record.y;
        array[slot * 16 + 14] = record.z;
    }

    step(ctx: FrameContext) {
        // no-op
    }
}

test('adds and removes records', () => {
    const batcher = new FakeBatcher();
    const handle1 = batcher.add(new THREE.Vector3(1, 2, 3));
    const handle2 = batcher.add(new THREE.Vector3(4, 5, 6));

    assert.equal(handle1, 1);
    assert.equal(handle2, 2);

    const ctx = { rawDt: 0.1 } as any;
    batcher.update(ctx); // Flushes dirty matrix

    const mesh = batcher.mesh!;
    assert.equal(mesh.instanceMatrix.array[12], 1);
    assert.equal(mesh.instanceMatrix.array[16 + 12], 4);

    batcher.remove(handle1!);

    batcher.update(ctx);

    assert.equal(mesh.instanceMatrix.array[12], 4); // slot 0 now has record 2's data
});
