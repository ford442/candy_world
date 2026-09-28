/**
 * @file src/systems/world-commands.ts
 * @brief WorldCommand implementations for authored world edits.
 *
 * Commands spawn through the snapshot restore path (processMapEntity) and
 * despawn through the same teardown ChunkStreamer eviction uses, so an undo
 * leaves no batcher slot, registry entry or collider behind.
 */

import type * as THREE from 'three';
import { canDespawn, despawnEntity } from '../world/entity-despawn.ts';
import { animatedFoliage } from '../world/state.ts';
import type { SerializedWorldCommand, WorldCommand } from './edit-history.ts';
import type { EntitySnapshot } from './entity-snapshot-core.ts';
import { restoreEntity } from './entity-snapshot.ts';
import { populatePhysicsGrids } from './physics/index.ts';

export interface PlaceCommandHooks {
    /** Called after the entity is live (initial place and every redo). */
    onApplied?(objects: THREE.Object3D[], snapshot: EntitySnapshot): void;
    /** Called after the entity is removed (every undo). */
    onReverted?(snapshot: EntitySnapshot): void;
}

/** Live objects stamped with this snapshot id by restoreEntityWith. */
function findLive(id: string): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const obj of animatedFoliage as unknown as THREE.Object3D[]) {
        if (obj?.userData?.mapEntityId === id) out.push(obj);
    }
    return out;
}

/** Place one authored entity described by a snapshot. */
export class PlaceCommand implements WorldCommand {
    constructor(
        readonly snapshot: EntitySnapshot,
        private readonly hooks: PlaceCommandHooks = {}
    ) {}

    apply(): void {
        let objects = findLive(this.snapshot.id);
        if (objects.length === 0) {
            objects = restoreEntity(this.snapshot, null, { rebuildPhysicsGrid: true });
            if (objects.length === 0) {
                throw new Error(`Could not create entity type "${this.snapshot.entity.type}"`);
            }
        }
        this.hooks.onApplied?.(objects, this.snapshot);
    }

    revert(): void {
        const objects = findLive(this.snapshot.id);
        // Check every object before removing any, so a partial undo can't
        // leave half an entity in the world.
        for (const obj of objects) {
            if (!canDespawn(obj)) {
                throw new Error(
                    `"${this.snapshot.entity.type}" has no safe removal path; cannot undo placement`
                );
            }
        }
        for (const obj of objects) despawnEntity(obj);
        if (objects.length > 0) populatePhysicsGrids();
        this.hooks.onReverted?.(this.snapshot);
    }

    serialize(): SerializedWorldCommand {
        return { type: 'place', snapshot: this.snapshot };
    }
}
