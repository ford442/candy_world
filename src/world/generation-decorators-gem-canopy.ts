import * as THREE from 'three';
import { getCIAdjustedCount } from '../core/config.ts';
import {
    createIntegratedGemSparks,
    registerIntegratedSystem,
} from '../particles/compute-integration.ts';
import { sampleEntityScale, sampleEntityHeight } from './entity-scale.ts';
import { create } from './foliage-registry.ts';
import { safeAddFoliage } from './generation-entities.ts';
import { GEM_CANOPY, WeatherSystem, isPositionValid, yieldControl } from './generation-utils.ts';
import { plantOnSurface, sampleGroundY } from './placement-utils.ts';
import { recordSpawnAttempt } from './spawn-tracker.ts';

/** Gem Canopy corridor — tree-lined jewel path receding into foggy distance. */
export async function populateGemCanopyCorridor(weatherSystem: WeatherSystem): Promise<void> {
    if (!GEM_CANOPY.enabled) return;

    console.log('[World] Populating Gem Canopy corridor...');
    const { startX, startZ, endX, endZ, corridorWidth, treeCount } = GEM_CANOPY;
    const dx = endX - startX;
    const dz = endZ - startZ;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const perpX = -dz / len;
    const perpZ = dx / len;

    for (let i = 0; i < treeCount; i++) {
        const t = treeCount > 1 ? i / (treeCount - 1) : 0;
        const side = i % 2 === 0 ? 1 : -1;
        const lateral = (corridorWidth * 0.5 + Math.random() * 2.5) * side;
        const x = startX + dx * t + perpX * lateral + (Math.random() - 0.5) * 2;
        const z = startZ + dz * t + perpZ * lateral + (Math.random() - 0.5) * 2;

        if (!isPositionValid(x, z, 2.0)) continue;
        const y = sampleGroundY(x, z);
        const tree = create('gem_canopy_tree', {
            height: sampleEntityHeight('gem_canopy_tree', {
                biome: 'gem_canopy',
                normalizedDistance: t,
            }),
        });
        if (!tree) continue;
        plantOnSurface(tree, x, z, { groundY: y, entityType: 'gem_canopy_tree' });
        tree.rotation.y = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.35;
        tree.userData.biome = 'gem_canopy';
        tree.userData.mapEntityType = 'gem_canopy_tree';
        tree.userData.mapExport = {
            type: 'gem_canopy_tree',
            provenance: 'procedural-extra',
            placement: 'ground',
        };
        const placed = safeAddFoliage(tree, true, 1.5, weatherSystem);
        recordSpawnAttempt(
            'gem_canopy_tree',
            placed,
            placed ? undefined : new Error('placement failed')
        );

        if (i % 4 === 3) await yieldControl();
    }

    // Corridor accent trees: occasional portamento / bubble willow with hanging gems.
    // These reuse GemFruitBatcher.attachToTree so the corridor sparkles even on
    // non-gem-canopy trunks, keeping the jewel motif consistent.
    for (let i = 0; i < 6; i++) {
        const t = (i + 0.5) / 6;
        const x =
            GEM_CANOPY.startX +
            (GEM_CANOPY.endX - GEM_CANOPY.startX) * t +
            (Math.random() - 0.5) * 8;
        const z =
            GEM_CANOPY.startZ +
            (GEM_CANOPY.endZ - GEM_CANOPY.startZ) * t +
            (Math.random() - 0.5) * 8;
        if (!isPositionValid(x, z, 2.0)) continue;
        const y = sampleGroundY(x, z);
        const usePine = i % 2 === 0;
        const tree = usePine
            ? create('portamento_pine', {
                  height: sampleEntityHeight('portamento_pine', {
                      biome: 'gem_canopy',
                      normalizedDistance: t,
                  }),
              })
            : create('bubble_willow', {
                  scale: sampleEntityScale('bubble_willow', {
                      biome: 'gem_canopy',
                      normalizedDistance: t,
                  }),
              });
        if (!tree) continue;
        const exportType = usePine ? 'portamento_pine' : 'bubble_willow';
        tree.userData.mapEntityType = exportType;
        tree.userData.mapExport = {
            type: exportType,
            provenance: 'procedural-extra',
            placement: 'ground',
        };
        tree.userData.attachGemFruits = true;
        plantOnSurface(tree, x, z, { groundY: y, entityType: exportType });
        tree.rotation.y = Math.random() * Math.PI * 2;
        const placed = safeAddFoliage(tree, true, 1.5, weatherSystem);
        recordSpawnAttempt(
            usePine ? 'portamento_pine' : 'bubble_willow',
            placed,
            placed ? undefined : new Error('placement failed')
        );
    }

    // Global sparkle field — one corridor-wide system (not per-tree).
    const centerX = (GEM_CANOPY.startX + GEM_CANOPY.endX) * 0.5;
    const centerZ = (GEM_CANOPY.startZ + GEM_CANOPY.endZ) * 0.5;
    const centerY = sampleGroundY(centerX, centerZ) + 6;
    const corridorLen = Math.sqrt(dx * dx + dz * dz);
    const sparkBounds = {
        x: corridorLen * 1.15,
        y: 16,
        z: GEM_CANOPY.corridorWidth * 1.8,
    };
    const gemSparks = createIntegratedGemSparks({
        count: getCIAdjustedCount(512, 0.1, 80),
        bounds: sparkBounds,
        center: new THREE.Vector3(centerX, centerY, centerZ),
        useCompute: true,
    });
    safeAddFoliage(gemSparks, false, 0, null);
    if ((gemSparks as any).userData?.computeParticleSystem) {
        registerIntegratedSystem(
            'gem_canopy_sparks',
            gemSparks,
            (gemSparks as any).userData.computeParticleSystem
        );
    }

    console.log(`[World] Gem Canopy corridor populated (${treeCount} trees along path)`);
}
