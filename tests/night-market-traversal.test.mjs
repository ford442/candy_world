/**
 * Festival Night Market (#1758) — traversal / contract regression.
 *
 * Runs in plain Node (tsx + tests/support hooks). Stalls go through the REAL
 * registration path (`processMapEntity` → foliage registry → NightMarketBatcher)
 * and the REAL ChunkStreamer eviction path, so this catches:
 *   - map.json setpiece + chunk index drift
 *   - stream in/out leaking stall instances (#1755 removeInstance contract)
 *   - snapshot / ?debugPlace round trip losing a stall on reload (#1756)
 *   - discovery stamps + chord-strike hook firing by day
 *   - music bindings not decaying to rest when silent / leaking into the day
 *
 * Run: npm run test:night-market
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const { nightMarketBatcher, NIGHT_MARKET_DAY_HIDE_PHASE } =
    await import('../src/foliage/night-market-batcher.ts');
const { processMapEntity } = await import('../src/world/generation-entities.ts');
const { ChunkStreamer } = await import('../src/world/chunk-streamer.ts');
const { loadMap } = await import('../src/world/map-loader.ts');
const { animatedFoliage } = await import('../src/world/state.ts');
const { getLocalLightStats } = await import('../src/rendering/lights.ts');
const { CURRENT_SNAPSHOT_VERSION } = await import('../src/systems/entity-snapshot-core.ts');
const { restoreEntity } = await import('../src/systems/entity-snapshot.ts');
const { applyEntitySnapshots, serializeEntitySnapshots } =
    await import('../src/systems/save-system/entity-snapshot.ts');
const stamps = await import('../src/systems/night-market-stamps.ts');
const { BiomeUniforms, getBiomeUniforms } = await import('../src/systems/biome-uniforms.ts');
const { updateBiomeChannelBindings, SILENT_DECAY_UNIFORMS } =
    await import('../src/systems/music-reactivity-bindings.ts');
const { MRState } = await import('../src/systems/music-reactivity-core.ts');
const { CONFIG } = await import('../src/core/config.ts');

let failures = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err && err.stack ? err.stack : err}`);
    }
}

const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf-8'));
const MAP = readJson('../assets/map.json');
const CHUNKS = readJson('../assets/map-chunks.json');
const BINDINGS = readJson('../assets/music-bindings.json');
const VIEWPOINTS = readJson('../tools/visual-regression/viewpoints.json');

const liveStalls = () => animatedFoliage.filter((o) => o?.userData?.type === 'night_market_stall');

/** Evict every live stall the way ChunkStreamer does (batcher + registry). */
function clearLiveStalls() {
    for (const obj of liveStalls()) {
        nightMarketBatcher.removeInstance(obj);
        animatedFoliage.splice(animatedFoliage.indexOf(obj), 1);
        obj.parent?.remove(obj);
    }
}

// ---------------------------------------------------------------------------
// Map / chunk index
// ---------------------------------------------------------------------------

const region = MAP.regions.find((r) => r.id === 'night_market');
const mapStalls = MAP.entities.filter((e) => e.type === 'night_market_stall');

await test('map.json ships a night_market region with ≥6 stalls inside it', () => {
    assert.ok(region, 'night_market region missing');
    assert.equal(region.biome, 'night_market');
    assert.ok(mapStalls.length >= 6, `expected ≥6 stalls, got ${mapStalls.length}`);
    for (const s of mapStalls) {
        const [x, , z] = s.position;
        assert.ok(
            x >= region.bounds.min[0] &&
                x <= region.bounds.max[0] &&
                z >= region.bounds.min[1] &&
                z <= region.bounds.max[1],
            `${s.id} outside region`
        );
        assert.ok(
            typeof s.id === 'string' && s.id.startsWith('setpiece:night_market:'),
            'stable id'
        );
    }
});

await test('chunk index is fresh and indexes every stall', async () => {
    const loaded = await loadMap(MAP);
    assert.equal(
        CHUNKS.__meta__.entityCount,
        loaded.entities.length,
        'stale map-chunks.json — run npm run generate:chunk-index'
    );
    const indexed = new Set(
        Object.entries(CHUNKS)
            .filter(([k]) => k !== '__meta__')
            .flatMap(([, ids]) => ids)
    );
    for (const s of mapStalls) assert.ok(indexed.has(s.id), `${s.id} not in chunk index`);
});

await test('market is inside the Play spawn ring (loads with the first chunk)', () => {
    const size = CHUNKS.__meta__.chunkSize;
    const scx = Math.floor(CONFIG.player.spawnX / size);
    const scz = Math.floor(CONFIG.player.spawnZ / size);
    for (const s of mapStalls) {
        const cx = Math.floor(s.position[0] / size);
        const cz = Math.floor(s.position[2] / size);
        assert.ok(
            Math.max(Math.abs(cx - scx), Math.abs(cz - scz)) <= 1,
            `${s.id} outside spawn ring`
        );
    }
});

await test('night_market visual-regression viewpoint is a night shot of the region', () => {
    const vp = VIEWPOINTS.viewpoints.find((v) => v.name === 'night_market');
    assert.ok(vp, 'viewpoint missing');
    assert.equal(vp.timeOfDay, 'night');
    const t = vp.cameraTarget;
    assert.ok(t.x >= region.bounds.min[0] && t.x <= region.bounds.max[0], 'target x in region');
    assert.ok(t.z >= region.bounds.min[1] && t.z <= region.bounds.max[1], 'target z in region');
});

// ---------------------------------------------------------------------------
// Registration + eviction (#1755)
// ---------------------------------------------------------------------------

await test('processMapEntity registers a batched stall with a decorative light', () => {
    clearLiveStalls();
    const lightsBefore = getLocalLightStats();
    const before = nightMarketBatcher.instanceCount;
    processMapEntity({ ...mapStalls[0] }, null);
    const [stall] = liveStalls();
    assert.ok(stall, 'stall not registered in animatedFoliage');
    assert.equal(stall.userData.isBatched, true);
    assert.equal(stall.userData.mapEntityId, mapStalls[0].id);
    assert.equal(nightMarketBatcher.instanceCount, before + 1);
    assert.equal(nightMarketBatcher.frameMesh.count, before + 1);
    assert.equal(getLocalLightStats().gpu, lightsBefore.gpu, 'no GPU light per stall');
    assert.equal(getLocalLightStats().decorative, lightsBefore.decorative + 1);
    clearLiveStalls();
    assert.equal(
        getLocalLightStats().decorative,
        lightsBefore.decorative,
        'light released on evict'
    );
});

await test('removeInstance swap-removes and keeps the remaining transforms', () => {
    clearLiveStalls();
    const ids = [0, 1, 2].map((i) => {
        processMapEntity({ ...mapStalls[i] }, null);
        return mapStalls[i].id;
    });
    const stalls = ids.map((id) => liveStalls().find((s) => s.userData.mapEntityId === id));
    const lastPos = new THREE.Vector3().copy(stalls[2].position);

    nightMarketBatcher.removeInstance(stalls[0]);
    assert.equal(nightMarketBatcher.instanceCount, 2);
    assert.equal(stalls[0].userData.nightMarketSlot, undefined);
    assert.equal(stalls[2].userData.nightMarketSlot, 0, 'last slot moved into the hole');

    const m = new THREE.Matrix4().fromArray(nightMarketBatcher.awningMesh.instanceMatrix.array, 0);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    assert.ok(p.distanceTo(lastPos) < 1e-4, 'moved instance matrix follows its proxy');

    nightMarketBatcher.removeInstance(stalls[0]); // double remove is a no-op
    assert.equal(nightMarketBatcher.instanceCount, 2);
    animatedFoliage.splice(animatedFoliage.indexOf(stalls[0]), 1);
    clearLiveStalls();
    assert.equal(nightMarketBatcher.instanceCount, 0);
});

await test('ChunkStreamer stream in/out cycles never leak stall instances', async () => {
    clearLiveStalls();
    const loaded = await loadMap(MAP);
    const only = new Map(mapStalls.map((s) => [s.id, loaded.getEntityById(s.id)]));
    const fakeMap = {
        getEntityById: (id) => only.get(id),
        getEntitiesInBounds: ({ minX, maxX, minZ, maxZ }) =>
            [...only.values()].filter(
                (e) =>
                    e.position[0] >= minX &&
                    e.position[0] < maxX &&
                    e.position[2] >= minZ &&
                    e.position[2] < maxZ
            ),
    };
    const streamer = new ChunkStreamer(fakeMap, null, null);
    const lightsBase = getLocalLightStats().decorative;

    for (let cycle = 0; cycle < 25; cycle++) {
        await streamer.loadSpawnPlayable(1, 96);
        assert.equal(nightMarketBatcher.instanceCount, mapStalls.length, `cycle ${cycle} spawn`);
        streamer.update({ x: 4000, z: 4000 }); // far away → evict
        assert.equal(nightMarketBatcher.instanceCount, 0, `cycle ${cycle} evict`);
        assert.equal(liveStalls().length, 0, 'evicted proxies leave animatedFoliage');
    }
    assert.equal(getLocalLightStats().decorative, lightsBase, 'decorative pool does not grow');
    streamer.dispose();
});

// ---------------------------------------------------------------------------
// Snapshot / ?debugPlace round trip (#1756)
// ---------------------------------------------------------------------------

await test('a ?debugPlace-style stall snapshot survives save → reload', () => {
    clearLiveStalls();
    const placed = {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id: 'night_market_stall_dev_1',
        entity: {
            type: 'night_market_stall',
            position: [6, 0.5, -60],
            rotation: { quat: [0, 0.707107, 0, 0.707107] },
            scale: 1.25,
            placement: 'absolute',
            params: {},
        },
    };
    const created = restoreEntity(placed);
    assert.equal(created.length, 1);
    assert.equal(nightMarketBatcher.instanceCount, 1);

    const saved = serializeEntitySnapshots().filter((s) => s.entity.type === 'night_market_stall');
    assert.equal(saved.length, 1, 'authored stall is written to the save');
    assert.equal(saved[0].id, placed.id);
    assert.deepEqual(saved[0].entity.position, placed.entity.position);
    assert.equal(saved[0].entity.scale, 1.25);

    clearLiveStalls(); // "reload": the world comes back without it
    assert.equal(nightMarketBatcher.instanceCount, 0);

    const result = applyEntitySnapshots(saved);
    assert.equal(result.restored, 1);
    assert.equal(nightMarketBatcher.instanceCount, 1, 'stall reappears after reload');
    assert.equal(applyEntitySnapshots(saved).alreadyLive, 1, 'idempotent');
    clearLiveStalls();
});

// ---------------------------------------------------------------------------
// Night gate, stamps, chord strike
// ---------------------------------------------------------------------------

await test('lantern mesh is hidden in full day and shown at night', () => {
    clearLiveStalls();
    processMapEntity({ ...mapStalls[0] }, null);
    nightMarketBatcher.update(1.0);
    assert.equal(nightMarketBatcher.lanternMesh.visible, false);
    nightMarketBatcher.update(NIGHT_MARKET_DAY_HIDE_PHASE - 0.01);
    assert.equal(nightMarketBatcher.lanternMesh.visible, true);
    nightMarketBatcher.update(0.0);
    assert.equal(nightMarketBatcher.lanternMesh.visible, true);
    assert.equal(
        nightMarketBatcher.frameMesh.visible,
        true,
        'shuttered stall stays visible by day'
    );
    clearLiveStalls();
});

await test('discovery stamps only at night, once per stall, via stable map ids', () => {
    clearLiveStalls();
    for (const s of mapStalls) processMapEntity({ ...s }, null);
    const found = new Map();
    const sink = {
        discover: (id, name) => (found.has(id) ? false : (found.set(id, name), true)),
        isDiscovered: (id) => found.has(id),
    };
    stamps.__setNightMarketStampDeps({ sink });
    const [x, , z] = mapStalls[0].position;

    assert.equal(stamps.updateNightMarketStamps(1, { x, z }, 1.0), 0, 'no stamps by day');
    assert.equal(stamps.updateNightMarketStamps(1, { x, z }, 0.0), 1, 'stamp at night');
    assert.ok(found.has(stamps.NIGHT_MARKET_DISCOVERY_ID), 'market discovery on first stamp');
    assert.ok(
        found.has(`${stamps.NIGHT_MARKET_STAMP_PREFIX}${mapStalls[0].id}`),
        'keyed by map id'
    );
    assert.equal(stamps.updateNightMarketStamps(1, { x, z }, 0.0), 0, 'no duplicate stamp');
    assert.equal(stamps.updateNightMarketStamps(0.01, { x, z }, 0.0), 0, 'throttled');

    const origin = new THREE.Vector3(4, 0, -52);
    assert.equal(
        stamps.onNightMarketChordStrike(origin, 20, 1.0),
        0,
        'chord strike ignored by day'
    );
    const flared = stamps.onNightMarketChordStrike(origin, 20, 0.0);
    assert.equal(flared, mapStalls.length - 1, 'chord strike stamps the rest of the market');
    assert.equal(BiomeUniforms.nightMarket.shimmer.value, 1.0, 'lanterns flare');
    assert.equal(stamps.getNightMarketStampCount([...found.keys()]), mapStalls.length);

    stamps.__setNightMarketStampDeps();
    clearLiveStalls();
});

// ---------------------------------------------------------------------------
// Music bindings
// ---------------------------------------------------------------------------

function audioWith(volumes) {
    const channelData = Array.from({ length: 8 }, (_, i) => ({
        volume: volumes[i] ?? 0,
        note: volumes[i] ? '64' : '0',
    }));
    return { channelData };
}

await test('night_market bindings are wired end to end', () => {
    const b = BINDINGS.biomes.night_market;
    assert.ok(b && b.shimmer.length && b.hueShift.length && b.noteColor.length);
    assert.ok(BINDINGS.sky_wave.target_biomes.includes('night_market'));
    assert.deepEqual([...MRState.nightMarketShimmerCh], b.shimmer);
    assert.equal(getBiomeUniforms('night_market'), BiomeUniforms.nightMarket);
    assert.ok(SILENT_DECAY_UNIFORMS.includes(BiomeUniforms.nightMarket.shimmer));
    assert.ok(CONFIG.noteColorMap.night_market?.C, 'PALETTE night_market note colours');
});

await test('market reacts at night, stays at rest by day, decays when silent', () => {
    const cam = new THREE.Vector3();
    const loud = audioWith([0, 1, 0, 1, 0, 0, 1, 0]);
    BiomeUniforms.nightMarket.shimmer.value = 0;

    updateBiomeChannelBindings(loud, 1.0, cam); // full day
    assert.equal(BiomeUniforms.nightMarket.shimmer.value, 0, 'hard night gate: no day shimmer');
    assert.equal(BiomeUniforms.nightMarket.hueShift.value, 0);

    updateBiomeChannelBindings(loud, 0.0, cam); // deep night
    assert.ok(BiomeUniforms.nightMarket.shimmer.value > 0.9, 'night shimmer');
    assert.ok(BiomeUniforms.nightMarket.hueShift.value > 0.9, 'night hueShift');

    const color = BiomeUniforms.nightMarket.noteColor.value;
    for (let i = 0; i < 400; i++) updateBiomeChannelBindings(null, 0.0, cam);
    assert.ok(BiomeUniforms.nightMarket.shimmer.value < 1e-6, 'silent night decays to rest');
    assert.ok(BiomeUniforms.nightMarket.hueShift.value < 1e-6);
    assert.ok(color.r > 0.99 && color.g > 0.99 && color.b > 0.99, 'note colour released to white');
    assert.equal(
        BiomeUniforms.nightMarket.noteColor.value,
        color,
        'uniform value mutated in place'
    );
});

if (failures > 0) {
    console.error(`\n${failures} night-market test(s) failed`);
    process.exit(1);
}
console.log('\nAll night-market traversal tests passed 🏮');
process.exit(0);
