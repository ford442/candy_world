// src/world/generation-entity-kinds.ts
// Teardown kinds (#1973 slice 3). Which batcher or system owns a live map
// entity's slots, and how to free them, expressed as registry kinds:
// `evict:<class>` with an onDespawn hook. entity-despawn.ts knows none of this;
// it adopts the object into its kind (via the classifier below) and calls
// entities.despawn, which runs these hooks alongside the view kinds'.
//
// Classes are resolved at teardown time, not spawn time, from the class
// ChunkStreamer cached at spawn (`userData.__evictionClass`) or from userData
// now: objects reach teardown from paths that never spawned them under a
// teardown kind (tests, decorators that build batcher state directly).
import type * as THREE from 'three';
import { arpeggioFernBatcher } from '../foliage/arpeggio-batcher.ts';
import { CandyDebrisBatcher } from '../foliage/candy-debris-batcher.ts';
import { CloudBatcher } from '../foliage/cloud-batcher.ts';
import { dandelionBatcher } from '../foliage/dandelion-batcher.ts';
import { FaunaBatcher } from '../foliage/fauna-batcher.ts';
import { flowerBatcher } from '../foliage/flower-batcher.ts';
import { gemFruitBatcher } from '../foliage/gem-fruit-batcher.ts';
import { glassMushroomBatcher } from '../foliage/glass-mushroom-batcher.ts';
import { glowingFlowerBatcher } from '../foliage/glowing-flower-batcher.ts';
import { kickDrumGeyserBatcher } from '../foliage/kick-drum-geyser-batcher.ts';
import { lanternBatcher } from '../foliage/lantern-batcher.ts';
import { luminousPlantBatcher } from '../foliage/luminous-plant-batcher.ts';
import { mushroomBatcher } from '../foliage/mushroom-batcher/index.ts';
import { nightMarketBatcher } from '../foliage/night-market-batcher.ts';
import { portamentoPineBatcher } from '../foliage/portamento-batcher.ts';
import { simpleFlowerBatcher } from '../foliage/simple-flower-batcher.ts';
import { subwooferLotusBatcher } from '../foliage/subwoofer-lotus-batcher.ts';
import { sugarCaveBatcher } from '../foliage/sugar-cave-batcher.ts';
import { treeBatcher } from '../foliage/tree-batcher/index.ts';
import { waterfallBatcher } from '../foliage/waterfall-batcher.ts';
import { releaseLocalLight } from '../rendering/lights.ts';
import type { FaunaSpecies } from '../systems/fauna/types.ts';
import { unregisterWalkableCloudPlatform } from '../systems/ground-system.ts';
import { unregisterPhysicsCave } from '../systems/physics/index.ts';
import { debugHooks } from '../utils/debug-hooks.ts';
import { entities, type DespawnContext } from './state.ts';

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
    | 'fauna'
    | 'candyDebris'
    | 'never';

export function classifyForEviction(obj: THREE.Object3D): EvictionClass {
    const t = obj.userData?.type as string | undefined;
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
    // compound removal in its teardown hook.
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
    if (t === 'fauna') return 'fauna';
    if (t === 'candy_debris') return 'candyDebris';
    if (isKnownBatchedType(obj)) return 'never';
    return 'full';
}

/** The class cached on `userData.__evictionClass` (ChunkStreamer stamps it at spawn), else classify now. */
function resolveEvictionClass(obj: THREE.Object3D): EvictionClass {
    const cached = (obj.userData as Record<string, unknown>).__evictionClass as
        | EvictionClass
        | undefined;
    return cached ?? classifyForEviction(obj);
}

type TeardownClass = Exclude<EvictionClass, 'full' | 'never'>;
type Teardown = (obj: THREE.Object3D, ctx: DespawnContext | undefined) => void;

/**
 * The teardown each batcher-backed class needs beyond leaving its views.
 * Discovery registration is intentionally left in place — the discovery grid
 * (WASM/AS) has no unregister API.
 */
const TEARDOWN: Record<TeardownClass, Teardown> = {
    mushroom: (obj) => mushroomBatcher.removeInstance(obj),
    lantern: (obj) => lanternBatcher.removeInstance(obj),
    glassMushroom: (obj) => glassMushroomBatcher.removeInstance(obj),
    kickDrumGeyser: (obj) => kickDrumGeyserBatcher.removeInstance(obj),
    nightMarketStall: (obj) => nightMarketBatcher.removeInstance(obj),
    cloud: (obj) => {
        if (obj.userData?.isWalkable) {
            CloudBatcher.getWalkableInstance().removeInstance(obj);
            unregisterWalkableCloudPlatform(obj);
            debugHooks.unregisterCloudPlatform(obj);
        } else {
            CloudBatcher.getInstance().removeInstance(obj);
        }
    },
    simpleFlower: (obj) => simpleFlowerBatcher.removeInstance(obj),
    flower: (obj) => flowerBatcher.removeInstance(obj),
    tree: (obj) => {
        treeBatcher.removeInstance(obj);
        // A bubble willow planted by the Gem Canopy decorator (attachGemFruits)
        // owns GemFruitBatcher instances in userData.gemRefs; free them with
        // the tree or they outlive it as floating gems. No-op without refs.
        gemFruitBatcher.removeInstance(obj);
    },
    arpeggioFern: (obj) => arpeggioFernBatcher.removeInstance(obj),
    portamentoPine: (obj) => {
        portamentoPineBatcher.removeInstance(obj);
        // Same for gem-bearing portamento pines (attachGemFruits).
        gemFruitBatcher.removeInstance(obj);
    },
    gemFruit: (obj) => {
        gemFruitBatcher.removeInstance(obj);
        // Also remove the underlying tree
        if (obj.userData?.type === 'gem_canopy_tree') {
            treeBatcher.removeInstance(obj);
        }
    },
    luminousPlant: (obj) => luminousPlantBatcher.removeInstance(obj),
    dandelion: (obj) => dandelionBatcher.removeInstance(obj),
    waterfall: (obj) => waterfallBatcher.removeInstance(obj),
    subwooferLotus: (obj) => subwooferLotusBatcher.removeInstance(obj),
    glowingFlower: (obj) => glowingFlowerBatcher.removeInstance(obj),
    sugarCave: (obj) => sugarCaveBatcher.removeInstance(obj),
    candyDebris: (obj) => {
        if (CandyDebrisBatcher.peekMesh()) CandyDebrisBatcher.getInstance().removeInstance(obj);
    },
    fauna: (obj) => {
        const species = obj.userData?.faunaSpecies as FaunaSpecies | undefined;
        const slot = obj.userData?.slot as number | undefined;
        if (species !== undefined && slot !== undefined) {
            FaunaBatcher.getInstance().removeInstance(species, slot);
        }
    },
    cave: (obj, ctx) => {
        unregisterPhysicsCave(obj);
        ctx?.weatherSystem?.unregisterCave?.(obj);
        if (typeof obj.userData.caveLightHandle === 'string') {
            releaseLocalLight(obj.userData.caveLightHandle);
        }
        waterfallBatcher.remove(obj.uuid);
        obj.userData.waterfallActive = false;
    },
};

/** Registry kind for an eviction class. */
export function evictionKind(evictionClass: EvictionClass): string {
    return `evict:${evictionClass}`;
}

for (const evictionClass of Object.keys(TEARDOWN) as TeardownClass[]) {
    const teardown = TEARDOWN[evictionClass];
    entities.registerKind(evictionKind(evictionClass), {
        onDespawn: (_id, obj, ctx) => teardown(obj, ctx),
    });
}
// No safe removal path: despawn refuses these and leaves them untouched.
entities.registerKind(evictionKind('never'), { pinned: true });

// 'full' entities own nothing outside their views and the scene graph.
entities.registerClassifier((obj) => {
    const evictionClass = resolveEvictionClass(obj);
    return evictionClass === 'full' ? null : evictionKind(evictionClass);
});
