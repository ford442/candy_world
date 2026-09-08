import { processMapEntity } from '../world/generation-entities.ts';
import type { WeatherSystem, MapEntity } from '../world/generation-utils.ts';
import { migrateSnapshot, type EntitySnapshot } from './entity-snapshot-core.ts';

export * from './entity-snapshot-core.ts';

/**
 * Restores an entity to the world by feeding its map data back into `processMapEntity`.
 */
export function restoreEntity(
    snapshot: EntitySnapshot,
    weatherSystem: WeatherSystem
): void {
    const current = migrateSnapshot(snapshot);
    // processMapEntity expects MapEntity type, which is mostly compatible with CandyMapEntity
    processMapEntity(current.entity as unknown as MapEntity, weatherSystem);
}
