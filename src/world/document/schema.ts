/**
 * @file src/world/document/schema.ts
 * @brief The WorldDocument schema: one versioned record for a player's world.
 *
 * A WorldDocument regenerates the base world from `seed` + `mapVersion`, then
 * replays `commands` (authored edits) on top of it. Progress that used to live
 * in six stores (save slots, discoveries, unlocks, awakened flora, Night Market
 * stamps, the Part II door) lives in `progress`.
 *
 * Runtime validation is valibot; the TS types are inferred from the schemas.
 * Commands are typed by hand because `batch` nests commands, and a recursive
 * valibot schema needs an explicit type. Renderer-free: importable from Node.
 */

import * as v from 'valibot';
import type { EntitySnapshot } from '../../systems/entity-snapshot-types.ts';

/** Bump with a matching hop in `migrations.ts`. */
export const WORLD_DOCUMENT_SCHEMA = 1;

/** A document past these limits is refused at load, not truncated. */
export const MAX_DOCUMENT_COMMANDS = 20_000;
export const MAX_PROGRESS_ENTRIES = 10_000;

export const SEASON_OVERRIDES = ['spring', 'summer', 'autumn', 'winter'] as const;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const Finite = v.pipe(v.number(), v.finite());
const Vec3Schema = v.tuple([Finite, Finite, Finite]);
const IdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
const IdListSchema = v.pipe(v.array(IdSchema), v.maxLength(MAX_PROGRESS_ENTRIES));

/**
 * An entity snapshot as `entity-snapshot-core.ts` writes it. Only the fields
 * replay depends on are checked; the rest of the map record is carried through
 * (`migrateSnapshot` and `processMapEntity` own their own shapes).
 */
export const EntitySnapshotSchema = v.looseObject({
    schemaVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
    id: IdSchema,
    entity: v.looseObject({
        type: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
        position: Vec3Schema,
    }),
}) as unknown as v.GenericSchema<unknown, EntitySnapshot>;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** An authored edit, as `WorldCommand.serialize()` writes it. */
export type DocumentCommand =
    | { type: 'place'; snapshot: EntitySnapshot }
    | { type: 'remove'; snapshot: EntitySnapshot }
    | { type: 'move'; from: EntitySnapshot; to: EntitySnapshot }
    | { type: 'paint'; from: EntitySnapshot; to: EntitySnapshot }
    | { type: 'batch'; label?: string; commands: DocumentCommand[] };

export const DocumentCommandSchema: v.GenericSchema<unknown, DocumentCommand> = v.variant('type', [
    v.object({ type: v.literal('place'), snapshot: EntitySnapshotSchema }),
    v.object({ type: v.literal('remove'), snapshot: EntitySnapshotSchema }),
    v.object({ type: v.literal('move'), from: EntitySnapshotSchema, to: EntitySnapshotSchema }),
    v.object({ type: v.literal('paint'), from: EntitySnapshotSchema, to: EntitySnapshotSchema }),
    v.object({
        type: v.literal('batch'),
        label: v.optional(v.pipe(v.string(), v.maxLength(120))),
        commands: v.pipe(
            v.array(v.lazy(() => DocumentCommandSchema)),
            v.maxLength(MAX_DOCUMENT_COMMANDS)
        ),
    }),
]);

// ---------------------------------------------------------------------------
// Progress, player, meta
// ---------------------------------------------------------------------------

/** One awakened flora instance, keyed by its stable persistent hash. */
export const AwakenedRecordSchema = v.object({
    persistentId: v.pipe(v.number(), v.integer(), v.minValue(0)),
    type: v.pipe(v.string(), v.maxLength(64)),
    biome: v.optional(v.pipe(v.string(), v.maxLength(64))),
    awakenedAt: Finite,
    lastNoteColor: v.optional(Finite),
    emissiveScale: v.optional(Finite),
});

export const PartIIStateSchema = v.object({
    sugarCavesUnlocked: v.boolean(),
});

export const ProgressSchema = v.object({
    discoveries: IdListSchema,
    unlocks: IdListSchema,
    /** Harvested item counts; unlocks are derived from these. */
    inventory: v.record(IdSchema, Finite),
    awakened: v.pipe(v.array(AwakenedRecordSchema), v.maxLength(MAX_PROGRESS_ENTRIES)),
    /** Night Market stall stamps (`night_market_stamp:<stall id>`). */
    stamps: IdListSchema,
    partII: PartIIStateSchema,
});

export const PlayerSchema = v.object({
    position: Vec3Schema,
    yaw: Finite,
    season: v.optional(v.picklist(SEASON_OVERRIDES)),
});

export const MetaSchema = v.object({
    title: v.optional(v.pipe(v.string(), v.maxLength(120))),
    createdAt: Finite,
    updatedAt: Finite,
    author: v.optional(v.pipe(v.string(), v.maxLength(120))),
});

export const WorldDocumentV1Schema = v.object({
    schema: v.literal(WORLD_DOCUMENT_SCHEMA),
    id: IdSchema,
    seed: v.pipe(v.number(), v.integer()),
    mapVersion: v.pipe(v.string(), v.maxLength(64)),
    commands: v.pipe(v.array(DocumentCommandSchema), v.maxLength(MAX_DOCUMENT_COMMANDS)),
    progress: ProgressSchema,
    player: PlayerSchema,
    meta: MetaSchema,
});

export type AwakenedRecord = v.InferOutput<typeof AwakenedRecordSchema>;
export type PartIIState = v.InferOutput<typeof PartIIStateSchema>;
export type DocumentProgress = v.InferOutput<typeof ProgressSchema>;
export type DocumentPlayer = v.InferOutput<typeof PlayerSchema>;
export type DocumentMeta = v.InferOutput<typeof MetaSchema>;
export type SeasonOverride = (typeof SEASON_OVERRIDES)[number];
export type WorldDocumentV1 = v.InferOutput<typeof WorldDocumentV1Schema>;
/** The current document shape. */
export type WorldDocument = WorldDocumentV1;

// ---------------------------------------------------------------------------
// Construction + validation
// ---------------------------------------------------------------------------

/** Random v4 UUID. `randomUUID` needs a secure context; `getRandomValues` does not. */
export function newDocumentId(): string {
    const c = globalThis.crypto;
    if (typeof c.randomUUID === 'function') return c.randomUUID();
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptyProgress(): DocumentProgress {
    return {
        discoveries: [],
        unlocks: [],
        inventory: {},
        awakened: [],
        stamps: [],
        partII: { sugarCavesUnlocked: false },
    };
}

export interface CreateDocumentOptions {
    seed: number;
    mapVersion: string;
    id?: string;
    title?: string;
    now?: number;
}

export function createEmptyDocument(options: CreateDocumentOptions): WorldDocumentV1 {
    const now = options.now ?? Date.now();
    const doc: WorldDocumentV1 = {
        schema: WORLD_DOCUMENT_SCHEMA,
        id: options.id ?? newDocumentId(),
        seed: Math.floor(options.seed),
        mapVersion: options.mapVersion,
        commands: [],
        progress: emptyProgress(),
        player: { position: [0, 0, 0], yaw: 0 },
        meta: { createdAt: now, updatedAt: now },
    };
    if (options.title) doc.meta.title = options.title;
    return doc;
}

/** A load/import failure, with a message fit to show the player. */
export class WorldDocumentError extends Error {
    constructor(
        readonly userMessage: string,
        detail?: string
    ) {
        super(detail ? `${userMessage} (${detail})` : userMessage);
        this.name = 'WorldDocumentError';
    }
}

export type ValidationResult =
    { ok: true; doc: WorldDocumentV1 } | { ok: false; error: WorldDocumentError };

/** Validate a current-schema document. Older schemas go through `parseWorldDocument`. */
export function validateWorldDocument(raw: unknown): ValidationResult {
    const result = v.safeParse(WorldDocumentV1Schema, raw);
    if (result.success) return { ok: true, doc: result.output };
    const issue = result.issues[0];
    const path = v.getDotPath(issue);
    const where = path ? ` at "${path}"` : '';
    return {
        ok: false,
        error: new WorldDocumentError(
            `This world file is damaged or from an unsupported build${where}.`,
            issue.message
        ),
    };
}
