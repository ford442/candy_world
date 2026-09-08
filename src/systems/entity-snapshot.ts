import { Entity, Component } from './ecs/types.ts';
import { World } from './ecs/world.ts';

export interface EntitySnapshot {
    entityId: Entity;
    components: Record<string, Component>;
}

/**
 * Creates a snapshot of all components currently attached to an entity.
 *
 * @param world The ECS world instance.
 * @param entity The entity to snapshot.
 * @returns An EntitySnapshot object containing a copy of all component data.
 */
export function createEntitySnapshot(world: World, entity: Entity): EntitySnapshot {
    const components: Record<string, Component> = {};
    const componentNames = Array.from((world as any).entityToIndex.keys()) as string[];

    for (const name of componentNames) {
        if (world.hasComponent(entity, name)) {
            const comp = world.getComponent<Component>(entity, name);
            if (comp) {
                // Deep copy component to prevent mutation from continuing simulation
                components[name] = JSON.parse(JSON.stringify(comp));
            }
        }
    }

    return {
        entityId: entity,
        components
    };
}

/**
 * Restores an entity to the exact state captured in a snapshot.
 * This overrides existing components and adds missing ones from the snapshot.
 *
 * @param world The ECS world instance.
 * @param snapshot The snapshot to restore from.
 * @returns The entity that was restored (same as snapshot.entityId)
 */
export function restoreEntitySnapshot(world: World, snapshot: EntitySnapshot): Entity {
    const entity = snapshot.entityId;

    // Remove components the entity currently has that are NOT in the snapshot
    const currentComponents = Array.from((world as any).entityToIndex.keys()).filter((name) => world.hasComponent(entity, name as string)) as string[];
    for (const name of currentComponents) {
        if (!(name in snapshot.components)) {
            world.removeComponent(entity, name);
        }
    }

    // Add or update components from the snapshot
    for (const [name, data] of Object.entries(snapshot.components)) {
        // We use JSON.parse to ensure we're injecting a fresh copy
        const compData = JSON.parse(JSON.stringify(data));
        world.setComponent(entity, name, compData);
    }

    return entity;
}
