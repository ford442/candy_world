/**
 * validate-world: the only write path for a world's document (#1975).
 *
 * Every publish and every co-editing write-back posts here. Clients cannot
 * insert into `public.worlds` or update its document themselves (the migration
 * grants them `update (title, visibility)` and nothing more), so nothing
 * reaches the table without this check:
 *
 *   - the document passes the same `validateSharedWorld` the client runs
 *     (schema, entity caps, paint palette, size);
 *   - the caller, from the request's JWT, owns the world or edits it; only the
 *     owner renames it or changes who sees it; a `public` world needs a
 *     permanent account; a blind overwrite of an existing world is refused;
 *   - the co-editing clock is bounded: `rev` moves at most `maxRevJump` per
 *     write and no entity stamp is past it;
 *   - `remix_of` is kept only when the source is public, so a remix never
 *     points readers at an unlisted world.
 *
 * Then it writes with the service role (docs/SHARED_WORLDS.md).
 *
 * Web-standard Request/Response only: `index.ts` wires it to Deno.serve and
 * supabase-js, and tests/shared-worlds.test.ts drives it from Node.
 */

import {
    SHARED_WORLD_LIMITS,
    isUuid,
    parseEntityClock,
    validateSharedWorld,
    type EntityClock,
    type SharedWorldStats,
} from '../../../src/world/document/shared-validation.ts';

export type WorldVisibility = 'private' | 'unlisted' | 'public';

export interface WorldRow {
    id: string;
    owner: string;
    title: string;
    seed: number;
    map_version: string;
    doc: unknown;
    visibility: WorldVisibility;
    remix_of: string | null;
    rev: number;
    entity_clock: EntityClock;
    created_at: string;
    updated_at: string;
}

export type WorldRowSummary = Omit<WorldRow, 'doc' | 'entity_clock'>;

export interface NewWorldRow {
    id: string;
    owner: string;
    title: string;
    seed: number;
    map_version: string;
    doc: unknown;
    visibility: WorldVisibility;
    remix_of: string | null;
    rev: number;
    entity_clock: EntityClock;
}

export type WorldPatch = Partial<
    Pick<NewWorldRow, 'title' | 'visibility' | 'doc' | 'rev' | 'entity_clock'>
>;

/** A database refusal, carrying the Postgres SQLSTATE when there is one. */
export class WorldStoreError extends Error {
    constructor(
        message: string,
        readonly sqlstate?: string
    ) {
        super(message);
        this.name = 'WorldStoreError';
    }
}

/** Who is asking, as the auth server vouches for the request's JWT. */
export interface WorldCaller {
    id: string;
    /** An anonymous sign-in (no email or OAuth identity yet). */
    anonymous: boolean;
}

/**
 * The function's view of the database. `caller` checks the request's JWT;
 * everything else runs with the service role (no RLS), so this handler is
 * the access check.
 */
export interface WorldWriteStore {
    caller(): Promise<WorldCaller | null>;
    get(id: string): Promise<WorldRow | null>;
    /** `world_editors.role` for this user, or null when they are not a member. */
    memberRole(worldId: string, userId: string): Promise<'editor' | 'viewer' | null>;
    insert(row: NewWorldRow): Promise<WorldRow>;
    /** Null when `expectedUpdatedAt` no longer matches (or the row is gone). */
    update(id: string, patch: WorldPatch, expectedUpdatedAt?: string): Promise<WorldRow | null>;
}

export interface PublishRequest {
    doc: unknown;
    title?: string;
    visibility?: WorldVisibility;
    remixOf?: string | null;
    rev?: number;
    entityClock?: unknown;
    /** Optimistic concurrency: refuse the update if the row moved on since. */
    expectedUpdatedAt?: string;
    /** Validate only; write nothing. */
    dryRun?: boolean;
}

export type PublishResponse =
    | { ok: true; world: WorldRowSummary | null; stats: SharedWorldStats; created: boolean }
    | { ok: false; code: string; message: string; world?: WorldRowSummary };

export const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Request bodies past this are refused before they are parsed. */
export const MAX_REQUEST_CHARS = SHARED_WORLD_LIMITS.maxDocumentChars + 2 * 1024 * 1024;

const VISIBILITIES: readonly WorldVisibility[] = ['private', 'unlisted', 'public'];

function json(status: number, body: PublishResponse): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

function fail(status: number, code: string, message: string, world?: WorldRow): Response {
    return json(
        status,
        world ? { ok: false, code, message, world: summarize(world) } : { ok: false, code, message }
    );
}

export function summarize(row: WorldRow): WorldRowSummary {
    const { doc: _doc, entity_clock: _clock, ...rest } = row;
    return rest;
}

/** Map a database refusal onto an HTTP answer. */
function storeFailure(err: unknown): Response {
    if (err instanceof WorldStoreError) {
        if (err.sqlstate === '42501') return fail(403, 'forbidden', err.message);
        if (err.sqlstate === '23505')
            return fail(409, 'exists', 'A world with this id already exists.');
        if (err.sqlstate === '22023' || err.sqlstate === '23514')
            return fail(422, 'schema', err.message);
        return fail(502, 'database', err.message);
    }
    return fail(500, 'internal', err instanceof Error ? err.message : String(err));
}

export function cleanTitle(raw: unknown, fallback: unknown): string {
    const pick = typeof raw === 'string' ? raw : typeof fallback === 'string' ? fallback : '';
    const title = pick.replace(/\s+/g, ' ').trim().slice(0, SHARED_WORLD_LIMITS.maxTitleLength);
    return title || 'Untitled world';
}

/** Handle one request. `store` knows the caller and writes with the service role. */
export async function handleValidateWorld(req: Request, store: WorldWriteStore): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'method', 'POST a world to publish it.');

    const text = await req.text();
    if (text.length > MAX_REQUEST_CHARS) {
        return fail(413, 'too_large', 'This world is too large to share (8 MB at most).');
    }
    let body: PublishRequest;
    try {
        body = JSON.parse(text) as PublishRequest;
    } catch {
        return fail(400, 'bad_request', 'The request body is not JSON.');
    }
    if (!body || typeof body !== 'object')
        return fail(400, 'bad_request', 'The request body is not an object.');

    const check = validateSharedWorld(body.doc);
    if (!check.ok) return fail(422, check.code, check.message);
    const doc = check.doc;

    if (body.visibility !== undefined && !VISIBILITIES.includes(body.visibility)) {
        return fail(400, 'bad_request', `Unknown visibility "${String(body.visibility)}".`);
    }
    if (body.remixOf !== undefined && body.remixOf !== null && !isUuid(body.remixOf)) {
        return fail(400, 'bad_request', 'remixOf must be a world id.');
    }
    if (body.rev !== undefined && (!Number.isSafeInteger(body.rev) || body.rev < 0)) {
        return fail(400, 'bad_request', 'rev must be a non-negative integer.');
    }
    if (body.expectedUpdatedAt !== undefined && typeof body.expectedUpdatedAt !== 'string') {
        return fail(400, 'bad_request', 'expectedUpdatedAt must be a timestamp.');
    }

    if (body.dryRun)
        return json(200, { ok: true, world: null, stats: check.stats, created: false });

    try {
        const caller = await store.caller();
        if (!caller) return fail(401, 'unauthorized', 'Sign in to share worlds.');
        const existing = await store.get(doc.id);

        // The clock: one write moves it at most maxRevJump, and every entity
        // stamp is at or below the rev it is written with.
        const priorRev = existing?.rev ?? 0;
        if (body.rev !== undefined && body.rev > priorRev + SHARED_WORLD_LIMITS.maxRevJump) {
            return fail(422, 'clock', 'The co-editing clock jumped too far.');
        }
        const rev = Math.max(body.rev ?? 0, priorRev);
        let clock: EntityClock | undefined;
        if (body.entityClock !== undefined) {
            const parsed = parseEntityClock(body.entityClock, rev);
            if (!parsed) return fail(422, 'clock', 'The co-editing clock is malformed.');
            clock = parsed;
        }

        if (!existing) {
            const visibility = body.visibility ?? 'unlisted';
            if (visibility === 'public' && caller.anonymous) return accountNeeded();
            // Only a public source is linked: anyone who can read the remix can
            // read its remix_of, which must not hand out an unlisted world's id.
            let remixOf: string | null = null;
            if (body.remixOf) {
                const source = await store.get(body.remixOf);
                if (source?.visibility === 'public') remixOf = source.id;
            }
            const row = await store.insert({
                id: doc.id,
                owner: caller.id,
                title: cleanTitle(body.title, doc.meta.title),
                seed: doc.seed,
                map_version: doc.mapVersion,
                doc,
                visibility,
                remix_of: remixOf,
                rev,
                entity_clock: clock ?? {},
            });
            return json(201, {
                ok: true,
                world: summarize(row),
                stats: check.stats,
                created: true,
            });
        }

        const owner = existing.owner === caller.id;
        const role = owner ? 'owner' : await store.memberRole(existing.id, caller.id);
        if (role !== 'owner' && role !== 'editor') {
            return fail(403, 'forbidden', "You can't edit this world.");
        }
        if (!body.expectedUpdatedAt) {
            // A first publish from this copy: the world is already there.
            return fail(409, 'exists', 'A world with this id already exists.', existing);
        }
        if (existing.seed !== doc.seed || existing.map_version !== doc.mapVersion) {
            return fail(
                409,
                'terrain',
                'This document is for different terrain than the shared world.',
                existing
            );
        }
        const patch: WorldPatch = { doc, rev };
        if (clock) patch.entity_clock = clock;
        const title = body.title === undefined ? undefined : cleanTitle(body.title, existing.title);
        const renames = title !== undefined && title !== existing.title;
        const revisibles = body.visibility !== undefined && body.visibility !== existing.visibility;
        if ((renames || revisibles) && !owner) {
            return fail(
                403,
                'forbidden',
                'Only the owner can rename this world or change who sees it.'
            );
        }
        if (renames) patch.title = title;
        if (revisibles) {
            if (body.visibility === 'public' && caller.anonymous) return accountNeeded();
            patch.visibility = body.visibility;
        }

        const row = await store.update(doc.id, patch, body.expectedUpdatedAt);
        if (row)
            return json(200, {
                ok: true,
                world: summarize(row),
                stats: check.stats,
                created: false,
            });
        const current = await store.get(doc.id);
        if (!current) return fail(404, 'not_found', 'The shared world is gone.');
        return fail(409, 'conflict', 'Someone saved this world since you opened it.', current);
    } catch (err) {
        return storeFailure(err);
    }
}

function accountNeeded(): Response {
    return fail(
        403,
        'account_needed',
        'Public worlds need an account: add an email to keep your worlds first.'
    );
}
