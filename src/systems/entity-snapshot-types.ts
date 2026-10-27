/**
 * @file src/systems/entity-snapshot-types.ts
 * @brief The `EntitySnapshot` shape on its own, with no runtime imports.
 *
 * `entity-snapshot-core.ts` re-exports these. The WorldDocument schema and
 * the shared-world validator import them from here, so their type graph stops
 * at plain data (the `validate-world` edge function type-checks it in Deno
 * without three.js).
 */

import type { CandyMapEntity } from '../world/map-loader-types.ts';

/** Authored animation metadata that survives the map.json round-trip. */
export interface EntitySnapshotUserData {
    animationType?: string;
    animationOffset?: number;
    animationSpeed?: number;
}

export interface EntitySnapshot {
    /** Integer; stamped to CURRENT only after migration. */
    schemaVersion: number;
    /** Stable, generated at snapshot time — never the position hash. */
    id: string;
    /** The canonical map.json record. */
    entity: CandyMapEntity;
    userData?: EntitySnapshotUserData;
    /** Biome / music-binding tags, sorted and de-duplicated. */
    tags?: string[];
    /** awakened-persistence position hash — legacy lookup of pre-existing flora only. */
    legacyPositionHash?: string;
}
