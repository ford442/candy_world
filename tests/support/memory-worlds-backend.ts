/**
 * In-memory `SharedWorldsBackend` for the shared-worlds tests. Writes go
 * through the real validate-world handler (supabase/functions/validate-world/
 * handler.ts) over a store that applies the same rules as the table's RLS and
 * trigger: owner or editor writes, only the owner renames or changes
 * visibility, unlisted rows open by id, `updated_at` moves on every write.
 */

import {
    handleValidateWorld,
    WorldStoreError,
    type NewWorldRow,
    type PublishRequest,
    type PublishResponse,
    type WorldPatch,
    type WorldRow,
    type WorldWriteStore,
} from '../../supabase/functions/validate-world/handler.ts';
import type {
    FetchedWorld,
    PublicPage,
    PublishOptions,
    PublishResult,
    SharedWorldSummary,
    SharedWorldsBackend,
    WorldRole,
} from '../../src/world/document/remote-store.ts';
import type { WorldDocumentV1 } from '../../src/world/document/schema.ts';

/** The shared "database": rows plus memberships, shared by every user's backend. */
export class MemoryWorldsDb {
    readonly rows = new Map<string, WorldRow>();
    readonly editors = new Map<string, Map<string, 'editor' | 'viewer'>>();
    private tick = 0;

    stamp(): string {
        this.tick++;
        return new Date(Date.UTC(2026, 9, 27, 12, 0, 0, this.tick)).toISOString();
    }

    role(worldId: string, userId: string | null): WorldRole | null {
        const row = this.rows.get(worldId);
        if (!row || !userId) return null;
        if (row.owner === userId) return 'owner';
        return this.editors.get(worldId)?.get(userId) ?? null;
    }

    canRead(worldId: string, userId: string | null, namedById: boolean): boolean {
        const row = this.rows.get(worldId);
        if (!row) return false;
        if (row.visibility === 'public') return true;
        if (row.visibility === 'unlisted' && namedById) return true;
        return this.role(worldId, userId) !== null;
    }

    addEditor(worldId: string, userId: string, role: 'editor' | 'viewer' = 'editor'): void {
        let m = this.editors.get(worldId);
        if (!m) this.editors.set(worldId, (m = new Map()));
        m.set(userId, role);
    }
}

function summaryOf(row: WorldRow): SharedWorldSummary {
    const commands = (row.doc as { commands?: unknown[] }).commands;
    return {
        id: row.id,
        owner: row.owner,
        title: row.title,
        visibility: row.visibility,
        remixOf: row.remix_of,
        seed: row.seed,
        mapVersion: row.map_version,
        rev: row.rev,
        commandCount: Array.isArray(commands) ? commands.length : 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryWorldsBackend implements SharedWorldsBackend {
    /** Flip to simulate losing the network. */
    offline = false;
    /** Requests the edge handler answered, for assertions. */
    readonly responses: PublishResponse[] = [];

    constructor(
        readonly db: MemoryWorldsDb,
        readonly user: string | null
    ) {}

    private guard(): void {
        if (this.offline) throw new TypeError('Failed to fetch');
    }

    /** The caller's view of the table, as the edge function gets it (RLS + trigger). */
    private writeStore(): WorldWriteStore {
        const { db, user } = this;
        return {
            async get(id: string): Promise<WorldRow | null> {
                return db.canRead(id, user, true) ? clone(db.rows.get(id)!) : null;
            },
            async insert(row: NewWorldRow): Promise<WorldRow> {
                if (!user) throw new WorldStoreError('permission denied', '42501');
                if (db.rows.has(row.id)) throw new WorldStoreError('duplicate key', '23505');
                const at = db.stamp();
                const stored: WorldRow = {
                    ...clone(row),
                    owner: user,
                    created_at: at,
                    updated_at: at,
                };
                db.rows.set(row.id, stored);
                return clone(stored);
            },
            async update(
                id: string,
                patch: WorldPatch,
                expected?: string
            ): Promise<WorldRow | null> {
                const row = db.rows.get(id);
                const role = db.role(id, user);
                if (!row || (role !== 'owner' && role !== 'editor')) return null;
                if (expected && row.updated_at !== expected) return null;
                if (
                    role !== 'owner' &&
                    (patch.title !== undefined || patch.visibility !== undefined)
                ) {
                    throw new WorldStoreError(
                        'only the owner can change title, visibility',
                        '42501'
                    );
                }
                Object.assign(row, clone(patch), { updated_at: db.stamp() });
                return clone(row);
            },
        };
    }

    async userId(): Promise<string | null> {
        return this.user;
    }

    async publish(doc: WorldDocumentV1, options: PublishOptions): Promise<PublishResult> {
        if (this.offline) return { ok: false, code: 'offline', message: 'Offline' };
        const body: PublishRequest = {
            doc,
            title: options.title,
            visibility: options.visibility,
            remixOf: options.remixOf,
            rev: options.rev,
            entityClock: options.entityClock,
            expectedUpdatedAt: options.expectedUpdatedAt,
        };
        const res = await handleValidateWorld(
            new Request('http://edge/validate-world', {
                method: 'POST',
                body: JSON.stringify(body),
            }),
            this.writeStore()
        );
        const json = (await res.json()) as PublishResponse;
        this.responses.push(json);
        if (!json.ok) {
            const world = json.world
                ? summaryOf({ ...json.world, doc: { commands: [] }, entity_clock: {} } as WorldRow)
                : undefined;
            return world
                ? { ok: false, code: json.code, message: json.message, world }
                : { ok: false, code: json.code, message: json.message };
        }
        const row = this.db.rows.get(doc.id)!;
        return { ok: true, world: summaryOf(row), created: json.created };
    }

    async fetch(id: string): Promise<FetchedWorld | null> {
        this.guard();
        if (!this.db.canRead(id, this.user, true)) return null;
        const row = clone(this.db.rows.get(id)!);
        return {
            summary: summaryOf(row),
            doc: row.doc,
            entityClock: row.entity_clock,
            role: this.db.role(id, this.user),
        };
    }

    async listMine(): Promise<SharedWorldSummary[]> {
        this.guard();
        return [...this.db.rows.values()]
            .filter((r) => r.owner === this.user)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .map(summaryOf);
    }

    async listShared(): Promise<SharedWorldSummary[]> {
        this.guard();
        return [...this.db.rows.values()]
            .filter((r) => r.owner !== this.user && this.db.role(r.id, this.user) !== null)
            .map(summaryOf);
    }

    async listPublic(cursor: string | null, limit: number): Promise<PublicPage> {
        this.guard();
        const all = [...this.db.rows.values()]
            .filter((r) => r.visibility === 'public')
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
        const start = cursor ? all.findIndex((r) => `${r.updated_at}|${r.id}` === cursor) + 1 : 0;
        const page = all.slice(start, start + limit);
        const last = page[page.length - 1];
        return {
            worlds: page.map(summaryOf),
            next: start + limit < all.length && last ? `${last.updated_at}|${last.id}` : null,
        };
    }

    async delete(id: string): Promise<void> {
        this.guard();
        if (this.db.role(id, this.user) === 'owner') this.db.rows.delete(id);
    }
}
