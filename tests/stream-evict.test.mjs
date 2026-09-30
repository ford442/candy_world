// ChunkStreamer eviction parity (#1755 / #1759).
//
// Drives the production path — registry factory -> processMapEntity -> batcher
// register -> ChunkStreamer.trackSpawnedObject -> evictFarChunks -> despawnEntity —
// so a mis-tagged proxy (the old synthetic `type: 'dandelion'` never matched what
// createCymbalDandelion really stamps) or a batcher that leaks a slot fails here
// instead of on a long Play walk.
//
// What can fail:
//   1. classification   — every registered world-object type must classify to an exact,
//                         listed class; a new species with no listing fails loudly.
//   2. slot recovery    — after evict, each batcher's live count returns to its baseline,
//                         cycle after cycle (the load -> walk away -> return loop).
//   3. buffer stability — instanceMatrix.array is never reallocated across the loop.
//   4. ghosts           — caves / waterfalls / clouds leave no physics, weather or
//                         ground-platform registration behind.
import * as THREE from 'three';
import assert from 'node:assert';

// Mocks to allow module imports to succeed without full DOM/WebGPU
global.window = {
    location: { search: '', href: 'http://localhost/' },
    addEventListener() {},
    removeEventListener() {},
};
global.document = { createElement: () => ({ style: {} }) };
global.performance = { now: () => Date.now() };
// Streamed spawns start a dreamy pop-in animation; keep it inert so the run stays deterministic.
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

// Dynamic imports: static ones hoist above the globals above.
const { ChunkStreamer } = await import('../src/world/chunk-streamer.ts');
const { classifyForEviction, canDespawn } = await import('../src/world/entity-despawn.ts');
const { create, getRegisteredTypes, registerBuiltinWorldObjectTypes } =
    await import('../src/world/foliage-registry.ts');
const { safeAddFoliage } = await import('../src/world/generation-entities.ts');
const { animatedFoliage, foliageClouds } = await import('../src/world/state.ts');
const { foliageCaves } = await import('../src/systems/physics/physics-types.ts');
const { getPlatforms } = await import('../src/systems/ground-system.ts');
const { WeatherSystem } = await import('../src/systems/weather/weather.ts');
const { CloudBatcher } = await import('../src/foliage/cloud-batcher.ts');
const { updateCaveWaterLevel } = await import('../src/foliage/cave.ts');
const { dandelionBatcher } = await import('../src/foliage/dandelion-batcher.ts');
const { gemFruitBatcher } = await import('../src/foliage/gem-fruit-batcher.ts');
const { glowingFlowerBatcher } = await import('../src/foliage/glowing-flower-batcher.ts');
const { luminousPlantBatcher } = await import('../src/foliage/luminous-plant-batcher.ts');
const { subwooferLotusBatcher } = await import('../src/foliage/subwoofer-lotus-batcher.ts');
const { sugarCaveBatcher } = await import('../src/foliage/sugar-cave-batcher.ts');
const { waterfallBatcher } = await import('../src/foliage/waterfall-batcher.ts');
const { collectBatcherTelemetry, installBatcherTelemetry } =
    await import('../src/foliage/batcher-telemetry.ts');

registerBuiltinWorldObjectTypes();

const CHUNK_SIZE = 10;
const KEY = '0,0';
const N = 6; // instances per load
const CYCLES = 5; // load -> walk away -> return loops per species

// ---------------------------------------------------------------------------
// Weather stand-in: the real WeatherSystem registration methods bound to plain state,
// so eviction exercises the production unregister logic without booting weather.
// ---------------------------------------------------------------------------
function makeWeather() {
    const w = {
        trackedMushrooms: [],
        trackedCaves: [],
        mushroomWaterfalls: new Set(),
        registerTree() {},
        registerShrub() {},
    };
    for (const m of ['registerMushroom', 'unregisterMushroom', 'registerCave', 'unregisterCave']) {
        w[m] = WeatherSystem.prototype[m];
    }
    return w;
}

const weather = makeWeather();
const streamer = new ChunkStreamer(
    { cells: new Map(), getEntitiesInBounds: () => [], getEntityById: () => undefined },
    weather,
    null,
    { chunkSize: CHUNK_SIZE }
);

let idCounter = 0;
/** Spawn via the streamer's real spawnEntity -> processMapEntity path. Returns the tracked objects. */
function spawnEntity(type, extra = {}) {
    const record = streamer['recordFor'](KEY);
    const before = record.evictable.length + record.permanentCount;
    const i = idCounter++;
    streamer['spawnEntity'](
        { id: `e${i}`, type, position: [(i % 8) + 1, 0, Math.floor(i / 8) + 1], ...extra },
        record,
        true
    );
    return record.evictable.length + record.permanentCount - before;
}

function evictAll() {
    streamer['evictFarChunks'](100, 100, 1);
}

const record = () => streamer['recordFor'](KEY);

// ---------------------------------------------------------------------------
// 1. Classification: exact class for every registry type, no 'never', and no
//    'full' type that secretly owns a batcher slot.
// ---------------------------------------------------------------------------
const EXPECTED_CLASS = {
    mushroom: 'mushroom',
    flower: 'flower',
    cloud: 'cloud',
    subwoofer_lotus: 'subwooferLotus',
    accordion_palm: 'tree',
    fiber_optic_willow: 'tree',
    floating_orb: 'full',
    swingable_vine: 'full',
    vine_ladder: 'full',
    prism_rose_bush: 'flower',
    starflower: 'full',
    vibrato_violet: 'full',
    tremolo_tulip: 'full',
    kick_drum_geyser: 'kickDrumGeyser',
    arpeggio_fern: 'arpeggioFern',
    portamento_pine: 'portamentoPine',
    cymbal_dandelion: 'dandelion',
    snare_trap: 'full',
    retrigger_mushroom: 'full',
    panning_pad: 'full',
    silence_spirit: 'full',
    instrument_shrine: 'full',
    bubble_willow: 'tree',
    gem_canopy_tree: 'gemFruit',
    helix_plant: 'tree',
    balloon_bush: 'tree',
    wisteria_cluster: 'full',
    luminous_plant: 'luminousPlant',
    glass_mushroom: 'glassMushroom',
    sky_island: 'full',
    melody_mirror: 'full',
    cave: 'cave',
    night_market_stall: 'nightMarketStall',
};

function test1_classification() {
    console.log('--- 1. Every registered type classifies to its exact eviction class ---');
    const unlisted = [];
    const mismatches = [];
    const hiddenBatched = [];
    for (const type of getRegisteredTypes()) {
        const obj = create(type, {});
        assert.ok(obj, `factory for "${type}" returned null`);
        obj.userData.onPlacement?.();
        const cls = classifyForEviction(obj);
        if (!(type in EXPECTED_CLASS)) {
            unlisted.push(`${type} -> ${cls}`);
            continue;
        }
        if (cls !== EXPECTED_CLASS[type])
            mismatches.push(`${type}: got ${cls}, want ${EXPECTED_CLASS[type]}`);
        // A 'full' teardown frees no batcher slot, so a full-class object must not own one.
        if (cls === 'full') {
            const ud = obj.userData;
            if (ud.isBatched || ud.batchIndex !== undefined || ud.batchStart !== undefined) {
                hiddenBatched.push(type);
            }
        }
    }
    assert.deepEqual(
        unlisted,
        [],
        `new world-object type(s) need a removeInstance path, a classifyForEviction branch and an entry in EXPECTED_CLASS: ${unlisted}`
    );
    assert.deepEqual(mismatches, [], `misclassified: ${mismatches}`);
    assert.deepEqual(
        hiddenBatched,
        [],
        `'full' types that own a batcher slot (would leak it): ${hiddenBatched}`
    );
    assert.ok(
        !Object.values(EXPECTED_CLASS).includes('never'),
        "no registry type may rely on the 'never' safety net"
    );

    // The safety net itself: unknown + batched stays permanent, unknown + unbatched is torn down.
    const future = new THREE.Object3D();
    future.userData = { type: 'future_batched_species', isBatched: true };
    assert.equal(classifyForEviction(future), 'never');
    assert.equal(canDespawn(future), false);
    const plain = new THREE.Object3D();
    plain.userData = { type: 'future_plain_species' };
    assert.equal(classifyForEviction(plain), 'full');

    const proxies = [
        ['glowing_flower', { type: 'glowing_flower' }],
        ['sugar_cave', { type: 'sugar_cave' }],
        ['waterfall', { type: 'waterfall' }],
        ['dandelion (legacy tag)', { type: 'dandelion' }],
    ];
    for (const [name, ud] of proxies) {
        const o = new THREE.Object3D();
        o.userData = { ...ud, isBatched: true };
        assert.notEqual(
            classifyForEviction(o),
            'never',
            `${name} must not fall through to 'never'`
        );
        assert.notEqual(classifyForEviction(o), 'full', `${name} must not fall through to 'full'`);
    }
    console.log('  ✓ exact classes, no hidden batched "full" types, safety net intact');
}

// ---------------------------------------------------------------------------
// 2 + 3. load -> evict -> reload loops: count returns to baseline, buffers never grow.
// ---------------------------------------------------------------------------
const arraysOf = (...meshes) => meshes.filter(Boolean).map((m) => m.instanceMatrix.array);
const gemTotal = () => gemFruitBatcher['_counts'].reduce((a, b) => a + b, 0);
const cloudCount = () =>
    CloudBatcher.getInstance().count + CloudBatcher.getWalkableInstance().count;
const cloudArrays = () =>
    [CloudBatcher.getInstance(), CloudBatcher.getWalkableInstance()]
        .filter((b) => b.mesh)
        .map((b) => b.mesh.instanceMatrix.array);

const SPECIES = [
    {
        name: 'luminous_plant',
        cls: 'luminousPlant',
        deterministic: true,
        spawn: () => spawnEntity('luminous_plant'),
        live: () => luminousPlantBatcher.count,
        arrays: () => arraysOf(luminousPlantBatcher.mesh),
    },
    {
        name: 'subwoofer_lotus',
        cls: 'subwooferLotus',
        deterministic: true,
        spawn: () => spawnEntity('subwoofer_lotus'),
        live: () => subwooferLotusBatcher['_count'],
        arrays: () =>
            arraysOf(
                subwooferLotusBatcher.padMesh,
                subwooferLotusBatcher.ringsMesh,
                subwooferLotusBatcher.centerMesh
            ),
    },
    {
        // Production tags this type 'flower'; only animationType 'batchedCymbal' routes it here.
        name: 'cymbal_dandelion',
        cls: 'dandelion',
        deterministic: true,
        spawn: () => spawnEntity('cymbal_dandelion'),
        live: () => dandelionBatcher.count,
        arrays: () => arraysOf(dandelionBatcher.mesh),
    },
    {
        name: 'gem_canopy_tree',
        cls: 'gemFruit',
        spawn: () => spawnEntity('gem_canopy_tree'),
        live: () => gemTotal(),
        arrays: () => arraysOf(...gemFruitBatcher.meshes),
    },
    {
        name: 'cloud (walkable tier 1)',
        cls: 'cloud',
        spawn: () => spawnEntity('cloud', { tier: 1 }),
        live: cloudCount,
        arrays: cloudArrays,
    },
    {
        name: 'cloud (decorative tier 2)',
        cls: 'cloud',
        spawn: () => spawnEntity('cloud', { tier: 2 }),
        live: cloudCount,
        arrays: cloudArrays,
    },
];

function test2_slotRecovery() {
    console.log('--- 2. Load -> evict -> reload keeps live counts and buffers flat ---');
    for (const sp of SPECIES) {
        // Warm-up so lazily created meshes exist and the baseline / buffer identity is fixed.
        sp.spawn();
        evictAll();
        const base = sp.live();
        const buffers = sp.arrays();
        assert.ok(buffers.length > 0, `${sp.name}: no instance buffers found`);
        const lengths = buffers.map((b) => b.length);

        let peak = -1;
        for (let cycle = 0; cycle < CYCLES; cycle++) {
            let tracked = 0;
            for (let i = 0; i < N; i++) tracked += sp.spawn();
            const rec = record();
            assert.equal(
                rec.permanentCount,
                0,
                `${sp.name}: spawned objects must all be evictable`
            );
            assert.ok(tracked >= N, `${sp.name}: expected >= ${N} tracked objects, got ${tracked}`);
            for (const obj of rec.evictable) {
                assert.equal(
                    obj.userData.__evictionClass,
                    obj.userData.type === 'waterfall' ? 'waterfall' : sp.cls,
                    `${sp.name}: tracked as ${obj.userData.__evictionClass}`
                );
            }
            const loaded = sp.live();
            assert.ok(
                loaded > base,
                `${sp.name}: load did not register any instances (${loaded} vs ${base})`
            );
            // Gem and puff counts are randomised per entity, so only fixed-size species must refill exactly.
            if (peak >= 0 && sp.deterministic) {
                assert.equal(
                    loaded,
                    peak,
                    `${sp.name}: reload should refill the same slots (${loaded} vs ${peak})`
                );
            }
            peak = loaded;

            evictAll();
            assert.equal(record().evictable.length, 0, `${sp.name}: evictable not cleared`);
            assert.equal(
                sp.live(),
                base,
                `${sp.name}: cycle ${cycle}: count stuck at ${sp.live()} (baseline ${base})`
            );
            const after = sp.arrays();
            after.forEach((b, i) => {
                assert.strictEqual(
                    b,
                    buffers[i],
                    `${sp.name}: instanceMatrix.array was reallocated`
                );
                assert.equal(
                    b.length,
                    lengths[i],
                    `${sp.name}: instanceMatrix.array length changed`
                );
            });
        }
        console.log(`  ✓ ${sp.name}: baseline ${base}, peak ${peak}, ${CYCLES} cycles flat`);
    }
}

// ---------------------------------------------------------------------------
// 4. Ghosts: clouds, caves + rain-fed waterfalls, giant-mushroom waterfalls.
// ---------------------------------------------------------------------------
function test3_ghosts() {
    console.log('--- 3. Eviction leaves no ground / physics / weather ghosts ---');

    // Clouds: puff runs compact, walkable platforms are released.
    const platformsBefore = getPlatforms().length;
    const cloudsBefore = foliageClouds.length;
    const baseCloudBatcherCloudCount =
        CloudBatcher.getInstance().clouds.length + CloudBatcher.getWalkableInstance().clouds.length;
    for (let i = 0; i < 4; i++) spawnEntity('cloud', { tier: 1 });
    spawnEntity('cloud', { tier: 2 });
    assert.ok(
        getPlatforms().length > platformsBefore,
        'walkable clouds should register ground platforms'
    );
    // Keep the two LAST walkable clouds in the chunk the player is standing in (evictFarChunks(100, 100, 1)
    // spares it): their puff runs sit after the freed ones, so compaction has to slide them down.
    const survivorRecord = streamer['recordFor']('100,100');
    const savedRecord = streamer['records'].get(KEY);
    const survivors = savedRecord.evictable.filter((o) => o.userData.isWalkable).slice(-2);
    assert.equal(survivors.length, 2);
    const puffRows = (cloud) => {
        const { batchStart, batchCount } = cloud.userData;
        const mesh = CloudBatcher.getWalkableInstance().mesh;
        return Array.from(
            mesh.instanceMatrix.array.subarray(batchStart * 16, (batchStart + batchCount) * 16)
        );
    };
    const rowsBefore = survivors.map(puffRows);
    const startsBefore = survivors.map((o) => o.userData.batchStart);
    savedRecord.evictable = savedRecord.evictable.filter((o) => !survivors.includes(o));
    survivorRecord.evictable.push(...survivors);
    evictAll();
    survivors.forEach((s, i) => {
        const b = CloudBatcher.getWalkableInstance();
        assert.ok(b.clouds.includes(s), 'survivor cloud must stay registered');
        assert.ok(
            s.userData.batchStart < startsBefore[i],
            'survivor run must slide down over the freed runs'
        );
        assert.ok(
            s.userData.batchStart >= 0 && s.userData.batchStart + s.userData.batchCount <= b.count,
            'survivor cloud run must stay inside the live range after compaction'
        );
        assert.deepEqual(
            puffRows(s),
            rowsBefore[i],
            'survivor puff transforms must move intact with their run'
        );
        const walk = b.isWalkableAttribute.array;
        for (let k = 0; k < s.userData.batchCount; k++) {
            assert.equal(walk[s.userData.batchStart + k], 1, 'aIsWalkable must move with the run');
        }
    });
    // Now evict the survivors too.
    streamer['evictFarChunks'](500, 500, 1);
    assert.equal(
        getPlatforms().length,
        platformsBefore,
        'cloud ground platforms leaked after eviction'
    );
    assert.equal(foliageClouds.length, cloudsBefore, 'foliageClouds leaked after eviction');
    assert.equal(
        CloudBatcher.getInstance().clouds.length + CloudBatcher.getWalkableInstance().clouds.length,
        baseCloudBatcherCloudCount,
        'CloudBatcher still holds evicted clouds'
    );
    console.log('  ✓ clouds: puff runs compacted, platforms + registries released');

    // aIsWalkable is per-cloud data; in production each batcher holds one tier, so exercise a mixed one directly.
    const mixed = new CloudBatcher();
    const fakeCloud = (isWalkable) => ({
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        rotation: new THREE.Euler(),
        scale: new THREE.Vector3(1, 1, 1),
        userData: { isWalkable },
    });
    const first = fakeCloud(true);
    const second = fakeCloud(false);
    mixed.register(first, { scale: 1, puffCount: 3 });
    mixed.register(second, { scale: 1, puffCount: 4 });
    mixed.removeInstance(first);
    assert.equal(mixed.count, 4);
    assert.equal(second.userData.batchStart, 0);
    assert.deepEqual(
        Array.from(mixed.isWalkableAttribute.array.subarray(0, 4)),
        [0, 0, 0, 0],
        'aIsWalkable must follow its run'
    );
    mixed.removeInstance(second);
    assert.equal(mixed.count, 0);
    mixed.removeInstance(second); // double-evict is a no-op
    assert.equal(mixed.count, 0);
    mixed.dispose();

    // Caves: physics registration, weather tracking and the rain-fed waterfall column.
    const cavesBefore = foliageCaves.length;
    const wfBefore = waterfallBatcher.count;
    const trackedBefore = weather.trackedCaves.length;
    spawnEntity('cave');
    const caveObj = record().evictable.find((o) => o.userData.type === 'cave');
    assert.ok(caveObj, 'cave should be tracked');
    assert.equal(foliageCaves.length, cavesBefore + 1, 'cave should register with physics');
    assert.equal(
        weather.trackedCaves.length,
        trackedBefore + 1,
        'cave should register with weather'
    );
    caveObj.updateMatrixWorld(true);
    updateCaveWaterLevel(caveObj, 1.0); // rain fills the cave -> waterfall instance added, keyed by cave.uuid
    assert.equal(waterfallBatcher.count, wfBefore + 1, 'rain should add a waterfall instance');
    evictAll();
    assert.equal(foliageCaves.length, cavesBefore, 'physics cave ghost after eviction');
    assert.equal(weather.trackedCaves.length, trackedBefore, 'weather cave ghost after eviction');
    assert.equal(waterfallBatcher.count, wfBefore, 'waterfall column ghost after cave eviction');
    console.log('  ✓ caves: physics + weather + rain waterfall released');

    // A standalone 'waterfall' proxy (the cave-gate proxy in generation-entities) frees its own column.
    const wfBefore3 = waterfallBatcher.count;
    const wfProxy = new THREE.Object3D();
    wfProxy.userData = { type: 'waterfall', isBatched: true };
    waterfallBatcher.add(wfProxy.uuid, new THREE.Vector3(0, 8, 0), 6, 2);
    streamer['trackSpawnedObject'](wfProxy, record());
    assert.equal(record().permanentCount, 0, 'waterfall proxy must be evictable');
    assert.equal(waterfallBatcher.count, wfBefore3 + 1);
    evictAll();
    assert.equal(waterfallBatcher.count, wfBefore3, 'waterfall proxy column leaked after eviction');
    console.log('  ✓ waterfall proxy: column released');

    // Giant mushroom: weather-driven waterfall keyed by mushroom uuid.
    const mushBefore = weather.trackedMushrooms.length;
    const wfBefore2 = waterfallBatcher.count;
    spawnEntity('mushroom', { variant: 'giant' });
    const giant = record().evictable.find((o) => o.userData.type === 'mushroom');
    assert.ok(giant, 'giant mushroom should be tracked');
    assert.equal(weather.trackedMushrooms.length, mushBefore + 1);
    waterfallBatcher.add(giant.uuid, new THREE.Vector3(0, 8, 0), 6, 2); // what updateMushroomWaterfalls does in rain
    weather.mushroomWaterfalls.add(giant.uuid);
    evictAll();
    assert.equal(
        weather.trackedMushrooms.length,
        mushBefore,
        'weather kept a reference to an evicted mushroom'
    );
    assert.equal(weather.mushroomWaterfalls.size, 0, 'mushroom waterfall bookkeeping leaked');
    assert.equal(
        waterfallBatcher.count,
        wfBefore2,
        'mushroom waterfall column ghost after eviction'
    );
    console.log('  ✓ giant mushroom: weather tracking + waterfall released');

    // Gems hung on a non-gem_canopy tree species are freed with the tree.
    const gemsBefore = gemTotal();
    const willow = create('bubble_willow', {});
    willow.userData.attachGemFruits = true;
    willow.position.set(3, 0, 3);
    const before = animatedFoliage.length;
    assert.ok(safeAddFoliage(willow, true, 1.5, weather));
    for (let i = before; i < animatedFoliage.length; i++) {
        streamer['trackSpawnedObject'](animatedFoliage[i], record());
    }
    assert.ok(gemTotal() > gemsBefore, 'attachGemFruits should place gems');
    evictAll();
    assert.equal(gemTotal(), gemsBefore, 'gems on a bubble willow leaked after eviction');
    console.log('  ✓ willow with attachGemFruits: gems released');

    // Sugar caves + standalone glowing flowers: proxy path, no global registrations.
    for (const [label, batcher, live, type] of [
        ['sugar_cave', sugarCaveBatcher, () => sugarCaveBatcher['_count'], 'sugar_cave'],
        [
            'glowing_flower',
            glowingFlowerBatcher,
            () => glowingFlowerBatcher.count,
            'glowing_flower',
        ],
    ]) {
        const base = live();
        const physBefore = foliageCaves.length;
        const platBefore = getPlatforms().length;
        const proxies = [];
        for (let i = 0; i < N; i++) {
            const p = new THREE.Object3D();
            p.position.set(i, -6, i);
            if (label === 'glowing_flower') p.userData.type = type; // sugar_cave stamps its own
            batcher.register(p);
            assert.equal(p.userData.type, type, `${label}: proxy type must be stable`);
            assert.equal(p.userData.isBatched, true, `${label}: proxy must be stamped isBatched`);
            streamer['trackSpawnedObject'](p, record());
            proxies.push(p);
        }
        assert.equal(live(), base + N, `${label}: register should add instances`);
        assert.equal(record().permanentCount, 0, `${label}: proxies must be evictable`);
        evictAll();
        assert.equal(live(), base, `${label}: count stuck after eviction`);
        assert.equal(foliageCaves.length, physBefore, `${label}: must not touch physics caves`);
        assert.equal(
            getPlatforms().length,
            platBefore,
            `${label}: must not touch ground platforms`
        );
    }
    console.log('  ✓ sugar_cave / glowing_flower proxies: slots freed, no global registrations');
}

// ---------------------------------------------------------------------------
// 5. Swap-with-last edge case (survivor keeps its slot bookkeeping).
// ---------------------------------------------------------------------------
function test4_swapWithLast() {
    console.log('--- 4. Subwoofer lotus swap-with-last edge case ---');
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    subwooferLotusBatcher.register(a);
    subwooferLotusBatcher.register(b);
    const groupA = a.userData.interactiveGroup;
    const groupB = b.userData.interactiveGroup;
    assert.ok(
        groupA.parent !== null && groupB.parent !== null,
        'both groups should be in the scene'
    );
    const slotA = a.userData.batchIndex;
    assert.equal(b.userData.batchIndex, slotA + 1);
    subwooferLotusBatcher.removeInstance(a);
    assert.ok(groupA.parent === null, 'removed group must leave the scene');
    assert.ok(groupB.parent !== null, 'survivor must stay in the scene');
    assert.equal(b.userData.batchIndex, slotA, 'survivor must be moved into the freed slot');
    subwooferLotusBatcher.removeInstance(b);
    console.log('  ✓ survivor remapped, removed group detached');
}

// ---------------------------------------------------------------------------
// 6. Telemetry: live count + byteLength per batcher, and it tracks eviction.
// ---------------------------------------------------------------------------
function test5_telemetry() {
    console.log(
        '--- 5. window.__batcherCounts / __batcherBuffers report live counts + byteLength ---'
    );
    installBatcherTelemetry();
    assert.equal(typeof window.__batcherCounts, 'function');
    assert.equal(typeof window.__batcherBuffers, 'function');

    const report = collectBatcherTelemetry();
    const ids = new Set(report.entries.map((e) => e.id));
    for (const id of [
        'tree',
        'mushroom',
        'flower',
        'cloud',
        'luminous',
        'gem_canopy',
        'waterfall',
        'dandelion',
        'candy_debris',
        'subwoofer_lotus',
        'glowing_flower',
        'sugar_cave',
        'kick_drum_geyser',
        'night_market',
        'fauna',
    ]) {
        assert.ok(ids.has(id), `telemetry is missing batcher "${id}"`);
    }
    for (const e of report.entries) {
        assert.ok(Number.isFinite(e.byteLength) && e.byteLength >= 0, `${e.id}: bad byteLength`);
    }
    assert.ok(Number.isFinite(report.totalByteLength));

    const c0 = window.__batcherCounts().luminous;
    const b0 = window.__batcherBuffers().luminous;
    for (let i = 0; i < N; i++) spawnEntity('luminous_plant');
    const c1 = window.__batcherCounts().luminous;
    const b1 = window.__batcherBuffers().luminous;
    assert.equal(c1, c0 + N, '__batcherCounts should rise with live instances');
    assert.equal(b1.count, c1);
    assert.ok(b1.byteLength > 0, 'luminous byteLength should be reported');
    assert.equal(
        b1.byteLength,
        b0.byteLength,
        'byteLength must not grow when instances are added within capacity'
    );
    evictAll();
    assert.equal(
        window.__batcherCounts().luminous,
        c0,
        '__batcherCounts should fall back after eviction'
    );
    assert.equal(window.__batcherBuffers().luminous.byteLength, b0.byteLength);
    console.log('  ✓ live counts fall on eviction, byteLength stays flat');
}

async function main() {
    console.log('🍬 Candy World Streamer Evict Parity Test');
    console.log('=========================================\n');
    let passed = 0;
    for (const t of [
        test1_classification,
        test2_slotRecovery,
        test3_ghosts,
        test4_swapWithLast,
        test5_telemetry,
    ]) {
        try {
            t();
            passed++;
        } catch (err) {
            console.error(`❌ ${t.name} failed!`, err);
            process.exit(1);
        }
    }
    console.log(`\n✅ All ${passed} tests passed!`);
    process.exit(0);
}

main();
