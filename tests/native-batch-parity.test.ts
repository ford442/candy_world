import assert from 'node:assert';
import { suite, test } from 'node:test';
import * as THREE from 'three';
import * as fs from 'fs';
import { flowerBatcher } from '../src/foliage/flower-batcher.ts';
import { TreeBatcher } from '../src/foliage/tree-batcher/tree-batcher-class.ts';
import { getDayNightBias } from '../src/core/cycle.ts';
import { MRState } from '../src/systems/music-reactivity-core.ts';

suite('InstancedBatcher Parity tests', () => {
    test('flowerBatcher matrix parity', () => {
        const fixture = JSON.parse(fs.readFileSync('tests/fixtures/flower.json', 'utf8'));

        const dummy = new THREE.Object3D();
        dummy.position.set(10, 20, 30);
        dummy.quaternion.identity();
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrixWorld(true);

        flowerBatcher.init();
        flowerBatcher.multiCount = 0;
        flowerBatcher.stems.count = 0;

        flowerBatcher.register(dummy, 'multiCount', new THREE.Color(1, 0, 0));
        flowerBatcher.updateInternal(1000, 16, { kick: 0.5, channels: { kick: { intensity: 0.5 } }, kickTrigger: 0.5 }, getDayNightBias(1000));

        assert.strictEqual(flowerBatcher.multiCount, fixture.count);
        assert.deepStrictEqual(Array.from(flowerBatcher.petalsMulti.instanceMatrix.array).slice(0, 16), fixture.instanceMatrix);
    });

    test('TreeBatcher matrix parity', () => {
        const fixture = JSON.parse(fs.readFileSync('tests/fixtures/tree.json', 'utf8'));

        const dummy = new THREE.Group();
        dummy.position.set(20, 0, 20);
        dummy.userData.animationType = 'gentleSway';
        dummy.updateMatrixWorld(true);

        const batcher = new TreeBatcher();
        batcher.init();
        batcher.register(dummy, 'tree');

        assert.strictEqual(batcher.trunkCount, fixture.trunkCount);
        assert.deepStrictEqual(Array.from(batcher.trunks.instanceMatrix.array).slice(0, 16), fixture.instanceMatrix);
    });
});
