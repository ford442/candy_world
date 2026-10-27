/**
 * @file src/world/document/migrations.ts
 * @brief Ordered WorldDocument migrations: schema N → N+1, one hop at a time.
 *
 * Same idiom as `MigrationSystem.registerMigration` in save-database.ts, keyed
 * by integer schema instead of semver. Each hop gets a unit test
 * (tests/world-document.test.ts). Schema 0 is the pre-document save-slot
 * export (`SaveData`, `metadata.version` 1.0.0), so an old exported save file
 * still imports.
 */

import { DEFAULT_MAP_VERSION, DEFAULT_WORLD_SEED } from '../world-seed.ts';
import {
    inventoryFrom,
    normalizeAwakened,
    snapshotsToPlaceCommands,
    splitStamps,
    stringList,
    vec3From,
} from './legacy-records.ts';
import {
    WORLD_DOCUMENT_SCHEMA,
    WorldDocumentError,
    newDocumentId,
    validateWorldDocument,
    type WorldDocumentV1,
} from './schema.ts';

type RawDocument = Record<string, unknown>;

/** What a hop may need that the old record doesn't carry. */
export interface MigrationContext {
    seed: number;
    mapVersion: string;
    now: number;
}

/** Takes a document at schema N, returns it at schema N + 1. */
export type DocumentMigration = (doc: RawDocument, ctx: MigrationContext) => RawDocument;

const _migrations = new Map<number, DocumentMigration>();

export function registerDocumentMigration(fromSchema: number, fn: DocumentMigration): void {
    _migrations.set(fromSchema, fn);
}

function isRecord(value: unknown): value is RawDocument {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Schema of a raw record: its `schema` field, or 0 for a legacy save-slot
 * export. Throws a WorldDocumentError for anything else.
 */
export function detectSchema(raw: unknown): number {
    if (!isRecord(raw)) {
        throw new WorldDocumentError("This file isn't a Candy World world.");
    }
    if (typeof raw.schema === 'number' && Number.isInteger(raw.schema)) return raw.schema;
    const meta = raw.metadata;
    if (isRecord(meta) && typeof meta.version === 'string' && isRecord(raw.player)) return 0;
    throw new WorldDocumentError("This file isn't a Candy World world.");
}

/** Run every hop from the record's schema up to the current one. */
export function migrateWorldDocument(
    raw: unknown,
    ctx: Partial<MigrationContext> = {}
): { doc: RawDocument; fromSchema: number } {
    const full: MigrationContext = {
        seed: ctx.seed ?? DEFAULT_WORLD_SEED,
        mapVersion: ctx.mapVersion ?? DEFAULT_MAP_VERSION,
        now: ctx.now ?? Date.now(),
    };
    const fromSchema = detectSchema(raw);
    if (fromSchema > WORLD_DOCUMENT_SCHEMA) {
        throw new WorldDocumentError(
            'This world was saved by a newer version of Candy World. Update the game to open it.',
            `schema ${fromSchema} > ${WORLD_DOCUMENT_SCHEMA}`
        );
    }
    if (fromSchema < 0) {
        throw new WorldDocumentError(
            "This file isn't a Candy World world.",
            `schema ${fromSchema}`
        );
    }
    let doc = { ...(raw as RawDocument) };
    for (let schema = fromSchema; schema < WORLD_DOCUMENT_SCHEMA; schema++) {
        const hop = _migrations.get(schema);
        if (!hop) {
            throw new WorldDocumentError(
                'This world is too old to open in this version of Candy World.',
                `no migration from schema ${schema}`
            );
        }
        doc = hop(doc, full);
        doc.schema = schema + 1;
    }
    return { doc, fromSchema };
}

export type ParseResult =
    | { ok: true; doc: WorldDocumentV1; fromSchema: number }
    | { ok: false; error: WorldDocumentError };

/**
 * The single entry point for untrusted input (IndexedDB, an imported file, a
 * future remote store): migrate to the current schema, then validate.
 */
export function parseWorldDocument(raw: unknown, ctx: Partial<MigrationContext> = {}): ParseResult {
    let migrated: { doc: RawDocument; fromSchema: number };
    try {
        migrated = migrateWorldDocument(raw, ctx);
    } catch (err) {
        if (err instanceof WorldDocumentError) return { ok: false, error: err };
        return {
            ok: false,
            error: new WorldDocumentError(
                "This world couldn't be upgraded to the current version.",
                err instanceof Error ? err.message : String(err)
            ),
        };
    }
    const result = validateWorldDocument(migrated.doc);
    return result.ok ? { ok: true, doc: result.doc, fromSchema: migrated.fromSchema } : result;
}

// ---------------------------------------------------------------------------
// 0 → 1: a save-slot export (`SaveData`) becomes a document.
// ---------------------------------------------------------------------------

/**
 * Authored entities (`world.entitySnapshots`) become `place` commands;
 * discoveries split into discoveries + Night Market stamps; abilities join the
 * unlock list. A save never recorded the seed or the Part II door, so the
 * seed comes from the context and the door starts closed (the legacy importer
 * reads the door's own key).
 */
export function migrateLegacySave(save: RawDocument, ctx: MigrationContext): RawDocument {
    const meta = isRecord(save.metadata) ? save.metadata : {};
    const player = isRecord(save.player) ? save.player : {};
    const world = isRecord(save.world) ? save.world : {};
    const progress = isRecord(save.progress) ? save.progress : {};

    const split = splitStamps(stringList(progress.discoveredEntities));
    const unlocks = stringList([
        ...stringList(progress.unlocks),
        ...stringList(player.unlockedAbilities),
    ]);
    const timestamp =
        typeof meta.timestamp === 'number' && Number.isFinite(meta.timestamp)
            ? meta.timestamp
            : ctx.now;
    const rotation = isRecord(player.rotation) ? player.rotation : {};
    const slotId = typeof meta.slotId === 'string' ? meta.slotId.replace(/[^\w-]/g, '') : '';

    const doc: RawDocument = {
        schema: 0,
        id: slotId ? `legacy-save-${slotId}` : newDocumentId(),
        seed: ctx.seed,
        mapVersion: ctx.mapVersion,
        commands: snapshotsToPlaceCommands(world.entitySnapshots).commands,
        progress: {
            discoveries: split.discoveries,
            unlocks,
            inventory: inventoryFrom(progress.inventory),
            awakened: normalizeAwakened(progress.awakenedFlora, ctx.now),
            stamps: split.stamps,
            partII: { sugarCavesUnlocked: false },
        },
        player: {
            position: vec3From(player.position) ?? [0, 0, 0],
            yaw: typeof rotation.y === 'number' && Number.isFinite(rotation.y) ? rotation.y : 0,
        },
        meta: { createdAt: timestamp, updatedAt: timestamp },
    };
    if (typeof meta.slotName === 'string' && meta.slotName.length > 0) {
        (doc.meta as RawDocument).title = meta.slotName.slice(0, 120);
    }
    return doc;
}

registerDocumentMigration(0, migrateLegacySave);
