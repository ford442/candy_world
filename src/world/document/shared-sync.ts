/**
 * @file src/world/document/shared-sync.ts
 * @brief Offline-first sync of a shared world (#1975).
 *
 * While a player edits, the local copy (IndexedDB, `store.ts`) is the source
 * of truth. `push` sends it to `public.worlds` on save and on an interval,
 * with the row's `updated_at` as the conflict check. When the row moved on in
 * the meantime (another device, a co-editing host), the two are merged per
 * entity against what was last synced: the entities this copy changed since
 * then keep its version, every other entity takes the remote one, progress is
 * a union. `open` does the same when a share link boots.
 *
 * Edits made outside a live room get co-editing clock stamps here
 * (`stampChanges`), so a live room's anti-entropy can order them against its
 * own writes (`world-sync-protocol.ts`).
 */

import {
    authoredEntityStates,
    canonicalJson,
    hashString,
    isUnchanged,
    netEntityChanges,
    type EntityState,
    type NetEntityChange,
} from './entity-state.ts';
import { unionProgress } from './progress-union.ts';
import type {
    PublishResult,
    RemoteDocumentStore,
    SharedWorldRecord,
    SharedWorldSummary,
    WorldVisibility,
} from './remote-store.ts';
import type { DocumentCommand, WorldDocumentV1 } from './schema.ts';
import type { ClockStamp, EntityClock } from './shared-validation.ts';
import type { DocumentStore } from './store.ts';

/** What this copy last agreed with the server on. */
export interface SyncMeta {
    updatedAt: string;
    rev: number;
    /** Per authored entity, a hash of its state at the last sync. */
    entityHashes: Record<string, string>;
    /** The row's co-editing clock at the last sync (absent in metas from older builds). */
    clock?: EntityClock;
}

export interface SyncMetaStore {
    get(id: string): SyncMeta | null;
    set(id: string, meta: SyncMeta): void;
    delete(id: string): void;
}

export class MemorySyncMetaStore implements SyncMetaStore {
    private readonly map = new Map<string, string>();

    get(id: string): SyncMeta | null {
        const json = this.map.get(id);
        return json ? (JSON.parse(json) as SyncMeta) : null;
    }

    set(id: string, meta: SyncMeta): void {
        this.map.set(id, JSON.stringify(meta));
    }

    delete(id: string): void {
        this.map.delete(id);
    }
}

const META_KEY_PREFIX = 'candy_shared_world_sync:';

/** localStorage, falling back to nothing (private mode: every open is a fresh merge). */
export class LocalStorageSyncMetaStore implements SyncMetaStore {
    get(id: string): SyncMeta | null {
        try {
            const raw = localStorage.getItem(META_KEY_PREFIX + id);
            if (!raw) return null;
            const meta = JSON.parse(raw) as SyncMeta;
            return typeof meta?.updatedAt === 'string' && meta.entityHashes ? meta : null;
        } catch {
            return null;
        }
    }

    set(id: string, meta: SyncMeta): void {
        try {
            localStorage.setItem(META_KEY_PREFIX + id, JSON.stringify(meta));
        } catch {
            // Quota or private mode: the next open merges from scratch.
        }
    }

    delete(id: string): void {
        try {
            localStorage.removeItem(META_KEY_PREFIX + id);
        } catch {
            // ignore
        }
    }
}

function stateHash(state: EntityState): string {
    return hashString(canonicalJson(state));
}

/** Hash of every authored entity's state in a command log. */
export function entityHashes(commands: readonly DocumentCommand[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, state] of authoredEntityStates(commands)) out[id] = stateHash(state);
    return out;
}

/** Entities whose authored state differs from `base` (added, changed, or put back). */
export function changedSince(
    commands: readonly DocumentCommand[],
    base: Record<string, string> | null
): Set<string> {
    const now = entityHashes(commands);
    if (!base) return new Set(Object.keys(now));
    const out = new Set<string>();
    for (const id of new Set([...Object.keys(now), ...Object.keys(base)])) {
        if (now[id] !== base[id]) out.add(id);
    }
    return out;
}

function commandFor(before: EntityState, after: EntityState): DocumentCommand | null {
    if (isUnchanged(after, before)) return null;
    if (!before && after) return { type: 'place', snapshot: after };
    if (before && !after) return { type: 'remove', snapshot: before };
    return { type: 'move', from: before!, to: after! };
}

function sameStamp(a: ClockStamp | undefined, b: ClockStamp | undefined): boolean {
    return a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);
}

/**
 * Three-way merge: `remote` plus the entities `local` changed since `base`
 * (`SyncMeta.entityHashes`; null: everything local counts as changed). With
 * the clocks of the base and the remote, an entity the remote changed since
 * the base keeps the remote version even if this copy changed it too: the
 * remote change is one other people have already seen. With no base at all,
 * the base clock is the first publish's (empty).
 */
export function mergeSharedDocuments(
    local: WorldDocumentV1,
    remote: WorldDocumentV1,
    base: Record<string, string> | null,
    now = Date.now(),
    clocks: { base?: EntityClock; remote?: EntityClock } = {}
): { doc: WorldDocumentV1; localWins: Set<string> } {
    const remoteNet = netEntityChanges(remote.commands);
    const localNet = netEntityChanges(local.commands);
    const localWins = changedSince(local.commands, base);
    // A copy that never synced has, at best, the world as first published,
    // which carries no stamps: anything stamped since is news to it.
    const baseClock = clocks.base ?? (base === null ? {} : undefined);
    if (baseClock && clocks.remote) {
        for (const id of [...localWins]) {
            if (!sameStamp(baseClock[id], clocks.remote[id])) localWins.delete(id);
        }
    }
    const merged = new Map<string, NetEntityChange>(remoteNet);
    for (const id of localWins) {
        const mine = localNet.get(id);
        const theirs = remoteNet.get(id);
        const before = theirs ? theirs.before : (mine?.before ?? null);
        // No local change left for the id: this copy put the entity back to its base state.
        merged.set(id, { before, after: mine ? mine.after : before });
    }
    const commands: DocumentCommand[] = [];
    for (const id of [...merged.keys()].sort()) {
        const { before, after } = merged.get(id)!;
        const cmd = commandFor(before, after);
        if (cmd) commands.push(cmd);
    }
    return {
        doc: {
            ...local,
            seed: remote.seed,
            mapVersion: remote.mapVersion,
            commands,
            progress: unionProgress(remote.progress, local.progress),
            meta: { ...local.meta, updatedAt: now },
        },
        localWins,
    };
}

/** Give each entity changed outside a live room a fresh co-editing stamp. */
export function stampChanges(
    clock: EntityClock,
    changed: Iterable<string>,
    rev: number,
    author: string
): EntityClock {
    const out: EntityClock = { ...clock };
    for (const id of changed) out[id] = [rev, author];
    return out;
}

export type OpenSource = 'remote' | 'local' | 'merged' | 'offline';

export interface OpenResult {
    doc: WorldDocumentV1;
    record: SharedWorldRecord | null;
    source: OpenSource;
}

export type PushStatus = 'synced' | 'merged' | 'unchanged' | 'offline' | 'failed';

export interface PushResult {
    status: PushStatus;
    /** The document now stored (merged when `status` is 'merged'). */
    doc: WorldDocumentV1;
    world?: SharedWorldSummary;
    message?: string;
}

interface Known {
    clock: EntityClock;
    rev: number;
    updatedAt: string;
}

export interface SharedWorldSyncDeps {
    local: DocumentStore;
    remote: RemoteDocumentStore;
    meta: SyncMetaStore;
    now?: () => number;
}

export class SharedWorldSync {
    private readonly known = new Map<string, Known>();

    constructor(private readonly deps: SharedWorldSyncDeps) {}

    private now(): number {
        return this.deps.now?.() ?? Date.now();
    }

    /** `sync-<user>`: the stamp author for edits made outside a live room. */
    private async author(): Promise<string> {
        const user = await this.deps.remote.backend.userId();
        return `sync-${(user ?? 'local').replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || 'local'}`;
    }

    private remember(record: {
        summary: SharedWorldSummary;
        doc: WorldDocumentV1;
        entityClock: EntityClock;
    }): void {
        this.known.set(record.summary.id, {
            clock: record.entityClock,
            rev: record.summary.rev,
            updatedAt: record.summary.updatedAt,
        });
        this.deps.meta.set(record.summary.id, {
            updatedAt: record.summary.updatedAt,
            rev: record.summary.rev,
            entityHashes: entityHashes(record.doc.commands),
            clock: record.entityClock,
        });
    }

    /** Record a write made elsewhere (the co-editing host's write-back). */
    noteSynced(summary: SharedWorldSummary, doc: WorldDocumentV1, entityClock: EntityClock): void {
        this.remember({ summary, doc, entityClock });
    }

    /**
     * A live room confirmed (by the host's `sync` hash) that the row holds
     * what this copy holds: everything touched in the room is synced, not a
     * local change waiting to win the next merge.
     */
    noteRoomState(
        id: string,
        state: {
            updatedAt: string;
            rev: number;
            commands: readonly DocumentCommand[];
            clock: EntityClock;
        }
    ): void {
        this.known.set(id, { clock: state.clock, rev: state.rev, updatedAt: state.updatedAt });
        this.deps.meta.set(id, {
            updatedAt: state.updatedAt,
            rev: state.rev,
            entityHashes: entityHashes(state.commands),
            clock: state.clock,
        });
    }

    /**
     * The row state the copy last opened or pushed for `id` matches: its
     * clock, rev and `updated_at` describe the same write as that document,
     * which is what a live room's replica has to start from.
     */
    syncedState(id: string): { clock: EntityClock; rev: number; updatedAt: string } | undefined {
        const known = this.known.get(id);
        return known ? { ...known, clock: { ...known.clock } } : undefined;
    }

    /**
     * Open a shared world for a share link: the remote copy, the local copy,
     * or both merged. Throws when neither exists (or the remote one is invalid).
     */
    async open(id: string): Promise<OpenResult> {
        let record: SharedWorldRecord | null = null;
        let offline = false;
        try {
            record = await this.deps.remote.fetch(id);
        } catch (err) {
            if ((err as { code?: string })?.code && (err as { code: string }).code !== 'offline')
                throw err;
            offline = true;
        }
        const local = await this.deps.local.load(id);
        const meta = this.deps.meta.get(id);

        if (!record) {
            if (local) return { doc: local, record: null, source: offline ? 'offline' : 'local' };
            throw new Error(
                offline
                    ? 'Offline, and this world has no local copy.'
                    : "That world doesn't exist or isn't shared with you."
            );
        }
        const takeRemote = async (): Promise<OpenResult> => {
            const doc = {
                ...record.doc,
                progress: unionProgress(
                    record.doc.progress,
                    local?.progress ?? record.doc.progress
                ),
                player: local?.player ?? record.doc.player,
            };
            await this.deps.local.save(doc);
            this.remember({ ...record, doc });
            return { doc, record, source: 'remote' };
        };
        // Only a builder's copy can hold edits of its own; anyone else takes the world as stored.
        if (!local || (record.role !== 'owner' && record.role !== 'editor')) return takeRemote();
        if (meta && meta.updatedAt === record.summary.updatedAt) {
            // Nothing new on the server: this copy (and any unsynced edits) holds.
            this.known.set(id, {
                clock: record.entityClock,
                rev: record.summary.rev,
                updatedAt: record.summary.updatedAt,
            });
            return { doc: local, record, source: 'local' };
        }
        const { doc, localWins } = mergeSharedDocuments(
            local,
            record.doc,
            meta?.entityHashes ?? null,
            this.now(),
            { base: meta?.clock, remote: record.entityClock }
        );
        if (localWins.size === 0) return takeRemote();
        // From here the row is the base: a push stamps only what this copy won.
        await this.deps.local.save(doc);
        this.remember(record);
        return { doc, record, source: 'merged' };
    }

    /**
     * Publish `doc` (the local copy). A first publish creates the row; later
     * ones are conditional on the `updated_at` last seen and merge on conflict.
     */
    async push(
        doc: WorldDocumentV1,
        options: { title?: string; visibility?: WorldVisibility; force?: boolean } = {}
    ): Promise<PushResult> {
        const meta = this.deps.meta.get(doc.id);
        const changed = changedSince(doc.commands, meta?.entityHashes ?? null);
        if (meta && changed.size === 0 && !options.force && !options.title && !options.visibility) {
            return { status: 'unchanged', doc };
        }
        let known =
            this.known.get(doc.id) ??
            (meta?.clock
                ? { clock: meta.clock, rev: meta.rev, updatedAt: meta.updatedAt }
                : undefined);
        const author = await this.author();

        let record: SharedWorldRecord | null = null;
        if (!known) {
            // Never pushed from here (or a meta from an older build, without the
            // row's clock): read the row, so nothing is overwritten blind.
            try {
                record = await this.deps.remote.fetch(doc.id);
            } catch {
                return {
                    status: 'offline',
                    doc,
                    message: 'Could not reach the shared-worlds server.',
                };
            }
            if (record && meta && record.summary.updatedAt === meta.updatedAt) {
                known = {
                    clock: record.entityClock,
                    rev: record.summary.rev,
                    updatedAt: record.summary.updatedAt,
                };
                record = null;
            }
        }

        let result: PublishResult | null = null;
        let rev = 0;
        if (!record) {
            // A first publish is the world's base: no stamps until something changes after it.
            rev = known ? known.rev + (changed.size > 0 ? 1 : 0) : 0;
            const clock = known ? stampChanges(known.clock, changed, rev, author) : {};
            result = await this.deps.remote.publish(doc, {
                title: options.title,
                visibility: options.visibility,
                rev,
                entityClock: clock,
                expectedUpdatedAt: known?.updatedAt,
            });
            if (result.ok) {
                this.remember({ summary: result.world, doc, entityClock: clock });
                await this.deps.local.save(doc);
                return { status: 'synced', doc, world: result.world };
            }
            if (result.code === 'offline')
                return { status: 'offline', doc, message: result.message };
            if (result.code !== 'conflict' && result.code !== 'exists') {
                return { status: 'failed', doc, message: result.message };
            }
            try {
                record = await this.deps.remote.fetch(doc.id);
            } catch {
                return {
                    status: 'offline',
                    doc,
                    message: 'Could not reach the shared-worlds server.',
                };
            }
            if (!record) return { status: 'failed', doc, message: 'The shared world is gone.' };
        }

        // The row moved on (or was never seen from here): merge onto it, once.
        const merged = mergeSharedDocuments(
            doc,
            record.doc,
            meta?.entityHashes ?? null,
            this.now(),
            {
                base: meta?.clock,
                remote: record.entityClock,
            }
        );
        const mergedRev = Math.max(record.summary.rev, rev) + 1;
        const mergedClock = stampChanges(record.entityClock, merged.localWins, mergedRev, author);
        result = await this.deps.remote.publish(merged.doc, {
            title: options.title,
            visibility: options.visibility,
            rev: mergedRev,
            entityClock: mergedClock,
            expectedUpdatedAt: record.summary.updatedAt,
        });
        if (!result.ok) return { status: 'failed', doc: merged.doc, message: result.message };
        this.remember({ summary: result.world, doc: merged.doc, entityClock: mergedClock });
        await this.deps.local.save(merged.doc);
        return { status: 'merged', doc: merged.doc, world: result.world };
    }
}
