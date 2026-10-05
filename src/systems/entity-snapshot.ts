/**
 * Production wiring for the typed entity-snapshot round-trip.
 *
 * The record/migration logic lives in `entity-snapshot-core.ts` (renderer-free,
 * Node-testable); this module binds it to the real registration path —
 * `processMapEntity` — plus the live foliage registry and the physics grid.
 */

import * as THREE from 'three';
import { create } from '../world/foliage-registry.ts';
import { processMapEntity } from '../world/generation-entities.ts';
import type { WeatherSystem, MapEntity } from '../world/generation-utils.ts';
import { animatedFoliage } from '../world/state.ts';
import { migrateSnapshot, restoreEntityWith, type EntitySnapshot } from './entity-snapshot-core.ts';
import { populatePhysicsGrids } from './physics/index.ts';

export * from './entity-snapshot-core.ts';

/**
 * Restore an entity by feeding its map record back through `processMapEntity`,
 * the same path `map.json` loading uses — no bespoke re-instancing.
 *
 * Returns the objects the registration path created (empty when the entity was
 * skipped, e.g. by a feature flag).
 */
export function restoreEntity(
    snapshot: EntitySnapshot,
    weatherSystem: WeatherSystem | null = null,
    options: { rebuildPhysicsGrid?: boolean } = {}
): THREE.Object3D[] {
    return restoreEntityWith(snapshot, {
        processEntity: (item, weather) =>
            processMapEntity(item as unknown as MapEntity, weather as WeatherSystem),
        weatherSystem,
        registry: animatedFoliage as THREE.Object3D[],
        onCollidersChanged: options.rebuildPhysicsGrid ? () => populatePhysicsGrids() : undefined,
    });
}

/**
 * Restore a batch of snapshots, rebuilding the physics spatial grid once at the
 * end rather than per entity.
 */
export function restoreEntities(
    snapshots: EntitySnapshot[],
    weatherSystem: WeatherSystem | null = null,
    options: { rebuildPhysicsGrid?: boolean } = {}
): THREE.Object3D[] {
    const created: THREE.Object3D[] = [];
    for (const snapshot of snapshots) {
        try {
            created.push(...restoreEntity(migrateSnapshot(snapshot), weatherSystem));
        } catch (err) {
            console.warn('[EntitySnapshot] Failed to restore snapshot:', err);
        }
    }
    if (options.rebuildPhysicsGrid !== false && created.length > 0) populatePhysicsGrids();
    return created;
}

export interface LegacyEntitySnapshot {
    id: string;
    type: string;
    position: [number, number, number];
    rotation: { quat: [number, number, number, number] };
    scale: [number, number, number];
    persistentId?: string;
    variant?: string;
    note?: string;
    noteIndex?: number;
    hasFace?: boolean;
    category?: string;
    layer?: string;
    biome?: string;
    placement?: 'ground' | 'absolute' | 'offset';
    baseOffset?: number;
    music?: {
        biome?: string;
        biomeTag?: string;
        biomeOverride?: string;
        channels?: number[];
        intensityScale?: number;
        trackerChannel?: number;
        reactivityProfile?: string;
        noteColorOverride?: string;
    };
    params?: Record<string, unknown>;
}

const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _worldScale = new THREE.Vector3();

function round(val: number, decimals = 4): number {
    const p = Math.pow(10, decimals);
    return Math.round(val * p) / p;
}

export function exportEntitySnapshot(obj: THREE.Object3D): LegacyEntitySnapshot | null {
    const mapExport = (obj.userData?.mapExport ?? {}) as Record<string, unknown>;

    // Attempt to extract the type
    let mappedType = mapExport.type as string | undefined;
    if (!mappedType) mappedType = obj.userData?.mapEntityType as string | undefined;
    if (!mappedType) mappedType = obj.userData?.type as string | undefined;

    if (!mappedType || typeof mappedType !== 'string') return null;

    obj.getWorldPosition(_worldPos);
    obj.getWorldQuaternion(_worldQuat);
    obj.getWorldScale(_worldScale);

    const snapshot: LegacyEntitySnapshot = {
        id: obj.userData?.mapEntityId || obj.uuid,
        type: mappedType,
        position: [round(_worldPos.x), round(_worldPos.y), round(_worldPos.z)],
        rotation: {
            quat: [
                round(_worldQuat.x, 6),
                round(_worldQuat.y, 6),
                round(_worldQuat.z, 6),
                round(_worldQuat.w, 6),
            ],
        },
        scale: [round(_worldScale.x), round(_worldScale.y), round(_worldScale.z)],
    };

    if (obj.userData?.persistentId) {
        snapshot.persistentId = obj.userData.persistentId;
    }

    if (mapExport.variant || obj.userData?.variant) {
        snapshot.variant = mapExport.variant || obj.userData?.variant;
    }

    if (mapExport.note || obj.userData?.note) {
        snapshot.note = mapExport.note || obj.userData?.note;
    }

    if (mapExport.noteIndex !== undefined || obj.userData?.noteIndex !== undefined) {
        snapshot.noteIndex = mapExport.noteIndex ?? obj.userData?.noteIndex;
    }

    if (mapExport.hasFace !== undefined || obj.userData?.hasFace !== undefined) {
        snapshot.hasFace = mapExport.hasFace ?? obj.userData?.hasFace;
    }

    if (mapExport.category) snapshot.category = mapExport.category as string;
    if (mapExport.layer) snapshot.layer = mapExport.layer as string;
    if (mapExport.biome || obj.userData?.biome)
        snapshot.biome = (mapExport.biome || obj.userData?.biome) as string;
    if (mapExport.placement) snapshot.placement = mapExport.placement as any;
    if (mapExport.baseOffset !== undefined) snapshot.baseOffset = mapExport.baseOffset as number;

    if (mapExport.music || obj.userData?.music) {
        snapshot.music = (mapExport.music || obj.userData?.music) as any;
    }

    if (mapExport.params) {
        snapshot.params = mapExport.params as Record<string, unknown>;
    } else if (obj.userData?.params) {
        snapshot.params = obj.userData.params as Record<string, unknown>;
    }

    return snapshot;
}

export function importEntitySnapshot(
    snapshot: LegacyEntitySnapshot,
    applyToObj?: THREE.Object3D
): THREE.Object3D | null {
    let obj = applyToObj;

    if (!obj) {
        // Prepare spawn parameters
        const params: Record<string, unknown> = { ...(snapshot.params || {}) };
        if (snapshot.variant !== undefined) params.variant = snapshot.variant;
        if (snapshot.note !== undefined) params.note = snapshot.note;
        if (snapshot.noteIndex !== undefined) params.noteIndex = snapshot.noteIndex;
        if (snapshot.hasFace !== undefined) params.hasFace = snapshot.hasFace;
        if (snapshot.persistentId !== undefined) params.persistentId = snapshot.persistentId;

        // Use the uniform scale if it is uniform
        if (snapshot.scale[0] === snapshot.scale[1] && snapshot.scale[1] === snapshot.scale[2]) {
            params.scale = snapshot.scale[0];
        } else {
            params.scale = snapshot.scale;
        }

        const created = create(snapshot.type, params);
        if (!created) {
            return null;
        }
        obj = created;
    }

    // Apply transforms
    obj.position.set(snapshot.position[0], snapshot.position[1], snapshot.position[2]);
    obj.quaternion.set(
        snapshot.rotation.quat[0],
        snapshot.rotation.quat[1],
        snapshot.rotation.quat[2],
        snapshot.rotation.quat[3]
    );
    obj.scale.set(snapshot.scale[0], snapshot.scale[1], snapshot.scale[2]);

    // Apply metadata back to userData
    obj.userData.mapEntityType = snapshot.type;
    obj.userData.mapEntityId = snapshot.id;
    if (snapshot.biome) obj.userData.biome = snapshot.biome;
    if (snapshot.persistentId) obj.userData.persistentId = snapshot.persistentId;
    if (snapshot.note) obj.userData.note = snapshot.note;
    if (snapshot.noteIndex !== undefined) obj.userData.noteIndex = snapshot.noteIndex;
    if (snapshot.hasFace !== undefined) obj.userData.hasFace = snapshot.hasFace;

    if (snapshot.music) {
        if (typeof snapshot.music.trackerChannel === 'number')
            obj.userData.trackerChannel = snapshot.music.trackerChannel;
        if (typeof snapshot.music.reactivityProfile === 'string')
            obj.userData.reactivityProfile = snapshot.music.reactivityProfile;
        if (typeof snapshot.music.intensityScale === 'number')
            obj.userData.reactivityIntensityScale = snapshot.music.intensityScale;
    }

    obj.userData.mapExport = {
        type: snapshot.type,
        sourceId: snapshot.id,
        provenance: 'snapshot',
        variant: snapshot.variant,
        note: snapshot.note,
        noteIndex: snapshot.noteIndex,
        hasFace: snapshot.hasFace,
        category: snapshot.category,
        layer: snapshot.layer,
        biome: snapshot.biome,
        music: snapshot.music,
        placement: snapshot.placement,
        baseOffset: snapshot.baseOffset,
        params: snapshot.params,
    };

    return obj;
}

export function exportWorldSnapshots(objects: THREE.Object3D[]): LegacyEntitySnapshot[] {
    const snapshots: LegacyEntitySnapshot[] = [];
    for (let i = 0; i < objects.length; i++) {
        const snap = exportEntitySnapshot(objects[i]);
        if (snap) {
            snapshots.push(snap);
        }
    }
    return snapshots;
}

export function importWorldSnapshots(snapshots: LegacyEntitySnapshot[]): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (let i = 0; i < snapshots.length; i++) {
        const obj = importEntitySnapshot(snapshots[i]);
        if (obj) {
            objects.push(obj);
        }
    }
    return objects;
}

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
