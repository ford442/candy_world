import * as THREE from 'three';
import { registerCloudPlatform } from '../debug/tools-stub.ts';
import { sugarCaveBatcher } from '../foliage/index.ts';
import { createSkyIsland, skyIslandBatcher } from '../foliage/sky-islands.ts';
import {
    registerWalkableIslandPlatform,
    registerWalkableCloudPlatform,
    getGroundHeight,
} from '../systems/ground-system.ts';
import { addCollisionObject } from '../utils/wasm-loader.ts';
import { create } from './foliage-registry.ts';
import { safeAddFoliage } from './generation-entities.ts';
import {
    CLOUD_ARCHIPELAGO,
    SKY_ISLANDS,
    SUGAR_CAVES,
    WeatherSystem,
    yieldControl,
} from './generation-utils.ts';
import { sampleGroundY } from './placement-utils.ts';
import {
    registerSkyIslandNode,
    registerSkyIslandEdge,
    rebuildSkyIslandDebug,
    validateSkyIslandGraph,
    initSkyIslandDebug,
} from './sky-island-graph.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';

/**
 * Stacked sky islands — low mist / mid canopy / high nebula (#1363).
 * Absolute Y tiers + vine ladders + cloud ring + panning lift pads.
 */
export async function populateSugarCaves(weatherSystem: WeatherSystem): Promise<void> {
    if (!SUGAR_CAVES.enabled) return;

    console.log('[World] Populating Subterranean Sugar Caves...');
    sugarCaveBatcher.clear();

    const { startX, startZ, endX, endZ, density } = SUGAR_CAVES;
    const dx = endX - startX;
    const dz = endZ - startZ;
    const length = Math.sqrt(dx * dx + dz * dz);
    const count = Math.floor(length * density);

    const _scratchPos = new THREE.Vector3();
    const _scratchQuat = new THREE.Quaternion();

    for (let i = 0; i < count; i++) {
        const t = i / Math.max(1, count - 1);
        const x = startX + dx * t + (Math.random() - 0.5) * 6.0;
        const z = startZ + dz * t + (Math.random() - 0.5) * 6.0;

        // Ensure caves are placed underground relative to unified ground height
        const terrainY = sampleGroundY(x, z);
        const caveY = terrainY - 5.0 - Math.random() * 4.0;

        _scratchPos.set(x, caveY, z);

        // Random orientation
        _scratchQuat.setFromEuler(
            new THREE.Euler(
                (Math.random() - 0.5) * Math.PI,
                Math.random() * Math.PI * 2,
                (Math.random() - 0.5) * Math.PI
            )
        );

        const scale = 0.8 + Math.random() * 0.8;
        sugarCaveBatcher.add(_scratchPos, _scratchQuat, scale);

        if (i % 20 === 19) await yieldControl();
    }
}

export async function populateSkyIslands(weatherSystem: WeatherSystem): Promise<void> {
    if (!SKY_ISLANDS.enabled) return;

    console.log('[World] Populating Sky Islands biome...');
    skyIslandBatcher.clear();

    // Keep approach nodes from populateCloudArchipelago; only seed ground if missing
    const approachX = CLOUD_ARCHIPELAGO.startX;
    const approachZ = CLOUD_ARCHIPELAGO.startZ;
    registerSkyIslandNode({
        id: 'approach:ground',
        layerId: 'ground',
        x: approachX,
        y: sampleGroundY(approachX, approachZ),
        z: approachZ,
        kind: 'ground',
    });

    for (let li = 0; li < SKY_ISLANDS.layers.length; li++) {
        const layer = SKY_ISLANDS.layers[li];
        const x = SKY_ISLANDS.centerX + layer.offsetX;
        const z = SKY_ISLANDS.centerZ + layer.offsetZ;
        const y = layer.y;

        // Validate absolute Y is well above terrain (unified ground query)
        const terrainY = getGroundHeight(x, z);
        if (y <= terrainY + 4) {
            console.warn(
                `[SkyIslands] layer ${layer.id} Y=${y} too close to terrain ${terrainY.toFixed(2)}; skipping`
            );
            recordSpawnAttempt('sky_island', false, new Error('Y overlap with terrain'));
            continue;
        }

        const island = createSkyIsland({
            radius: layer.radius,
            height: layer.height,
            kind: layer.kind,
            layerId: layer.id,
        });
        island.position.set(x, y, z);
        island.userData.persistentId = `sky_island:${layer.id}`;
        island.userData.mapEntityType = 'sky_island';
        island.userData.mapExport = {
            type: 'sky_island',
            provenance: 'sky-islands',
            placement: 'absolute',
            biome: 'sky_islands',
            params: { layer: layer.id, kind: layer.kind, radius: layer.radius },
        };

        const placed = safeAddFoliage(island, false, 0, weatherSystem);
        recordSpawnAttempt(
            'sky_island',
            placed,
            placed ? undefined : new Error('placement failed')
        );
        if (!placed) continue;

        registerWalkableIslandPlatform(island);
        skyIslandBatcher.register(island);

        // Collision AABB matching platform bounds (type, x, y, z, halfX, halfY, halfZ, p2)
        addCollisionObject(
            2,
            x,
            y - layer.height * 0.2,
            z,
            layer.radius * 0.9,
            layer.height * 0.4,
            layer.radius * 0.9,
            0
        );

        const nodeId = `island:${layer.id}`;
        registerSkyIslandNode({
            id: nodeId,
            layerId: layer.id,
            x,
            y,
            z,
            kind: 'island',
        });

        // --- Layer-specific dressing ---
        if (layer.kind === 'mist') {
            // Walkable cloud ring + panning lift pads
            for (let c = 0; c < SKY_ISLANDS.cloudRingCount; c++) {
                const a = (c / SKY_ISLANDS.cloudRingCount) * Math.PI * 2;
                const cx = x + Math.cos(a) * (layer.radius + 4);
                const cz = z + Math.sin(a) * (layer.radius + 4);
                const cy = y - 1.5 + (c % 2) * 1.2;
                const cloud = create('cloud', { size: 1.4, tier: 1 });
                if (!cloud) continue;
                cloud.position.set(cx, cy, cz);
                cloud.userData.tier = 1;
                cloud.userData.isWalkable = true;
                cloud.userData.cloudScale = 1.4;
                cloud.userData.biome = 'sky_islands';
                cloud.userData.mapEntityType = 'cloud';
                if (safeAddFoliage(cloud, false, 0, weatherSystem)) {
                    registerWalkableCloudPlatform(cloud);
                    registerCloudPlatform(cloud);
                    const cid = `mist:cloud:${c}`;
                    registerSkyIslandNode({
                        id: cid,
                        layerId: layer.id,
                        x: cx,
                        y: cy,
                        z: cz,
                        kind: 'cloud',
                    });
                    registerSkyIslandEdge({
                        id: `edge:${cid}->${nodeId}`,
                        from: cid,
                        to: nodeId,
                        kind: 'cloud_hop',
                    });
                }
            }
            for (let p = 0; p < SKY_ISLANDS.panningPadCount; p++) {
                const a = (p / SKY_ISLANDS.panningPadCount) * Math.PI * 2 + 0.5;
                const px = x + Math.cos(a) * (layer.radius * 0.55);
                const pz = z + Math.sin(a) * (layer.radius * 0.55);
                const pad = create('panning_pad', { radius: 1.4, panBias: p % 2 === 0 ? -1 : 1 });
                if (!pad) continue;
                pad.position.set(px, y + 0.4, pz);
                pad.userData.biome = 'sky_islands';
                pad.userData.mapEntityType = 'panning_pad';
                if (safeAddFoliage(pad, false, 0, weatherSystem)) {
                    const pid = `mist:pad:${p}`;
                    registerSkyIslandNode({
                        id: pid,
                        layerId: layer.id,
                        x: px,
                        y: y + 0.4,
                        z: pz,
                        kind: 'pad',
                    });
                    registerSkyIslandEdge({
                        id: `edge:${nodeId}->${pid}`,
                        from: nodeId,
                        to: pid,
                        kind: 'lift_pad',
                    });
                }
            }
        } else if (layer.kind === 'canopy') {
            // Wisteria bridge accents + gem canopy sapling
            for (let w = 0; w < 3; w++) {
                const a = (w / 3) * Math.PI * 2;
                const wx = x + Math.cos(a) * (layer.radius * 0.6);
                const wz = z + Math.sin(a) * (layer.radius * 0.6);
                const wisteria = create('wisteria_cluster', { scale: 0.85 });
                if (!wisteria) continue;
                wisteria.position.set(wx, y, wz);
                wisteria.userData.biome = 'sky_islands';
                safeAddFoliage(wisteria, false, 0, weatherSystem);
            }
            const gem = create('gem_canopy_tree', { height: 4.2 });
            if (gem) {
                gem.position.set(x + 1.5, y, z - 1.2);
                gem.userData.biome = 'gem_canopy';
                safeAddFoliage(gem, true, 1.2, weatherSystem);
            }
        } else if (layer.kind === 'nebula') {
            // Glass mushrooms + silence spirits
            for (let m = 0; m < 5; m++) {
                const a = (m / 5) * Math.PI * 2;
                const mx = x + Math.cos(a) * (layer.radius * 0.45);
                const mz = z + Math.sin(a) * (layer.radius * 0.45);
                const mush = create('glass_mushroom', { scale: 0.7 + Math.random() * 0.4 });
                if (!mush) continue;
                mush.position.set(mx, y, mz);
                mush.userData.biome = 'sky_islands';
                safeAddFoliage(mush, false, 0, weatherSystem);
            }
            for (let s = 0; s < 2; s++) {
                const spirit = create('silence_spirit', { scale: 1.0 });
                if (!spirit) continue;
                spirit.position.set(x + (s === 0 ? -2 : 2), y + 1.2, z);
                spirit.userData.biome = 'sky_islands';
                safeAddFoliage(spirit, false, 0, weatherSystem);
            }
        }

        // Vine ladder from previous tier (or approach cloud apex)
        if (SKY_ISLANDS.vineLadders && li > 0) {
            const prev = SKY_ISLANDS.layers[li - 1];
            const prevX = SKY_ISLANDS.centerX + prev.offsetX;
            const prevZ = SKY_ISLANDS.centerZ + prev.offsetZ;
            const prevY = prev.y;
            const ladderLength = y - prevY;
            const midX = (x + prevX) * 0.5;
            const midZ = (z + prevZ) * 0.5;
            const ladder = create('vine_ladder', { length: ladderLength });
            if (ladder) {
                // Ladder hangs from upper island toward lower (pivot at top)
                ladder.position.set(midX, y, midZ);
                ladder.userData.mapEntityType = 'vine_ladder';
                ladder.userData.biome = 'sky_islands';
                ladder.userData.mapExport = {
                    type: 'vine_ladder',
                    provenance: 'sky-islands',
                    placement: 'absolute',
                    params: { length: ladderLength },
                };
                if (safeAddFoliage(ladder, false, 0, weatherSystem)) {
                    const prevId = `island:${prev.id}`;
                    registerSkyIslandEdge({
                        id: `edge:${prevId}->${nodeId}`,
                        from: prevId,
                        to: nodeId,
                        kind: 'vine_ladder',
                    });
                }
            }
        } else if (SKY_ISLANDS.vineLadders && li === 0) {
            // Ladder from last cloud stair height into low mist
            const approachTopY =
                CLOUD_ARCHIPELAGO.heightOffset +
                (CLOUD_ARCHIPELAGO.platforms - 1) * CLOUD_ARCHIPELAGO.stepY;
            const ladderLength = Math.max(5, y - approachTopY);
            const lx = (x + approachX + 8) * 0.5;
            const lz = (z + approachZ + 12) * 0.5;
            const ladder = create('vine_ladder', { length: ladderLength });
            if (ladder) {
                ladder.position.set(lx, y, lz);
                ladder.userData.mapEntityType = 'vine_ladder';
                ladder.userData.biome = 'sky_islands';
                if (safeAddFoliage(ladder, false, 0, weatherSystem)) {
                    registerSkyIslandEdge({
                        id: `edge:approach->${nodeId}`,
                        from: 'approach:ground',
                        to: nodeId,
                        kind: 'vine_ladder',
                    });
                }
            }
        }

        await yieldControl();
    }

    const validation = validateSkyIslandGraph();
    if (!validation.ok) {
        console.warn('[SkyIslands] connectivity graph warnings:', validation.errors);
    }

    // Expose graph for debug / tests; scene attach happens via initSkyIslandDebug when flag set
    try {
        const scene = (window as any).__scene as THREE.Scene | undefined;
        if (scene) {
            initSkyIslandDebug(scene);
            rebuildSkyIslandDebug();
        } else {
            (window as any).__initSkyIslandDebugWhenReady = true;
        }
    } catch {
        /* ignore */
    }

    (window as any).__skyIslandsReady = {
        layers: SKY_ISLANDS.layers.map((l) => ({ id: l.id, y: l.y })),
        islandCount: skyIslandBatcher.count,
        graphOk: validation.ok,
    };

    console.log(
        `[World] Sky Islands populated (${skyIslandBatcher.count} landmasses, graph ${validation.ok ? 'ok' : 'warn'})`
    );
}
