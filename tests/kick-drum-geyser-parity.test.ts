import { test } from 'node:test';
import * as assert from 'node:assert';
import * as THREE from 'three';
import { KickDrumGeyserBatcher as OldBatcher } from '../src/foliage/kick-drum-geyser-batcher.ts';

test('parity KickDrumGeyserBatcher adds correctly', () => {
    const oldB = new OldBatcher();

    const obj1 = new THREE.Object3D();
    obj1.position.set(1, 2, 3);

    const obj2 = new THREE.Object3D();
    obj2.position.set(4, 5, 6);

    oldB.register(obj1);
    oldB.register(obj2);

    assert.equal(oldB.baseMesh.count, 2);
});
