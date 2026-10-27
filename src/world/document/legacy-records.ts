/**
 * @file src/world/document/legacy-records.ts
 * @brief Normalizers from the pre-WorldDocument record shapes.
 *
 * Shared by the 0 → 1 migration hop (a legacy save-slot export) and the
 * one-shot importer that reads the six legacy stores. Pure and renderer-free.
 */

import {
    computePersistentId,
    persistentIdFromString,
} from '../../systems/awakened-persistent-id.ts';
import {
    CURRENT_SNAPSHOT_VERSION,
    migrateSnapshot,
    type EntitySnapshot,
} from '../../systems/entity-snapshot-core.ts';
import type { AwakenedRecord, DocumentCommand } from './schema.ts';

/**
 * Discovery ids with this prefix are Night Market stamps. Must equal
 * `NIGHT_MARKET_STAMP_PREFIX` in `systems/night-market-stamps.ts` (asserted by
 * tests/world-document.test.ts); that module pulls in a batcher, so it is not
 * imported here.
 */
export const STAMP_PREFIX = 'night_market_stamp:';

/** Default awakened glow, as `awakened-types.ts` DEFAULT_AWAKENED_EMISSIVE_SCALE. */
const DEFAULT_EMISSIVE_SCALE = 1.35;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Unique non-empty strings, first-seen order. */
export function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item === 'string' && item.length > 0 && item.length <= 128) seen.add(item);
    }
    return [...seen];
}

/** Split discovery ids into plain discoveries and Night Market stamps. */
export function splitStamps(ids: readonly string[]): { discoveries: string[]; stamps: string[] } {
    const discoveries: string[] = [];
    const stamps: string[] = [];
    for (const id of ids) (id.startsWith(STAMP_PREFIX) ? stamps : discoveries).push(id);
    return { discoveries, stamps };
}

/** `{x, y, z}` (save files) or `[x, y, z]` (snapshots) to a tuple; null when neither. */
export function vec3From(value: unknown): [number, number, number] | null {
    if (Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(n))) {
        return [value[0], value[1], value[2]];
    }
    if (isRecord(value)) {
        const { x, y, z } = value;
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            return [x as number, y as number, z as number];
        }
    }
    return null;
}

/** A string awakened key to its hash, as `normalizeLegacyState` in awakened-persistence.ts. */
function persistentIdFromKey(key: string, type: string): number {
    if (/^\d+$/.test(key)) return Number(key) >>> 0;
    if (key.startsWith('pos_')) {
        const [, xs, zs] = key.split('_');
        const x = Number(xs);
        const z = Number(zs);
        if (!Number.isNaN(x) && !Number.isNaN(z)) return computePersistentId(x / 10, z / 10, type);
    }
    return persistentIdFromString(key);
}

/**
 * Awakened entries in any shape the awakened store has written: save-file
 * `AwakenedFloraState` (`persistentId` / numeric-string `entityId`) and the
 * compact localStorage payload (`{ id, t, b, at, c, e }`). Unreadable entries
 * are dropped; duplicates keep the earliest `awakenedAt`.
 */
export function normalizeAwakened(raw: unknown, now: number): AwakenedRecord[] {
    if (!Array.isArray(raw)) return [];
    const byId = new Map<number, AwakenedRecord>();
    for (const entry of raw) {
        if (!isRecord(entry)) continue;
        const type = typeof entry.type === 'string' ? entry.type : entry.t;
        let id: number | null = null;
        if (Number.isInteger(entry.persistentId)) id = (entry.persistentId as number) >>> 0;
        else if (Number.isInteger(entry.id)) id = (entry.id as number) >>> 0;
        else {
            const key = typeof entry.entityId === 'string' ? entry.entityId : entry.id;
            if (typeof key === 'string' && key.length > 0) {
                id = persistentIdFromKey(key, typeof type === 'string' ? type : 'unknown');
            }
        }
        if (id === null) continue;

        const biome = typeof entry.biome === 'string' ? entry.biome : entry.b;
        const record: AwakenedRecord = {
            persistentId: id,
            type: typeof type === 'string' && type.length > 0 ? type.slice(0, 64) : 'unknown',
            awakenedAt: finiteOr(entry.awakenedAt ?? entry.at ?? entry.lastAwakenedTimestamp, now),
            emissiveScale: finiteOr(entry.emissiveScale ?? entry.e, DEFAULT_EMISSIVE_SCALE),
        };
        if (typeof biome === 'string') record.biome = biome.slice(0, 64);
        const color = entry.lastNoteColor ?? entry.c;
        if (typeof color === 'number' && Number.isFinite(color)) record.lastNoteColor = color;

        const existing = byId.get(id);
        if (!existing || record.awakenedAt < existing.awakenedAt) byId.set(id, record);
    }
    return [...byId.values()];
}

/** Snapshots to `place` commands; pre-v2 flat records and unreadable ones are dropped. */
export function snapshotsToPlaceCommands(raw: unknown): {
    commands: DocumentCommand[];
    skipped: number;
} {
    const commands: DocumentCommand[] = [];
    let skipped = 0;
    if (!Array.isArray(raw)) return { commands, skipped };
    const seen = new Set<string>();
    for (const entry of raw) {
        // A flat pre-v2 record has `type` at the top level and no `entity`.
        if (!isRecord(entry) || !isRecord(entry.entity)) {
            skipped++;
            continue;
        }
        let snapshot: EntitySnapshot;
        try {
            snapshot = migrateSnapshot(entry);
        } catch {
            skipped++;
            continue;
        }
        if (
            snapshot.schemaVersion !== CURRENT_SNAPSHOT_VERSION ||
            typeof snapshot.entity.type !== 'string' ||
            !vec3From(snapshot.entity.position) ||
            seen.has(snapshot.id)
        ) {
            skipped++;
            continue;
        }
        seen.add(snapshot.id);
        commands.push({ type: 'place', snapshot });
    }
    return { commands, skipped };
}

/** Numeric item counts only. */
export function inventoryFrom(value: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    if (!isRecord(value)) return out;
    for (const key in value) {
        const n = value[key];
        if (key.length > 0 && key.length <= 128 && typeof n === 'number' && Number.isFinite(n)) {
            out[key] = n;
        }
    }
    return out;
}
