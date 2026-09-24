/**
 * Save-file bridge for the typed entity-snapshot round trip.
 *
 * A save stores a DIFF over the generated world, not a copy of it: only
 * authored entities (placed via `?debugPlace` or restored from a snapshot —
 * anything stamped by `markAuthoredTransform`) are written. Generated content
 * is rebuilt from `map.json` + seed on every boot, so saving it would duplicate
 * the whole map on reload.
 *
 * The record format, migrations and restore path are the ones in
 * `../entity-snapshot.ts`; this module only decides WHAT to save and reconciles
 * a loaded save against the live world.
 */

import type * as THREE from 'three';
import type { WeatherSystem } from '../../world/generation-utils.ts';
import { animatedFoliage } from '../../world/state.ts';
import {
    getAuthoredTransform,
    migrateSnapshot,
    restoreEntity,
    snapshotEntity,
    type EntitySnapshot,
} from '../entity-snapshot.ts';
import { populatePhysicsGrids } from '../physics/index.ts';

export interface ApplyEntitySnapshotsResult {
    /** Snapshots that created new live objects. */
    restored: number;
    /** Snapshots whose id was already live — left untouched (load is idempotent). */
    alreadyLive: number;
    /** Malformed, future-version, unknown-type or flag-gated records. */
    skipped: number;
}

function liveEntityId(obj: THREE.Object3D): string | undefined {
    const id = obj?.userData?.mapEntityId;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Snapshot every authored entity in the live world.
 *
 * One logical entity can register several objects (all sharing its id); only
 * the first is recorded, since restoring it recreates the rest.
 */
export function serializeEntitySnapshots(): EntitySnapshot[] {
    const snapshots: EntitySnapshot[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i] as THREE.Object3D;
        if (!obj || !getAuthoredTransform(obj)) continue;

        const id = liveEntityId(obj);
        if (id) {
            if (seen.has(id)) continue;
            seen.add(id);
        }

        const snapshot = snapshotEntity(obj, id ? { id } : undefined);
        if (snapshot) snapshots.push(snapshot);
    }

    return snapshots;
}

/**
 * Restore saved authored entities through the same registration path
 * `map.json` uses (`processMapEntity`), so batched species land in their
 * batcher with a live instance slot and stay evictable by `ChunkStreamer`.
 *
 * Additive and idempotent: an entity whose id is already live is left alone,
 * so loading the same save twice does not duplicate it. Records that cannot be
 * restored — pre-v2 flat records from older builds, future versions, unknown
 * types — are skipped and reported in ONE summary warning; this never throws.
 */
export function applyEntitySnapshots(
    snapshots: readonly unknown[] | null | undefined,
    weatherSystem: WeatherSystem | null = null
): ApplyEntitySnapshotsResult {
    const result: ApplyEntitySnapshotsResult = { restored: 0, alreadyLive: 0, skipped: 0 };
    if (!Array.isArray(snapshots) || snapshots.length === 0) return result;

    const live = new Set<string>();
    for (let i = 0; i < animatedFoliage.length; i++) {
        const id = liveEntityId(animatedFoliage[i] as THREE.Object3D);
        if (id) live.add(id);
    }

    const reasons = new Map<string, number>();
    const skip = (reason: string) => {
        result.skipped++;
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    };

    for (const raw of snapshots) {
        let snapshot: EntitySnapshot;
        try {
            snapshot = migrateSnapshot(raw);
        } catch (err) {
            skip(
                err instanceof Error
                    ? err.message.replace(/^\[EntitySnapshot\] /, '')
                    : 'invalid record'
            );
            continue;
        }

        if (live.has(snapshot.id)) {
            result.alreadyLive++;
            continue;
        }

        try {
            const created = restoreEntity(snapshot, weatherSystem);
            if (created.length === 0) {
                skip(`no object created for type "${snapshot.entity.type}"`);
                continue;
            }
            live.add(snapshot.id);
            result.restored++;
        } catch {
            skip(`restore failed for type "${snapshot.entity.type}"`);
        }
    }

    if (result.restored > 0) populatePhysicsGrids();

    if (result.skipped > 0) {
        const detail = [...reasons].map(([reason, n]) => `${n}× ${reason}`).join('; ');
        console.warn(
            `[SaveSystem] Restored ${result.restored} entities, skipped ${result.skipped}: ${detail}`
        );
    }

    return result;
}
