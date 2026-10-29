/**
 * @file src/world/document/shared-validation.ts
 * @brief The check a shared world passes before it is stored or opened.
 *
 * One function, three callers: the `validate-world` edge function (every
 * write to `public.worlds`), the client before it publishes, and the client
 * again on every document it fetches. A document has to be a current-schema
 * WorldDocument (`schema.ts`), within the build-mode entity caps
 * (`SYSTEM_BUDGETS.authoring`), painted only from `CANDY_PAINT_PALETTE`, and
 * small enough to store.
 *
 * Renderer-free, with runtime imports only from leaves and valibot, so Deno
 * loads it unchanged (supabase/functions/validate-world).
 */

import { DEFAULT_MAP_CHUNK_STREAM_SIZE } from '../map-chunk-size.ts';
import { netEntityChanges } from './entity-state.ts';
import { isCandyPaint } from './paint-palette.ts';
import { validateWorldDocument, type DocumentCommand, type WorldDocumentV1 } from './schema.ts';

export const SHARED_WORLD_LIMITS = {
    /** `SYSTEM_BUDGETS.authoring.caps.total` (tests/shared-worlds.test.ts holds them equal). */
    maxEntities: 600,
    /** `SYSTEM_BUDGETS.authoring.caps.perChunk`. */
    maxEntitiesPerChunk: 48,
    chunkSize: DEFAULT_MAP_CHUNK_STREAM_SIZE,
    /** Serialized document size; the database refuses more than 8 MiB too. */
    maxDocumentChars: 8 * 1024 * 1024,
    maxTitleLength: 80,
    /** Entries in a world's co-editing clock (`entity_clock`). */
    maxClockEntries: 50_000,
    /**
     * How far one write may move a world's Lamport clock (`worlds.rev`), in a
     * room message or a stored write. A forged huge rev would otherwise make
     * every later edit of an entity lose to it.
     */
    maxRevJump: 100_000,
} as const;

export type SharedWorldRejection = 'schema' | 'identity' | 'too_large' | 'over_cap' | 'palette';

export interface SharedWorldStats {
    /** Authored entities the document leaves in the world. */
    entities: number;
    /** The fullest 32 m chunk, if any entity is authored. */
    busiestChunk: { key: string; count: number } | null;
    commands: number;
    chars: number;
}

export type SharedWorldCheck =
    | { ok: true; doc: WorldDocumentV1; stats: SharedWorldStats }
    | { ok: false; code: SharedWorldRejection; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_RE.test(value);
}

export function sharedChunkKey(x: number, z: number): string {
    const size = SHARED_WORLD_LIMITS.chunkSize;
    return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}

/**
 * Authored entities a command log leaves in the world, in total and per chunk:
 * every entity it touches whose final state is present. A piece moved back to
 * where the base world had it still counts (replay re-places it, as build
 * mode's own count does), and so does a no-op move of an id the base world
 * never had, which replay would place.
 */
export function countDocumentEntities(commands: readonly DocumentCommand[]): {
    total: number;
    perChunk: Map<string, number>;
} {
    const perChunk = new Map<string, number>();
    let total = 0;
    for (const { after } of netEntityChanges(commands).values()) {
        if (!after) continue;
        const [x, , z] = after.entity.position;
        const key = sharedChunkKey(x, z);
        perChunk.set(key, (perChunk.get(key) ?? 0) + 1);
        total++;
    }
    return { total, perChunk };
}

function colorOf(snapshot: { entity: { params?: unknown } }): unknown {
    return (snapshot.entity.params as { color?: unknown } | undefined)?.color;
}

/**
 * Ids given a colour outside `CANDY_PAINT_PALETTE`: by a paint, a placement,
 * or a move that changes the colour (a paint by another name).
 */
export function offPaletteColors(commands: readonly DocumentCommand[]): string[] {
    const out: string[] = [];
    const visit = (cmd: DocumentCommand): void => {
        if (cmd.type === 'batch') {
            for (const child of cmd.commands) visit(child);
            return;
        }
        if (cmd.type === 'remove') return;
        const to = cmd.type === 'place' ? cmd.snapshot : cmd.to;
        const color = colorOf(to);
        if (color === undefined || isCandyPaint(color)) return;
        if (cmd.type === 'move' && color === colorOf(cmd.from)) return;
        out.push(to.id);
    };
    for (const cmd of commands) visit(cmd);
    return out;
}

function reject(code: SharedWorldRejection, message: string): SharedWorldCheck {
    return { ok: false, code, message };
}

/**
 * Validate a document for sharing. Never throws; a rejection carries a
 * message fit to show the player (and to return from the edge function).
 */
export function validateSharedWorld(raw: unknown): SharedWorldCheck {
    let chars: number;
    try {
        chars = JSON.stringify(raw)?.length ?? 0;
    } catch {
        return reject('schema', "This world can't be shared: it isn't plain data.");
    }
    if (chars > SHARED_WORLD_LIMITS.maxDocumentChars) {
        return reject('too_large', 'This world is too large to share (8 MB at most).');
    }

    const parsed = validateWorldDocument(raw);
    if (!parsed.ok) return reject('schema', parsed.error.message);
    const doc = parsed.doc;
    if (!isUuid(doc.id)) {
        return reject('identity', "This world's id isn't a UUID, so it can't be shared.");
    }

    const counts = countDocumentEntities(doc.commands);
    if (counts.total > SHARED_WORLD_LIMITS.maxEntities) {
        return reject(
            'over_cap',
            `This world has ${counts.total} placed pieces; a shared world holds ${SHARED_WORLD_LIMITS.maxEntities}.`
        );
    }
    let busiestChunk: SharedWorldStats['busiestChunk'] = null;
    for (const [key, count] of counts.perChunk) {
        if (!busiestChunk || count > busiestChunk.count) busiestChunk = { key, count };
    }
    if (busiestChunk && busiestChunk.count > SHARED_WORLD_LIMITS.maxEntitiesPerChunk) {
        return reject(
            'over_cap',
            `One grove (chunk ${busiestChunk.key}) has ${busiestChunk.count} pieces; the limit is ${SHARED_WORLD_LIMITS.maxEntitiesPerChunk}.`
        );
    }

    const offPalette = offPaletteColors(doc.commands);
    if (offPalette.length > 0) {
        return reject('palette', `A colour outside the candy palette on "${offPalette[0]}".`);
    }

    return {
        ok: true,
        doc,
        stats: { entities: counts.total, busiestChunk, commands: doc.commands.length, chars },
    };
}

// ---------------------------------------------------------------------------
// Co-editing clock (`worlds.entity_clock`)
// ---------------------------------------------------------------------------

/** `[rev, author]`: the Lamport stamp of the write an entity's state came from. */
export type ClockStamp = [rev: number, author: string];
export type EntityClock = Record<string, ClockStamp>;

export function isClockStamp(value: unknown): value is ClockStamp {
    return (
        Array.isArray(value) &&
        value.length === 2 &&
        Number.isSafeInteger(value[0]) &&
        (value[0] as number) >= 0 &&
        typeof value[1] === 'string' &&
        value[1].length > 0 &&
        value[1].length <= 64
    );
}

/**
 * A stored clock, or null when it is malformed, too large, or holds a stamp
 * past `maxRev` (a forged rev would make that entity's state unchangeable).
 */
export function parseEntityClock(
    raw: unknown,
    maxRev = Number.MAX_SAFE_INTEGER
): EntityClock | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: EntityClock = {};
    let n = 0;
    for (const [id, stamp] of Object.entries(raw as Record<string, unknown>)) {
        if (++n > SHARED_WORLD_LIMITS.maxClockEntries) return null;
        if (id.length === 0 || id.length > 128 || !isClockStamp(stamp) || stamp[0] > maxRev) {
            return null;
        }
        out[id] = [stamp[0], stamp[1]];
    }
    return out;
}
