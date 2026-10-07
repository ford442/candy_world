import * as THREE from 'three';
import assert from 'node:assert';

// Mocks to allow module imports to succeed without full DOM/WebGPU
global.window = {};
global.document = {
    createElement: () => ({ style: {} }),
};
global.performance = { now: () => Date.now() };
global.foliageGroup = new THREE.Group();

import { ChunkStreamer } from '../src/world/chunk-streamer.ts';
import { gemFruitBatcher } from '../src/foliage/gem-fruit-batcher.ts';
import { waterfallBatcher } from '../src/foliage/waterfall-batcher.ts';
import { sugarCaveBatcher } from '../src/foliage/sugar-cave-batcher.ts';
import { CloudBatcher } from '../src/foliage/cloud-batcher.ts';
import { FaunaBatcher } from '../src/foliage/fauna-batcher.ts';
import { despawnEntity } from '../src/world/entity-despawn.ts';
import { foliageCaves } from '../src/systems/physics/physics-types.ts';
import { luminousPlantBatcher } from '../src/foliage/luminous-plant-batcher.ts';
import { subwooferLotusBatcher } from '../src/foliage/subwoofer-lotus-batcher.ts';
import { dandelionBatcher } from '../src/foliage/dandelion-batcher.ts';
import { waterfallBatcher } from '../src/foliage/waterfall-batcher.ts';
import { CloudBatcher } from '../src/foliage/cloud-batcher.ts';
import { FaunaBatcher } from '../src/foliage/fauna-batcher.ts';
import { FaunaSpecies } from '../src/systems/fauna/types.ts';
import { CandyDebrisBatcher } from '../src/foliage/candy-debris-batcher.ts';
import { waterfallBatcher } from '../src/foliage/waterfall-batcher.ts';

import { optimizedDiscovery } from '../src/systems/discovery-optimized.ts';

optimizedDiscovery.registerObject = () => {};

// Test runner function
async function runTests() {
    console.log('🍬 Candy World Streamer Evict Parity Test');
    console.log('=========================================\n');
    let passed = 0;

    try {
        console.log('--- 1. Testing ChunkStreamer Load -> Stream Out ---');

        // Mock LoadedCandyMap
        const mockMap = {
            cells: new Map(),
            getEntitiesInBounds: () => { return []; }
        };

        // Create a mock cell with entities
        const cell = {
            entities: [
                { type: 'luminous_plant', id: 'lp1', translation: [0, 0, 0] },
                { type: 'subwoofer_lotus', id: 'sl1', translation: [1, 0, 1] },
                { type: 'dandelion', id: 'd1', translation: [2, 0, 2] },
                { type: 'cloud', id: 'c1', translation: [2, 10, 2], isBatched: true },
                { type: 'fauna', id: 'f1', translation: [3, 0, 2], isBatched: true },
                { type: 'candy_debris', id: 'cd1', translation: [4, 0, 2], isBatched: true },

                { type: 'gem_canopy_tree', id: 'gt1', translation: [3, 0, 3] },
                { type: 'unknown_batched', id: 'u1', translation: [4, 0, 4], isBatched: true },
            ]
        };
        mockMap.cells.set('0,0', cell);

        const weatherSystem = {
            registerCave: () => {},
            unregisterCave: () => {},
        };

        // Let's hook into the global scope config correctly if needed, or simply let the code run.
        const streamer = new ChunkStreamer(mockMap, weatherSystem, null, {
            chunkSize: 10,
            evictRingChunks: 1,
        });

        // We bypass the id checking and directly call load cell
        const record = streamer['recordFor']('0,0');
        for (const entity of cell.entities) {
             const obj = new THREE.Object3D();
             obj.userData = { type: entity.type, isBatched: entity.isBatched };
             obj.position.set(...entity.translation);
             obj.uuid = entity.id; // give distinct uuid

             if (entity.type === 'gem_canopy_tree') {
                  gemFruitBatcher.attachToTree(obj, { gemCount: 3 });
             } else if (entity.type === 'luminous_plant') {
                  luminousPlantBatcher.register(obj);
             } else if (entity.type === 'subwoofer_lotus') {
                  subwooferLotusBatcher.register(obj);
             } else if (entity.type === 'dandelion') {
                  dandelionBatcher.register(obj);
             } else if (entity.type === 'cloud') {
                  CloudBatcher.getInstance().register(obj);
             } else if (entity.type === 'fauna') {
                  FaunaBatcher.getInstance().init();
                  obj.userData.faunaSpecies = FaunaSpecies.SugarMoth;
                  obj.userData.slot = FaunaBatcher.getInstance().addInstance(FaunaSpecies.SugarMoth, 3, 0, 2, 'global', 0, 0);
             } else if (entity.type === 'candy_debris') {
                 // Debris despawns itself via lifetime, so just registering it to test classification
                 // Force peekMesh to return something by initiating a burst
                 CandyDebrisBatcher.getInstance().burst({ count: 1, origin: new THREE.Vector3() });
             } else if (entity.type === 'unknown_batched') {
                  // no batcher hook up for unknown
             }

             streamer['trackSpawnedObject'](obj, record);
        }

        assert.equal(record.evictable.length, 7, '7 entities should be evictable');
        assert.equal(record.permanentCount, 1, '1 unknown_batched entity should be permanent');

        // Capture lengths before eviction
        const lpInitialCount = luminousPlantBatcher.count;
        const slInitialCount = subwooferLotusBatcher['_count'];
        const danInitialCount = dandelionBatcher.count;
        const cbInitialCount = CloudBatcher.getInstance().count;
        const fbInitialCount = FaunaBatcher.getInstance().getTotalCount();

        // Move far away to force eviction of 0,0
        streamer['evictFarChunks'](100, 100, 1);

        assert.equal(record.evictable.length, 0, 'Evictable array should be cleared after eviction');

        assert.equal(luminousPlantBatcher.count, lpInitialCount - 1, 'Luminous plant should be evicted');
        assert.equal(subwooferLotusBatcher['_count'], slInitialCount - 1, 'Subwoofer lotus should be evicted');
        assert.equal(dandelionBatcher.count, danInitialCount - 1, 'Dandelion should be evicted');
        // A cloud registers 'puffCount' puffs (between 12 and 19), so it won't be exactly -1.
        // It should be cbInitialCount - puffCount, meaning < cbInitialCount.
        // We just assert it is smaller.
        assert.ok(CloudBatcher.getInstance().count < cbInitialCount, 'Cloud should be evicted');
        assert.equal(FaunaBatcher.getInstance().getTotalCount(), fbInitialCount - 1, 'Fauna should be evicted');

        // Ensure unknown batched didn't crash and is still in records because permanentCount > 0
        const retainedRecord = streamer['records'].get('0,0');
        assert.ok(retainedRecord, 'Chunk record should be retained for permanent objects');
        assert.equal(retainedRecord.permanentCount, 1, 'Permanent count should still be 1');

        console.log('  ✓ ChunkStreamer load and out-of-range stream-out works without growing matrices');
        passed++;

        console.log('--- 2. Testing Subwoofer Lotus Swap-With-Last Edge Cases ---');

        const lotusProxy1 = new THREE.Object3D();
        const lotusProxy2 = new THREE.Object3D();

        subwooferLotusBatcher.register(lotusProxy1);
        subwooferLotusBatcher.register(lotusProxy2);

        const group1 = lotusProxy1.userData.interactiveGroup;
        const group2 = lotusProxy2.userData.interactiveGroup;

        assert.ok(group1.parent !== null, 'Group 1 should be in the scene');
        assert.ok(group2.parent !== null, 'Group 2 should be in the scene');

        subwooferLotusBatcher.removeInstance(lotusProxy1);

        assert.ok(group1.parent === null, 'Group 1 should be removed from the scene');
        assert.ok(group2.parent !== null, 'Group 2 should still be in the scene (survivor)');
        assert.strictEqual(subwooferLotusBatcher.logicObjects[0], group2, 'logicObjects[0] must be the old second group');

        console.log('  ✓ SubwooferLotus swap-with-last works cleanly');
        passed++;




        console.log('--- 3. Testing classifyForEviction guard ---');
        // If classifyForEviction returns 'never' for a known batched type, it's a bug that leaks memory.
        const typesToTest = [
            'tree', 'shrub', 'willow', 'balloonBush', 'helixPlant', 'accordion_palm', 'floweringTree',
            'bubbleWillow', 'prismRoseBush', 'helix', 'accordionPalm',
            'gem_canopy_tree', 'mushroom', 'lanternFlower', 'glass_mushroom',
            'flower', 'simple_flower', 'fern', 'arpeggio_fern', 'cave',
            'kick_drum_geyser', 'luminous_plant', 'dandelion', 'waterfall',
            'subwoofer_lotus', 'glowing_flower', 'sugar_cave', 'night_market_stall'
        ];

        let neverFailures = 0;

        // Expose a way to test classifyForEviction. We can spawn an entity and check the record's evictable length vs permanentCount.
        for (const t of typesToTest) {
            const obj = new THREE.Object3D();
            obj.userData = { type: t, isBatched: true };

            // Bypass full streamer spawnEntity mapping by calling a private test function or using streamer internals
            // Or we can just mock a chunk load.
            const chunkKey = '100,100';
            const cellMock = {
                entities: [
                    { type: t, id: 'test_obj', translation: [1000, 0, 1000], isBatched: true }
                ]
            };
            const mockMap2 = { cells: new Map() };
            mockMap2.cells.set(chunkKey, cellMock);

            const streamer2 = new ChunkStreamer(mockMap2, weatherSystem, null, {
                chunkSize: 10,
                evictRingChunks: 1,
            });

            const record2 = streamer2['recordFor'](chunkKey);
            streamer2['trackSpawnedObject'](obj, record2);

            if (record2.permanentCount > 0) {
                console.error(`❌ classifyForEviction returned 'never' for ${t}!`);
                neverFailures++;
            }
        }

        assert.equal(neverFailures, 0, 'No listed batched types should return never');
        console.log('  ✓ classifyForEviction handles all known types correctly');
        passed++;

        // 8. Cave
        const caveId = THREE.MathUtils.generateUUID();
        const caveObj = new THREE.Group();
        caveObj.uuid = caveId;
        caveObj.userData.type = 'cave';
        caveObj.userData.caveLightHandle = 'cave_light_123';
        caveObj.userData.waterfallActive = true;

        foliageCaves.push(caveObj);

        // create a fake weather system for test
        const trackedCaves = [caveObj];
        const fakeWeatherSystem = {
            unregisterCave: (c) => {
                const idx = trackedCaves.indexOf(c);
                if (idx !== -1) trackedCaves.splice(idx, 1);
            }
        };


        waterfallBatcher.add(caveId, new THREE.Vector3(), 5, 2);

        assert.equal(foliageCaves.length, 1, 'Cave should be in foliageCaves');
        assert.equal(trackedCaves.length, 1, 'Cave should be in trackedCaves');

        despawnEntity(caveObj, fakeWeatherSystem);

        assert.equal(foliageCaves.length, 0, 'Cave should be removed from foliageCaves');
        assert.equal(trackedCaves.length, 0, 'Cave should be removed from trackedCaves');
        // Waterfall count might not be 0 since the previous test adds/removes but let's check
        // wait, we removed waterfall above so count was 0, now we add 1, then despawnEntity removes it.
        assert.equal(waterfallBatcher.count, 0, 'Cave waterfall should be removed from batcher');
        assert.equal(caveObj.userData.waterfallActive, false, 'waterfallActive should be false');

        console.log('  ✓ Cave despawn path successful');
        passed++;

        // 8. CloudBatcher
        const cloudObj1 = new THREE.Object3D();
        const cloudObj2 = new THREE.Object3D();
        const cloudBatcher = CloudBatcher.getInstance();
        cloudBatcher.init();
        cloudBatcher.register(cloudObj1, { puffCount: 5 });
        cloudBatcher.register(cloudObj2, { puffCount: 5 });

        assert.equal(cloudBatcher.clouds.length, 2, 'Cloud should have 2 logical counts');
        assert.equal(cloudBatcher.count, 10, 'Cloud should have 10 puff counts');

        cloudBatcher.removeInstance(cloudObj1);
        assert.equal(cloudBatcher.clouds.length, 1, 'Cloud should have 1 logical count after remove');
        assert.equal(cloudBatcher.count, 5, 'Cloud should have 5 puff counts after remove');
        assert.equal(cloudObj2.userData.batchStart, 0, 'Swapped Cloud batchStart updated');
        console.log('  ✓ CloudBatcher removeInstance successful');
        passed++;

        // 9. FaunaBatcher
        const faunaObj1 = new THREE.Object3D();
        const faunaObj2 = new THREE.Object3D();
        const faunaBatcher = FaunaBatcher.getInstance();
        faunaBatcher.init();

        const fIdx1 = faunaBatcher.addInstance(0, 0, 0, 0, 'global', 0, 0);
        faunaObj1.userData.faunaSpecies = 0;
        faunaObj1.userData.faunaSlot = 0;

        const fIdx2 = faunaBatcher.addInstance(0, 0, 0, 0, 'global', 0, 1);
        faunaObj2.userData.faunaSpecies = 0;
        faunaObj2.userData.faunaSlot = 1;

        assert.equal(faunaBatcher.getTotalCount(), 2, 'Fauna should have 2 counts');

        faunaBatcher.removeInstance(faunaObj1);
        assert.equal(faunaBatcher.getTotalCount(), 1, 'Fauna should have 1 count after swap');
        assert.equal(faunaBatcher['_species'][0].slotToInstance.get(1), 0, 'Swapped Fauna index updated');
        console.log('  ✓ FaunaBatcher swap-with-last successful');
        passed++;

    } catch (err) {
        console.error('❌ Test failed!', err);
        process.exit(1);
    }

    console.log(`\n✅ All ${passed} tests passed!`);
}

runTests();
