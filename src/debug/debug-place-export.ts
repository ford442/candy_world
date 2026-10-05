/**
 * @file src/debug/debug-place-export.ts
 * @brief `?debugPlace` export: placement deltas → map.json records.
 *
 * Renderer-free so it runs in plain Node. Output is validated with the same
 * `validateMapShape` / `normalizeEntity` pair `loadMap` uses, so a schema
 * change in the loader surfaces here as an export error instead of a map that
 * fails to boot.
 */

import type { EntitySnapshot } from '../systems/entity-snapshot-core.ts';
import { normalizeEntity } from '../world/map-loader-normalize.ts';
import type { CandyMapData, CandyMapEntity } from '../world/map-loader-types.ts';
import { validateMapShape } from '../world/map-loader-validate.ts';

/** The map.json records for a set of placements, sorted by id for stable diffs. */
export function buildDeltaEntities(snapshots: Iterable<EntitySnapshot>): CandyMapEntity[] {
    const out: CandyMapEntity[] = [];
    for (const snap of snapshots) out.push({ ...snap.entity, id: snap.id });
    out.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));
    return out;
}

/** Throws with the loader's message if these records would not load. */
export function validateDeltaEntities(entities: CandyMapEntity[]): void {
    validateMapShape({ entities }, 'debugPlace-delta');
    entities.forEach((entity, i) => normalizeEntity(entity, i));
}

/** Change-detection key for the dirty flag; equal iff the exported deltas are equal. */
export function deltaFingerprint(entities: CandyMapEntity[]): string {
    return JSON.stringify(entities);
}

export interface MergeResult {
    map: CandyMapData;
    added: number;
    replaced: number;
}

/**
 * Merge placement records into a raw (un-normalized) base map: a record whose
 * id already exists replaces it in place, anything else is appended. The base
 * is not mutated. Throws if the result would not pass `loadMap` validation.
 */
export function mergeDeltaIntoMap(base: unknown, delta: CandyMapEntity[]): MergeResult {
    validateMapShape(base, 'debugPlace-base');
    const entities = base.entities.slice();
    const indexById = new Map<string, number>();
    entities.forEach((entity, i) => {
        if (typeof entity.id === 'string') indexById.set(entity.id, i);
    });

    let added = 0;
    let replaced = 0;
    for (const record of delta) {
        const at = record.id !== undefined ? indexById.get(record.id) : undefined;
        if (at !== undefined) {
            entities[at] = record;
            replaced++;
        } else {
            entities.push(record);
            added++;
        }
    }

    const map: CandyMapData = { ...base, entities };
    if (base.metadata && typeof base.metadata.entityCount === 'number') {
        map.metadata = { ...base.metadata, entityCount: entities.length };
    }
    validateMapShape(map, 'debugPlace-export');
    validateDeltaEntities(delta);
    return { map, added, replaced };
}

/** Serialize the way assets/map.json is committed (2-space, trailing newline). */
export function serializeMap(map: CandyMapData): string {
    return JSON.stringify(map, null, 2) + '\n';
}
