/**
 * @file src/systems/world-commands.ts
 * @brief WorldCommand implementations for authored world edits.
 *
 * Commands spawn through the snapshot restore path (processMapEntity) and
 * despawn through the same teardown ChunkStreamer eviction uses, so an undo
 * leaves no batcher slot, registry entry or collider behind.
 */

import type * as THREE from 'three';
import { claimAuthoredEntity } from '../world/authored-entities.ts';
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
        claimAuthoredEntity(this.snapshot.id);
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
        claimAuthoredEntity(this.snapshot.id);
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

/**
 * Recolour an entity: `to` is `from` with a new `entity.params.color` (a hex
 * from `CANDY_PAINT_PALETTE` in `systems/authoring/palette.ts`).
 * Re-placed like a move, because batchers bake colour at registration.
 */
export class PaintCommand implements WorldCommand {
    private readonly swap: MoveCommand;

    constructor(
        readonly from: EntitySnapshot,
        readonly to: EntitySnapshot,
        hooks: PlaceCommandHooks = {}
    ) {
        this.swap = new MoveCommand(from, to, hooks);
    }

    apply(): void {
        this.swap.apply();
    }

    revert(): void {
        this.swap.revert();
    }

    serialize(): SerializedWorldCommand {
        return { type: 'paint', from: this.from, to: this.to };
    }
}

/**
 * Several commands as one undo step (multi-select edits). All or nothing: if a
 * child fails, the children already done are rolled back before rethrowing.
 */
export class BatchCommand implements WorldCommand {
    constructor(
        readonly commands: readonly WorldCommand[],
        readonly label?: string
    ) {}

    apply(): void {
        BatchCommand.run(this.commands, 'apply', 'revert');
    }

    revert(): void {
        BatchCommand.run([...this.commands].reverse(), 'revert', 'apply');
    }

    private static run(
        list: readonly WorldCommand[],
        op: 'apply' | 'revert',
        undoOp: 'apply' | 'revert'
    ): void {
        for (let i = 0; i < list.length; i++) {
            try {
                list[i][op]();
            } catch (err) {
                for (let j = i - 1; j >= 0; j--) {
                    try {
                        list[j][undoOp]();
                    } catch (rollbackErr) {
                        console.warn('[BatchCommand] Rollback step failed:', rollbackErr);
                    }
                }
                throw err;
            }
        }
    }

    serialize(): SerializedWorldCommand {
        const commands: SerializedWorldCommand[] = [];
        for (const cmd of this.commands) {
            const data = cmd.serialize();
            if (data) commands.push(data);
        }
        const out: SerializedWorldCommand = { type: 'batch', commands };
        if (this.label) out.label = this.label;
        return out;
    }
}

function asSnapshot(value: unknown, field: string): EntitySnapshot {
    if (!value || typeof value !== 'object') {
        throw new Error(`Serialized command is missing "${field}"`);
    }
    return value as EntitySnapshot;
}

/**
 * Rebuild a command from `serialize()` output (a WorldDocument's command log).
 * Shapes are validated by the document schema before they get here.
 */
export function deserializeWorldCommand(
    data: SerializedWorldCommand,
    hooks: PlaceCommandHooks = {}
): WorldCommand {
    switch (data.type) {
        case 'place':
            return new PlaceCommand(asSnapshot(data.snapshot, 'snapshot'), hooks);
        case 'remove':
            return new RemoveCommand(asSnapshot(data.snapshot, 'snapshot'), hooks);
        case 'move':
            return new MoveCommand(asSnapshot(data.from, 'from'), asSnapshot(data.to, 'to'), hooks);
        case 'paint':
            return new PaintCommand(
                asSnapshot(data.from, 'from'),
                asSnapshot(data.to, 'to'),
                hooks
            );
        case 'batch': {
            const children = Array.isArray(data.commands) ? data.commands : [];
            return new BatchCommand(
                children.map((c) => deserializeWorldCommand(c as SerializedWorldCommand, hooks)),
                typeof data.label === 'string' ? data.label : undefined
            );
        }
        default:
            throw new Error(`Unknown world command type "${String(data.type)}"`);
    }
}
