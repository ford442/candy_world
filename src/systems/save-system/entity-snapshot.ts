import { processMapEntity } from '../../world/generation-entities.ts';
import type { MapEntity } from '../../world/generation-utils.ts';
import { animatedFoliage } from '../../world/state.ts';
import { populatePhysicsGrids } from '../physics/index.ts';
import { getWeatherSystem } from '../weather/lazy.ts';
import type { EntitySnapshot } from './save-types.ts';

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

/** save-system EntitySnapshot fields line up 1:1 with MapEntity — this is a reshape, not a data transform. */
function toMapEntity(snapshot: EntitySnapshot): MapEntity {
    return {
        id: snapshot.id,
        type: snapshot.type,
        position: snapshot.position,
        rotation: snapshot.rotation,
        scale: snapshot.scale,
        persistentId: snapshot.persistentId,
        variant: snapshot.variant,
        note: snapshot.note,
        noteIndex: snapshot.noteIndex,
        hasFace: snapshot.hasFace,
        category: snapshot.category,
        layer: snapshot.layer,
        biome: snapshot.biome,
        placement: snapshot.placement as MapEntity['placement'],
        music: snapshot.music as MapEntity['music'],
        params: snapshot.params,
    };
}

/**
 * Respawns dynamic world entities from save-data snapshots via the same
 * processMapEntity() path used for map.json world generation — same factory
 * lookup (foliage-registry.ts), same scene/animatedFoliage/batcher
 * registration (safeAddFoliage), so a restored entity is indistinguishable
 * from one placed at world-gen time.
 */
export function applyEntitySnapshots(snapshots: EntitySnapshot[]): void {
    if (!snapshots || snapshots.length === 0) return;

    const weatherSystem = getWeatherSystem();
    let restored = 0;
    for (const snapshot of snapshots) {
        try {
            processMapEntity(toMapEntity(snapshot), weatherSystem as unknown as Parameters<typeof processMapEntity>[1]);
            restored++;
        } catch (err) {
            console.warn(`[SaveSystem] Failed to restore entity "${snapshot.type}" (id: ${snapshot.id ?? 'none'}):`, err);
        }
    }

    if (restored > 0) populatePhysicsGrids();
    console.warn(`[SaveSystem] Restored ${restored}/${snapshots.length} entities from snapshot.`);
}
