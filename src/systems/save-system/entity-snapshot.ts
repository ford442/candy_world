import { animatedFoliage } from '../../world/state.ts';
import type { EntitySnapshot } from './save-types.ts';
import { processMapEntity } from '../../world/generation-entities.ts';
import type { MapEntity } from '../../world/generation-utils.ts';
import { populatePhysicsGrids } from '../physics/index.ts';

/**
 * Serializes all dynamic world objects into snapshots that can be safely
 * saved and later restored or exported to a level editor.
 * Skips complex internal representations (like TSL materials or Physics rigid bodies).
 */
export function serializeEntitySnapshots(): EntitySnapshot[] {
    const snapshots: EntitySnapshot[] = [];

    // animatedFoliage tracks individual spawned entities that might have mapExport metadata
    for (const obj of animatedFoliage) {
        if (!obj || !obj.userData) continue;

        // We rely on the mapExport structure injected during processMapEntity
        // For objects created dynamically at runtime, we might need a fallback,
        // but for now we focus on capturing what has metadata.
        const meta = obj.userData.mapExport;
        if (!meta) continue;

        // Ensure we record the current dynamic position/rotation/scale
        const pos = obj.position;
        const position: [number, number, number] = [pos.x, pos.y, pos.z];

        const quat = obj.quaternion;
        const rotation: [number, number, number, number] = [quat.x, quat.y, quat.z, quat.w];

        let scale: number | [number, number, number];
        if (Math.abs(obj.scale.x - obj.scale.y) < 0.001 && Math.abs(obj.scale.x - obj.scale.z) < 0.001) {
            scale = obj.scale.x;
        } else {
            scale = [obj.scale.x, obj.scale.y, obj.scale.z];
        }

        const snapshot: EntitySnapshot = {
            id: meta.sourceId || obj.userData.mapEntityId,
            type: meta.type || obj.userData.mapEntityType || 'unknown',
            position,
            rotation,
            scale,
            persistentId: obj.userData.persistentId,
            variant: meta.variant,
            note: meta.note,
            noteIndex: meta.noteIndex,
            hasFace: meta.hasFace,
            category: meta.category,
            layer: meta.layer,
            biome: meta.biome || obj.userData.biome,
            music: meta.music,
            placement: meta.placement,
            params: meta.params
        };

        snapshots.push(snapshot);
    }

    return snapshots;
}

/**
 * Restores a batch of snapshots into the world via the standard map population path
 * (`processMapEntity`). Connects the raw loaded JSON data to the robust generation
 * path, which handles validation, map metadata injection, and instancing. Rebuilds
 * the physics grid exactly once at the end.
 */
export function applyEntitySnapshots(snapshots: EntitySnapshot[]): void {
    if (!snapshots || snapshots.length === 0) return;
    console.log(`[SaveSystem] applyEntitySnapshots restoring ${snapshots.length} entities...`);

    let processedCount = 0;

    for (const snap of snapshots) {
        try {
            // Map the save format snapshot to MapEntity
            const item: MapEntity = {
                id: snap.id,
                type: snap.type,
                position: snap.position,
                rotation: snap.rotation ? { quat: snap.rotation } : undefined,
                scale: snap.scale,
                persistentId: snap.persistentId,
                variant: snap.variant,
                note: snap.note,
                noteIndex: snap.noteIndex,
                hasFace: snap.hasFace,
                category: snap.category,
                layer: snap.layer,
                biome: snap.biome,
                music: snap.music,
                placement: snap.placement as any,
                params: snap.params
            };

            processMapEntity(item, null as any);
            processedCount++;
        } catch (err) {
            console.warn(`[SaveSystem] applyEntitySnapshots: Failed to restore snapshot ${snap.id || 'unknown'} (type: ${snap.type}). Skipping.`, err);
        }
    }

    // Rebuild physics grid exactly once after all entities have been processed.
    if (processedCount > 0) {
        populatePhysicsGrids();
    }
}
