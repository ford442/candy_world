// src/world/entity-despawn.ts
// Single teardown path for a live map entity: its registry kinds (views and
// teardown hooks) and the scene graph. Shared by ChunkStreamer eviction and
// edit-history undo so both remove exactly the same things.
//
// Kind-agnostic: what a kind frees is that kind's onDespawn hook, registered
// where the kind is (batcher teardown: generation-entity-kinds.ts).
import type * as THREE from 'three';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import type { WeatherSystem } from './generation-utils.ts';
// Registers the teardown kinds before anything can be despawned.
import './generation-entity-kinds.ts';
import { entities, foliageGroup } from './state.ts';

const DESPAWNED_KEY = '__despawned';

/** True once despawnEntity has torn this object down (a second teardown would corrupt its batcher). */
export function isDespawned(obj: THREE.Object3D): boolean {
    return (obj?.userData as Record<string, unknown> | undefined)?.[DESPAWNED_KEY] === true;
}

/** True when despawnEntity can remove this object without corrupting a batcher. */
export function canDespawn(obj: THREE.Object3D): boolean {
    return entities.canDespawn(obj);
}

/**
 * Remove a live entity from every registry kind (running each kind's
 * teardown hook) and from the scene, disposing its resources.
 *
 * Returns false — and touches nothing — for objects in a pinned kind, which
 * have no safe removal path. Does NOT rebuild the physics grid; callers batch that.
 */
export function despawnEntity(obj: THREE.Object3D, weatherSystem?: WeatherSystem | null): boolean {
    if (isDespawned(obj)) return true;
    if (!entities.canDespawn(obj)) return false;
    entities.despawn(entities.adopt(obj), undefined, { weatherSystem });
    safeRemoveAndDispose(foliageGroup, obj);
    (obj.userData as Record<string, unknown>)[DESPAWNED_KEY] = true;
    return true;
}
