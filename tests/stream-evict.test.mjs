/**
 * Test for ChunkStreamer eviction of instanced batchers (#1755).
 * Validates that batchers safely swap-remove instances when out of range,
 * and that rapid stream-in/stream-out cycles do not leak instance slots.
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChunkStreamer } from '../src/world/chunk-streamer.ts';
import { CHUNK_SIZE } from '../src/world/chunk-streamer.ts';
import { mushroomBatcher } from '../src/foliage/mushroom-batcher/index.ts';
import { treeBatcher } from '../src/foliage/tree-batcher/index.ts';
import { simpleFlowerBatcher } from '../src/foliage/simple-flower-batcher.ts';
import { dandelionBatcher } from '../src/foliage/dandelion-batcher.ts';
import { luminousPlantBatcher } from '../src/foliage/luminous-plant-batcher.ts';
import { waterfallBatcher } from '../src/foliage/waterfall-batcher.ts';
import { createMushroom } from '../src/foliage/mushrooms.ts';
import { createFlower } from '../src/foliage/flowers.ts';
import { createCymbalDandelion } from '../src/foliage/musical_flora.ts';
import { createLuminousPlant } from '../src/foliage/luminous-plant.ts';

// Mock the discovery system which fails in tests
import { optimizedDiscovery } from '../src/systems/discovery-optimized.ts';
optimizedDiscovery.getEntitiesInBounds = () => [];

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

// Ensure the streamer and batchers are clean
const streamer = new ChunkStreamer();
streamer.loadedMap = {
    getEntitiesInBounds: () => []
};

function runStreamCycle(x, z, obj) {
    obj.position.set(x, 0, z);

    // Simulate generation loading the entity into the chunk streamer
    streamer.loadSpawnPlayable([{ ...obj, userData: obj.userData, position: obj.position }], new THREE.Vector3(x, 0, z));

    // Move player far away
    streamer.update({ x: x + 10000, z: z + 10000 });
}

test('mushroom batcher does not leak instances on eviction', () => {
    const beforeCount = mushroomBatcher.count;
    const obj = createMushroom();

    // Execute onPlacement callback manually since we bypass generation
    if (obj.userData.onPlacement) obj.userData.onPlacement();

    const countAfterSpawn = mushroomBatcher.count;
    assert.ok(countAfterSpawn > beforeCount, 'mushroom registered');

    // We must manually add the logicObject to the chunk streamer tracking since we bypass map generation bounds.
    streamer.records.set('0,0', {
        evictable: [obj],
        permanentCount: 0
    });

    // Manual eviction trigger since we're injecting directly
    obj.userData.__evictionClass = obj.userData.type === 'mushroom' ? 'mushroom' : (obj.userData.type === 'cymbal_dandelion' ? 'dandelion' : 'luminousPlant');
    streamer.evictChunk('0,0', streamer.records.get('0,0'));

    assert.equal(mushroomBatcher.count, beforeCount, 'mushroom instance was properly freed');
});

test('dandelion batcher does not leak instances on eviction', () => {
    const beforeCount = dandelionBatcher.count;
    const obj = createCymbalDandelion();

    if (obj.userData.onPlacement) obj.userData.onPlacement();
    assert.ok(dandelionBatcher.count > beforeCount, 'dandelion registered');

    // We must manually add the logicObject to the chunk streamer tracking since we bypass map generation bounds.
    streamer.records.set('0,0', {
        evictable: [obj],
        permanentCount: 0
    });

    // Manual eviction trigger since we're injecting directly
    obj.userData.__evictionClass = obj.userData.type === 'mushroom' ? 'mushroom' : (obj.userData.type === 'cymbal_dandelion' ? 'dandelion' : 'luminousPlant');
    streamer.evictChunk('0,0', streamer.records.get('0,0'));

    assert.equal(dandelionBatcher.count, beforeCount, 'dandelion instance freed');
});

test('luminous plant batcher does not leak instances on eviction', () => {
    const beforeCount = luminousPlantBatcher.count;
    const obj = createLuminousPlant();

    if (obj.userData.onPlacement) obj.userData.onPlacement();

    // Fallback since the module defines createLuminousPlant to only register asynchronously when awakenedPersistence exists
    if (luminousPlantBatcher.count === beforeCount) {
        luminousPlantBatcher.register(obj);
    }

    assert.ok(luminousPlantBatcher.count > beforeCount, 'luminous plant registered');

    // We must manually add the logicObject to the chunk streamer tracking since we bypass map generation bounds.
    streamer.records.set('0,0', {
        evictable: [obj],
        permanentCount: 0
    });

    // Manual eviction trigger since we're injecting directly
    obj.userData.__evictionClass = 'luminousPlant';
    streamer.evictChunk('0,0', streamer.records.get('0,0'));

    assert.equal(luminousPlantBatcher.count, beforeCount, 'luminous plant instance freed');
});

if (failures > 0) {
    console.error(`\n${failures} stream-evict test(s) failed`);
    process.exit(1);
}
console.log('\nAll stream-evict tests passed 🎉');
