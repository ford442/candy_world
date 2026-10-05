cat << 'INNER_EOF' >> src/systems/entity-snapshot.ts

// ---------------------------------------------------------
// Helper for in-world authoring (Phase 0: Undo/Redo Eviction)
// ---------------------------------------------------------
import { arpeggioFernBatcher } from '../foliage/arpeggio-batcher.ts';
import { flowerBatcher } from '../foliage/flower-batcher.ts';
import { glassMushroomBatcher } from '../foliage/glass-mushroom-batcher.ts';
import { lanternBatcher } from '../foliage/lantern-batcher.ts';
import { mushroomBatcher } from '../foliage/mushroom-batcher/index.ts';
import { portamentoPineBatcher } from '../foliage/portamento-batcher.ts';
import { simpleFlowerBatcher } from '../foliage/simple-flower-batcher.ts';
import { treeBatcher } from '../foliage/tree-batcher/index.ts';
import { gemFruitBatcher } from '../foliage/gem-fruit-batcher.ts';
import { luminousPlantBatcher } from '../foliage/luminous-plant-batcher.ts';
import { dandelionBatcher } from '../foliage/dandelion-batcher.ts';
import { waterfallBatcher } from '../foliage/waterfall-batcher.ts';
import { subwooferLotusBatcher } from '../foliage/subwoofer-lotus-batcher.ts';
import { glowingFlowerBatcher } from '../foliage/glowing-flower-batcher.ts';
import { sugarCaveBatcher } from '../foliage/sugar-cave-batcher.ts';
import { kickDrumGeyserBatcher } from '../foliage/kick-drum-geyser-batcher.ts';
import { nightMarketBatcher } from '../foliage/night-market-batcher.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { unregisterPhysicsCave } from '../systems/physics/index.ts';

export function findLiveByMapEntityId(id: string): THREE.Object3D | null {
    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i] as THREE.Object3D;
        if (obj.userData?.mapEntityId === id) {
            return obj;
        }
    }
    return null;
}

export function removeLiveEntity(obj: THREE.Object3D): boolean {
    const idx = animatedFoliage.indexOf(obj);
    if (idx === -1) return false;

    const t = obj.userData?.type;
    let evictionClass = 'full';

    if (t === 'tree' && obj.userData?.animationType === 'batchedPortamento') {
        evictionClass = 'portamentoPine';
    } else if (
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
        evictionClass = 'tree';
    } else if (t === 'gem_canopy_tree') evictionClass = 'gemFruit';
    else if (t === 'mushroom') evictionClass = 'mushroom';
    else if (t === 'lanternFlower') evictionClass = 'lantern';
    else if (t === 'glass_mushroom') evictionClass = 'glassMushroom';
    else if (t === 'flower') evictionClass = 'flower';
    else if (t === 'simple_flower' || (obj.userData?.isFlower && t !== 'flower')) evictionClass = 'simpleFlower';
    else if (t === 'fern' || t === 'arpeggio_fern') evictionClass = 'arpeggioFern';
    else if (t === 'cave') evictionClass = 'cave';
    else if (t === 'kick_drum_geyser') evictionClass = 'kickDrumGeyser';
    else if (t === 'luminous_plant') evictionClass = 'luminousPlant';
    else if (t === 'dandelion') evictionClass = 'dandelion';
    else if (t === 'waterfall') evictionClass = 'waterfall';
    else if (t === 'subwoofer_lotus') evictionClass = 'subwooferLotus';
    else if (t === 'glowing_flower') evictionClass = 'glowingFlower';
    else if (t === 'sugar_cave') evictionClass = 'sugarCave';
    else if (t === 'night_market_stall') evictionClass = 'nightMarketStall';

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
    }

    if (t === 'cave' || t === 'sugar_cave') {
        unregisterPhysicsCave(obj);
    }

    animatedFoliage.splice(idx, 1);

    if (obj.parent) {
        safeRemoveAndDispose(obj.parent, obj);
    }
    return true;
}
INNER_EOF
