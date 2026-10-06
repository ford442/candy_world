// src/world/entity-despawn.ts
// Single teardown path for a live map entity: batcher instance slot, the
// state.ts tracking arrays, and the scene graph. Shared by ChunkStreamer
// eviction and edit-history undo so both remove exactly the same things.
import type * as THREE from 'three';
import { arpeggioFernBatcher } from '../foliage/arpeggio-batcher.ts';
import { dandelionBatcher } from '../foliage/dandelion-batcher.ts';
import { flowerBatcher } from '../foliage/flower-batcher.ts';
import { gemFruitBatcher } from '../foliage/gem-fruit-batcher.ts';
import { glassMushroomBatcher } from '../foliage/glass-mushroom-batcher.ts';
import { glowingFlowerBatcher } from '../foliage/glowing-flower-batcher.ts';
import { kickDrumGeyserBatcher } from '../foliage/kick-drum-geyser-batcher.ts';
import { lanternBatcher } from '../foliage/lantern-batcher.ts';
import { luminousPlantBatcher } from '../foliage/luminous-plant-batcher.ts';
import { mushroomBatcher } from '../foliage/mushroom-batcher/index.ts';
import { nightMarketBatcher } from '../foliage/night-market-batcher.ts';
import { CloudBatcher } from '../foliage/cloud-batcher.ts';
import { unregisterWalkableCloudPlatform } from '../systems/ground-system.ts';
import { unregisterCloudPlatform } from '../debug/tools-stub.ts';
import { portamentoPineBatcher } from '../foliage/portamento-batcher.ts';
import { simpleFlowerBatcher } from '../foliage/simple-flower-batcher.ts';
import { subwooferLotusBatcher } from '../foliage/subwoofer-lotus-batcher.ts';
import { sugarCaveBatcher } from '../foliage/sugar-cave-batcher.ts';
import { treeBatcher } from '../foliage/tree-batcher/index.ts';
import { waterfallBatcher } from '../foliage/waterfall-batcher.ts';
import { releaseLocalLight } from '../rendering/lights.ts';
import { unregisterPhysicsCave } from '../systems/physics/index.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import type { WeatherSystem } from './generation-utils.ts';
import {
    animatedFoliage,
    cpuAnimatedFoliage,
    foliageGroup,
    foliageMushrooms,
    foliageClouds,
    foliageTrampolines,
    foliagePanningPads,
    foliageGeysers,
    foliageTraps,
    foliagePortamentoPines,
    foliageVineLadders,
    interactiveObjects,
    computeFoliageObjects,
    vineSwings,
} from './state.ts';

/**
 * Safety-net fallback for classifyForEviction: any object flagged isBatched
 * that isn't matched by one of the specific type checks above falls back to
 * 'never' rather than being torn down without a removeInstance path (which
 * would desync an InstancedMesh's index bookkeeping). Every currently-known
 * batched species with an eviction path is matched explicitly before this
 * fallback; it only guards a future batched species that hasn't been wired in yet.
 */
function isKnownBatchedType(obj: THREE.Object3D): boolean {
    return !!obj.userData?.isBatched;
}

export type EvictionClass =
    | 'full'
    | 'mushroom'
    | 'lantern'
    | 'glassMushroom'
    | 'simpleFlower'
    | 'flower'
    | 'tree'
    | 'arpeggioFern'
    | 'portamentoPine'
    | 'cave'
    | 'kickDrumGeyser'
    | 'gemFruit'
    | 'luminousPlant'
    | 'dandelion'
    | 'waterfall'
    | 'subwooferLotus'
    | 'glowingFlower'
    | 'sugarCave'
    | 'nightMarketStall'
    | 'cloud'
    | 'never';

export function classifyForEviction(obj: THREE.Object3D): EvictionClass {
    const t = obj.userData?.type;
    if (t === 'tree' && obj.userData?.animationType === 'batchedPortamento') {
        return 'portamentoPine';
    }
    if (
        t === 'tree' ||
        t === 'shrub' ||
        t === 'willow' ||
        t === 'balloonBush' ||
        t === 'helixPlant' ||
        t === 'accordion_palm' ||
        t === 'floweringTree' ||
        t === 'bubbleWillow' ||
        t === 'prismRoseBush' ||
        t === 'helix' ||
        t === 'accordionPalm'
    ) {
        return 'tree';
    }
    // gem_canopy_tree needs both gem and tree removals, but only one
    // EvictionClass is returned here. We handle it as 'gemFruit' and do a
    // compound removal in despawnEntity.
    if (t === 'gem_canopy_tree') return 'gemFruit';
    if (t === 'mushroom') return 'mushroom';
    if (t === 'lanternFlower') return 'lantern';
    if (t === 'glass_mushroom') return 'glassMushroom';
    if (t === 'flower') return 'flower';
    if (t === 'simple_flower' || (obj.userData?.isFlower && t !== 'flower')) return 'simpleFlower';
    if (t === 'fern' || t === 'arpeggio_fern') return 'arpeggioFern';
    if (t === 'cave') return 'cave';
    if (t === 'kick_drum_geyser') return 'kickDrumGeyser';
    if (t === 'luminous_plant') return 'luminousPlant';
    if (t === 'cymbal_dandelion' || t === 'dandelion') return 'dandelion';
    if (t === 'waterfall') return 'waterfall';
    if (t === 'subwoofer_lotus') return 'subwooferLotus';
    if (t === 'glowing_flower') return 'glowingFlower';
    if (t === 'sugar_cave') return 'sugarCave';
    if (t === 'night_market_stall') return 'nightMarketStall';
    if (t === 'cloud') return 'cloud';
    if (isKnownBatchedType(obj)) return 'never';
    return 'full';
}

/** The class cached on `userData.__evictionClass` (ChunkStreamer stamps it at spawn), else classify now. */
function resolveEvictionClass(obj: THREE.Object3D): EvictionClass {
    const cached = (obj.userData as Record<string, unknown>).__evictionClass as
        EvictionClass | undefined;
    return cached ?? classifyForEviction(obj);
}

/** True when despawnEntity can remove this object without corrupting a batcher. */
export function canDespawn(obj: THREE.Object3D): boolean {
    return resolveEvictionClass(obj) !== 'never';
}

function removeFromArray(
    arr: readonly unknown[] & { splice(start: number, count: number): unknown },
    item: unknown
): void {
    const idx = arr.indexOf(item);
    if (idx !== -1) arr.splice(idx, 1);
}

/**
 * Remove a live entity from its batcher, every state.ts registry and the
 * scene, disposing its resources.
 *
 * Returns false — and touches nothing — for 'never' objects, which have no
 * safe removal path. Does NOT rebuild the physics grid; callers batch that.
 */
export function despawnEntity(obj: THREE.Object3D, weatherSystem?: WeatherSystem | null): boolean {
    const evictionClass = resolveEvictionClass(obj);
    if (evictionClass === 'never') return false;

    if (evictionClass === 'mushroom') {
        mushroomBatcher.removeInstance(obj);
    } else if (evictionClass === 'lantern') {
        lanternBatcher.removeInstance(obj);
    } else if (evictionClass === 'glassMushroom') {
        glassMushroomBatcher.removeInstance(obj);
    } else if (evictionClass === 'kickDrumGeyser') {
        kickDrumGeyserBatcher.removeInstance(obj);
    } else if (evictionClass === 'nightMarketStall') {
        nightMarketBatcher.removeInstance(obj);
    } else if (evictionClass === 'cloud') {
        if (obj.userData?.isWalkable) {
            CloudBatcher.getWalkableInstance().removeInstance(obj);
            unregisterWalkableCloudPlatform(obj);
            unregisterCloudPlatform(obj);
        } else {
            CloudBatcher.getInstance().removeInstance(obj);
        }
    } else if (evictionClass === 'simpleFlower') {
        simpleFlowerBatcher.removeInstance(obj);
    } else if (evictionClass === 'flower') {
        flowerBatcher.removeInstance(obj);
    } else if (evictionClass === 'tree') {
        treeBatcher.removeInstance(obj);
    } else if (evictionClass === 'arpeggioFern') {
        arpeggioFernBatcher.removeInstance(obj);
    } else if (evictionClass === 'portamentoPine') {
        portamentoPineBatcher.removeInstance(obj);
    } else if (evictionClass === 'gemFruit') {
        gemFruitBatcher.removeInstance(obj);
        // Also remove the underlying tree
        if (obj.userData?.type === 'gem_canopy_tree') {
            treeBatcher.removeInstance(obj);
        }
    } else if (evictionClass === 'luminousPlant') {
        luminousPlantBatcher.removeInstance(obj);
    } else if (evictionClass === 'dandelion') {
        dandelionBatcher.removeInstance(obj);
    } else if (evictionClass === 'waterfall') {
        waterfallBatcher.removeInstance(obj);
    } else if (evictionClass === 'subwooferLotus') {
        subwooferLotusBatcher.removeInstance(obj);
    } else if (evictionClass === 'glowingFlower') {
        glowingFlowerBatcher.removeInstance(obj);
    } else if (evictionClass === 'sugarCave') {
        sugarCaveBatcher.removeInstance(obj);
    } else if (evictionClass === 'cave') {
        unregisterPhysicsCave(obj);
        weatherSystem?.unregisterCave?.(obj);
        if (typeof obj.userData.caveLightHandle === 'string') {
            releaseLocalLight(obj.userData.caveLightHandle);
        }
        waterfallBatcher.remove(obj.uuid);
        obj.userData.waterfallActive = false;
    }
    // Discovery registration is intentionally left in place — the discovery
    // grid (WASM/AS) has no unregister API (see .swarm-state.md).
    removeFromArray(animatedFoliage, obj);
    removeFromArray(cpuAnimatedFoliage, obj);
    removeFromArray(foliageMushrooms, obj);
    removeFromArray(foliageClouds, obj);
    removeFromArray(foliageTrampolines, obj);
    removeFromArray(foliagePanningPads, obj);
    removeFromArray(foliageGeysers, obj);
    removeFromArray(foliageTraps, obj);
    removeFromArray(foliagePortamentoPines, obj);
    removeFromArray(foliageVineLadders, obj);
    removeFromArray(interactiveObjects, obj);
    removeFromArray(computeFoliageObjects, obj);
    for (let i = vineSwings.length - 1; i >= 0; i--) {
        if (vineSwings[i].vine === obj) vineSwings.splice(i, 1);
    }
    safeRemoveAndDispose(foliageGroup, obj);
    return true;
}
