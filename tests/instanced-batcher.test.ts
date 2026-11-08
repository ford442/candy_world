import assert from 'node:assert';
import { suite, test } from 'node:test';
import * as THREE from 'three';
import { InstancedBatcher } from '../src/core/batcher/instanced-batcher.ts';
import { flowerBatcher } from '../src/foliage/flower-batcher.ts';
import { TreeBatcher } from '../src/foliage/tree-batcher/tree-batcher-class.ts';

suite('InstancedBatcher Base Migration', () => {
    test('flowerBatcher extends InstancedBatcher', () => {
        assert.strictEqual(flowerBatcher instanceof InstancedBatcher, true);
        assert.strictEqual(typeof flowerBatcher.id, 'string');
        assert.strictEqual(flowerBatcher.phase, 'animate');
    });

    test('TreeBatcher extends InstancedBatcher', () => {
        const treeBatcher = new TreeBatcher();
        assert.strictEqual(treeBatcher instanceof InstancedBatcher, true);
        assert.strictEqual(typeof treeBatcher.id, 'string');
        assert.strictEqual(treeBatcher.phase, 'animate');
    });
});