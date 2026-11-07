/**
 * @file src/world/document/remote-store.ts
 * @brief Shared worlds as a `DocumentStore` (#1975): publish, fetch, list.
 *
 * `RemoteDocumentStore` is the `DocumentStore` from #1974 backed by
 * `public.worlds`, plus what sharing needs: `publish`, `fetch(id)` with the
 * row's sync metadata, `listMine`, `listShared`, `listPublic(cursor)` and
 * `remix`. The transport is a `SharedWorldsBackend`: the Supabase one lives in
 * the lazy `net` chunk (`systems/net/supabase-worlds-backend.ts`), tests use
 * an in-memory one, so nothing here imports supabase-js.
 *
 * Every document is checked with `validateSharedWorld` twice: before it is
 * published (the `validate-world` edge function checks it again) and when it
 * is fetched, so a row written past the edge function is refused, not replayed.
 */

import { newDocumentId, type WorldDocumentV1 } from './schema.ts';
import {
    isUuid,
    parseEntityClock,
    validateSharedWorld,
    type EntityClock,
} from './shared-validation.ts';
import type { DocumentStore, WorldDocumentSummary } from './store.ts';

export type WorldVisibility = 'private' | 'unlisted' | 'public';
export type WorldRole = 'owner' | 'editor' | 'viewer';

/** A world as the lists show it (everything but the document). */
export interface SharedWorldSummary {
    id: string;
    owner: string;
    title: string;
    visibility: WorldVisibility;
    remixOf: string | null;
    seed: number;
    mapVersion: string;
    rev: number;
    commandCount: number;
    createdAt: string;
    updatedAt: string;
    /** Public URL of the newest photo-mode thumbnail, when there is one. */
    thumbnailUrl?: string;
}

/** A fetched world: the validated document plus its co-editing clock. */
export interface SharedWorldRecord {
    summary: SharedWorldSummary;
    doc: WorldDocumentV1;
    entityClock: EntityClock;
    /** The caller's role, when signed in and a member. */
    role: WorldRole | null;
}

export interface PublishOptions {
    title?: string;
    visibility?: WorldVisibility;
    remixOf?: string | null;
    rev?: number;
    entityClock?: EntityClock;
    /** Refuse the write if the row changed since (the `updated_at` the caller last saw). */
    expectedUpdatedAt?: string;
}

export type PublishResult =
    | { ok: true; world: SharedWorldSummary; created: boolean }
    | {
          ok: false;
          /** A `SharedWorldRejection`, or the edge function's `conflict`, `forbidden`, `offline`, ... */
          code: string;
          message: string;
          /** The row as it stands, on a conflict. */
          world?: SharedWorldSummary;
      };

/** One row as the backend returns it; validation happens in the store. */
export interface FetchedWorld {
    summary: SharedWorldSummary;
    doc: unknown;
    entityClock: unknown;
    role: WorldRole | null;
}

export interface PublicPage {
    worlds: SharedWorldSummary[];
    /** Pass back for the next page; null at the end. */
    next: string | null;
}

/** The transport behind `RemoteDocumentStore`. */
export interface SharedWorldsBackend {
    /** Signed-in user id (anonymous sign-in counts), or null when offline / unconfigured. */
    userId(): Promise<string | null>;
    /** Validated write through the `validate-world` edge function. */
    publish(doc: WorldDocumentV1, options: PublishOptions): Promise<PublishResult>;
    fetch(id: string): Promise<FetchedWorld | null>;
    listMine(): Promise<SharedWorldSummary[]>;
    /** Worlds the caller is an editor or viewer of. */
    listShared(): Promise<SharedWorldSummary[]>;
    listPublic(cursor: string | null, limit: number): Promise<PublicPage>;
    delete(id: string): Promise<void>;
}

export class SharedWorldError extends Error {
    constructor(
        readonly code: string,
        readonly userMessage: string
    ) {
        super(userMessage);
        this.name = 'SharedWorldError';
    }
}

function toDocumentSummary(world: SharedWorldSummary): WorldDocumentSummary {
    const parsed = Date.parse(world.updatedAt);
    return {
        id: world.id,
        title: world.title,
        updatedAt: Number.isFinite(parsed) ? parsed : 0,
        commandCount: world.commandCount,
    };
}

export class RemoteDocumentStore implements DocumentStore {
    constructor(readonly backend: SharedWorldsBackend) {}

    // -- DocumentStore ------------------------------------------------------

    async load(id: string): Promise<WorldDocumentV1 | null> {
        try {
            return (await this.fetch(id))?.doc ?? null;
        } catch (err) {
            console.warn(`[SharedWorlds] Could not load world "${id}":`, err);
            return null;
        }
    }

    async save(doc: WorldDocumentV1): Promise<void> {
        const result = await this.publish(doc);
        if (!result.ok) throw new SharedWorldError(result.code, result.message);
    }

    async list(): Promise<WorldDocumentSummary[]> {
        return (await this.listMine()).map(toDocumentSummary);
    }

    delete(id: string): Promise<void> {
        return this.backend.delete(id);
    }

    // -- Sharing ------------------------------------------------------------

    /** Publish (insert or update) a document; checked here before it leaves. */
    async publish(doc: WorldDocumentV1, options: PublishOptions = {}): Promise<PublishResult> {
        const check = validateSharedWorld(doc);
        if (!check.ok) return { ok: false, code: check.code, message: check.message };
        return this.backend.publish(check.doc, options);
    }

    /**
     * A shared world by id, validated, or null when it does not exist (or the
     * caller may not read it). Throws `SharedWorldError` for a row that fails
     * validation: it is never handed to replay.
     */
    async fetch(id: string): Promise<SharedWorldRecord | null> {
        if (!isUuid(id)) throw new SharedWorldError('identity', "That isn't a shared world link.");
        const row = await this.backend.fetch(id);
        if (!row) return null;
        const check = validateSharedWorld(row.doc);
        if (!check.ok) {
            console.warn(`[SharedWorlds] Refused world "${id}": ${check.code}: ${check.message}`);
            throw new SharedWorldError(
                check.code,
                `This shared world can't be opened: ${check.message}`
            );
        }
        if (check.doc.id !== id) {
            throw new SharedWorldError(
                'identity',
                "This shared world's document doesn't match its link."
            );
        }
        return {
            summary: row.summary,
            doc: check.doc,
            entityClock: parseEntityClock(row.entityClock) ?? {},
            role: row.role,
        };
    }

    listMine(): Promise<SharedWorldSummary[]> {
        return this.backend.listMine();
    }

    listShared(): Promise<SharedWorldSummary[]> {
        return this.backend.listShared();
    }

    listPublic(cursor: string | null = null, limit = 24): Promise<PublicPage> {
        return this.backend.listPublic(cursor, Math.max(1, Math.min(60, Math.floor(limit))));
    }

    /**
     * Fork a world into a new one the caller owns: same seed and edits, a new
     * id, `remix_of` pointing back when the source is public (an unlisted
     * world's id is its access key, and readers of the remix see `remix_of`).
     * Progress and pose start fresh.
     */
    async remix(
        id: string,
        options: { title?: string; now?: number } = {}
    ): Promise<PublishResult> {
        const source = await this.fetch(id);
        if (!source)
            return {
                ok: false,
                code: 'not_found',
                message: "That world isn't available to remix.",
            };
        const now = options.now ?? Date.now();
        const title = (options.title ?? `${source.summary.title} (remix)`).slice(0, 80);
        const doc: WorldDocumentV1 = {
            ...structuredClone(source.doc),
            id: newDocumentId(),
            progress: {
                discoveries: [],
                unlocks: [],
                inventory: {},
                awakened: [],
                stamps: [],
                partII: { sugarCavesUnlocked: false },
            },
            meta: { title, createdAt: now, updatedAt: now },
        };
        const remixOf = source.summary.visibility === 'public' ? id : null;
        return this.publish(doc, { title, visibility: 'unlisted', remixOf });
    }
}
