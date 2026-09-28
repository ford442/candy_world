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

/** Remove one authored entity: the inverse of PlaceCommand, same hooks. */
export class RemoveCommand implements WorldCommand {
    private readonly place: PlaceCommand;

    constructor(
        readonly snapshot: EntitySnapshot,
        hooks: PlaceCommandHooks = {}
    ) {
        this.place = new PlaceCommand(snapshot, hooks);
    }

    apply(): void {
        this.place.revert();
    }

    revert(): void {
        this.place.apply();
    }

    serialize(): SerializedWorldCommand {
        return { type: 'remove', snapshot: this.snapshot };
    }
}

/**
 * Move an authored entity by despawning `from` and placing `to` (same id,
 * new transform). Re-placing through processMapEntity re-runs grounding and
 * batcher registration, which an in-place transform write would skip.
 */
export class MoveCommand implements WorldCommand {
    private readonly fromCmd: PlaceCommand;
    private readonly toCmd: PlaceCommand;

    constructor(
        readonly from: EntitySnapshot,
        readonly to: EntitySnapshot,
        hooks: PlaceCommandHooks = {}
    ) {
        if (from.id !== to.id) throw new Error('MoveCommand requires matching snapshot ids');
        this.fromCmd = new PlaceCommand(from, hooks);
        this.toCmd = new PlaceCommand(to, hooks);
    }

    apply(): void {
        MoveCommand.swap(this.fromCmd, this.toCmd);
    }

    revert(): void {
        MoveCommand.swap(this.toCmd, this.fromCmd);
    }

    /** Remove `out`, place `in`; if placing fails, put `out` back before rethrowing. */
    private static swap(out: PlaceCommand, into: PlaceCommand): void {
        out.revert();
        try {
            into.apply();
        } catch (err) {
            out.apply();
            throw err;
        }
    }

    serialize(): SerializedWorldCommand {
        return { type: 'move', from: this.from, to: this.to };
    }
}
