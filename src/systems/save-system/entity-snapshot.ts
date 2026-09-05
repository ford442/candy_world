import * as THREE from 'three';
import { animatedFoliage } from '../../world/state.ts';
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

/**
 * Placeholder minimal loader logic. A future editor or reload system
 * will iterate over these snapshots to rebuild the scene accurately.
 */
export function applyEntitySnapshots(snapshots: EntitySnapshot[]): void {
    if (!snapshots || snapshots.length === 0) return;
    console.log(`[SaveSystem] applyEntitySnapshots received ${snapshots.length} entities to restore.`);
    // TODO: Connect this to the actual procedural generation / batcher pipeline
    // to respawn entities from snapshots. Currently a no-op as the scene
    // re-generates via deterministic map.json and seeds on load.
}
