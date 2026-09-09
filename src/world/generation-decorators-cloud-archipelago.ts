import { CONFIG } from '../core/config.ts';
import { registerCloudPlatform } from '../debug/tools-stub.ts';
import { registerWalkableCloudPlatform } from '../systems/ground-system.ts';
import { create } from './foliage-registry.ts';
import { safeAddFoliage } from './generation-entities.ts';
import { CLOUD_ARCHIPELAGO, WeatherSystem, yieldControl } from './generation-utils.ts';
import { sampleGroundY } from './placement-utils.ts';
import {
    clearSkyIslandGraph,
    registerSkyIslandNode,
    registerSkyIslandEdge,
} from './sky-island-graph.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';

/**
 * Ascending walkable cloud staircase into the sky-islands biome (#1266 / #1363).
 * Uses CLOUD_ARCHIPELAGO constants; ends near the low_mist island deck.
 */
export async function populateCloudArchipelago(weatherSystem: WeatherSystem): Promise<void> {
    if (!CLOUD_ARCHIPELAGO.enabled) return;

    console.log('[World] Populating cloud archipelago approach stairs...');
    clearSkyIslandGraph();
    const { startX, startZ, platforms, stepY, heightOffset } = CLOUD_ARCHIPELAGO;
    const groundY = sampleGroundY(startX, startZ);

    registerSkyIslandNode({
        id: 'approach:ground',
        layerId: 'ground',
        x: startX,
        y: groundY,
        z: startZ,
        kind: 'ground',
    });

    let prevCloudId: string | null = 'approach:ground';
    for (let i = 0; i < platforms; i++) {
        const t = platforms > 1 ? i / (platforms - 1) : 0;
        const x = startX + t * 8 + Math.sin(i * 1.7) * 2.5;
        const z = startZ + t * 12 + Math.cos(i * 1.3) * 2.5;
        const y = heightOffset + i * stepY;
        const size = 1.6 + (i % 3) * 0.25;

        const cloud = create('cloud', {
            size,
            scale: size,
            tier: CONFIG.cloud.walkableTier ?? 1,
        });
        if (!cloud) {
            recordSpawnAttempt('cloud', false, new Error('factory returned null'));
            continue;
        }

        cloud.position.set(x, y, z);
        cloud.userData.tier = 1;
        cloud.userData.isWalkable = true;
        cloud.userData.cloudScale = size;
        cloud.userData.biome = 'sky_islands';
        cloud.userData.mapEntityType = 'cloud';
        cloud.userData.mapExport = {
            type: 'cloud',
            provenance: 'cloud-archipelago',
            placement: 'absolute',
            tier: 1,
            params: { size, tier: 1 },
        };

        const placed = safeAddFoliage(cloud, false, 0, weatherSystem);
        recordSpawnAttempt('cloud', placed, placed ? undefined : new Error('placement failed'));
        if (!placed) continue;

        // Ensure walkable registration even if createCloud onPlacement already ran
        registerWalkableCloudPlatform(cloud);
        registerCloudPlatform(cloud);

        const nodeId = `approach:cloud:${i}`;
        registerSkyIslandNode({
            id: nodeId,
            layerId: 'approach',
            x,
            y,
            z,
            kind: 'cloud',
        });
        if (prevCloudId) {
            registerSkyIslandEdge({
                id: `edge:${prevCloudId}->${nodeId}`,
                from: prevCloudId,
                to: nodeId,
                kind: i === 0 ? 'approach' : 'cloud_hop',
            });
        }
        prevCloudId = nodeId;

        if (i % 3 === 2) await yieldControl();
    }

    console.log(`[World] Cloud archipelago: ${platforms} walkable stairs from Y≈${heightOffset}`);
}
