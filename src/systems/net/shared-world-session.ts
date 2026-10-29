/**
 * @file src/systems/net/shared-world-session.ts
 * @brief A live co-editing room for one shared world (#1975).
 *
 * Binds a `SharedWorldReplica` (world-sync-protocol.ts) to Supabase Realtime,
 * the edit history and the live world:
 *
 *   world:<id>        presence and poses (PresenceSystem); anyone who can
 *                     read the world joins.
 *   world:<id>:edit   `cmd`, `cursor`, `sync`, shared `progress`; readers
 *                     listen, only editors may send.
 *   world:<id>:owner  `kick`; readers listen, only the owner may send.
 *
 * Realtime Authorization enforces who sends where (the migration's
 * realtime.messages policies), so a `progress` or `kick` is never taken from
 * someone the database wouldn't let send it. Payloads are still the sender's
 * word: every one is validated, rate limited and checked against the room.
 *
 * Local edits (EditHistory events) are stamped and broadcast; inbound ones
 * are applied through the same WorldCommands the editor uses, outside the
 * undo history. The editor who joined first is host: it writes the merged
 * document back every few seconds and on leave, and announces the hash, which
 * is how drifted replicas notice and reconcile.
 */

import {
    REALTIME_SUBSCRIBE_STATES,
    type RealtimeChannel,
    type SupabaseClient,
} from '@supabase/supabase-js';
import * as THREE from 'three';
import { announce } from '../../ui/announcer.ts';
import { log } from '../../utils/log.ts';
import { showToast } from '../../utils/toast.ts';
import { invertCommand, type EntityState } from '../../world/document/entity-state.ts';
import type { RemoteDocumentStore, SharedWorldRecord } from '../../world/document/remote-store.ts';
import type { DocumentCommand, WorldDocumentV1 } from '../../world/document/schema.ts';
import type { WorldDocumentSession } from '../../world/document/session.ts';
import type { SharedWorldSync } from '../../world/document/shared-sync.ts';
import type { EntityClock } from '../../world/document/shared-validation.ts';
import { animatedFoliage } from '../../world/state.ts';
import { awakenedPersistence } from '../awakened-persistence-api.ts';
import { AWAKENABLE_TYPES } from '../awakened-types.ts';
import { getBuildCursor, getBuildSelection } from '../build-mode-state.ts';
import { DISCOVERY_MAP } from '../discovery-map.ts';
import { discoverySystem } from '../discovery-optimized.ts';
import type { EditHistory, EditHistoryEvent, WorldCommand } from '../edit-history.ts';
import { applyRemoteProgress, onProgress, type ProgressEvent } from '../progress-events.ts';
import { MoveCommand, RemoveCommand } from '../world-commands.ts';
import { presenceSystem } from './presence.ts';
import { RemoteCursors } from './remote-cursors.ts';
import type { SupabaseWorldsBackend } from './supabase-worlds-backend.ts';
import {
    PeerRateLimiter,
    SharedWorldReplica,
    TokenBucket,
    WORLD_SYNC_EVENTS,
    WORLD_SYNC_LIMITS,
    electHost,
    parseCmdMessage,
    parseCursorMessage,
    parseKickMessage,
    parseProgressMessage,
    parseSyncMessage,
    progressRefusal,
    type CmdMessage,
    type HostCandidate,
    type ProgressCatalog,
    type WorldEffect,
} from './world-sync-protocol.ts';

/** How often the host writes the merged world back while it changes. */
const WRITE_BACK_MS = 15_000;
/** After a write-back the server refused (not a conflict), wait this long. */
const WRITE_BACK_RETRY_MS = 60_000;
/** At most one reconcile fetch this often (a hash can differ only transiently). */
const RECONCILE_MIN_MS = 10_000;

interface EditPresence extends HostCandidate {
    userId?: string;
}

const PROGRESS_CATALOG: ProgressCatalog = {
    discoveries: new Set(Object.keys(DISCOVERY_MAP)),
    awakenable: AWAKENABLE_TYPES,
    placedType: (id) => awakenedPersistence.placedType(id),
};

export interface SharedWorldSessionDeps {
    client: SupabaseClient;
    backend: SupabaseWorldsBackend;
    remote: RemoteDocumentStore;
    sync: SharedWorldSync;
    record: SharedWorldRecord;
    /**
     * The world as opened, and the row state it is the document of: the
     * replica starts from one write, never a document from one read and a
     * clock from another.
     */
    base: {
        doc: WorldDocumentV1;
        clock: EntityClock;
        rev: number;
        updatedAt: string;
    };
    session: WorldDocumentSession;
    history: EditHistory;
    userId: string;
}

/** Counters for the debug overlay and the smoke harness (`window.__sharedWorld`). */
export interface SharedWorldStats {
    sent: number;
    applied: number;
    dropped: Record<string, number>;
    writes: number;
    reconciles: number;
}

/** Make the world show `effect.to`: re-place by id, or despawn by id. */
export function applyWorldEffect(effect: WorldEffect): void {
    try {
        if (effect.to) new MoveCommand(effect.from ?? effect.to, effect.to).apply();
        else if (effect.from) new RemoveCommand(effect.from).apply();
    } catch (err) {
        console.warn(`[SharedWorlds] Could not apply a change to "${effect.id}":`, err);
    }
}

export class SharedWorldSession {
    readonly peerId = crypto.randomUUID();
    readonly worldId: string;
    readonly role: SharedWorldRecord['role'];
    readonly stats: SharedWorldStats = {
        sent: 0,
        applied: 0,
        dropped: {},
        writes: 0,
        reconciles: 0,
    };

    private readonly replica: SharedWorldReplica;
    private readonly joinedAt = Date.now();
    private readonly canEdit: boolean;
    private readonly limiters = {
        cmd: new PeerRateLimiter(WORLD_SYNC_LIMITS.cmdRate),
        progress: new PeerRateLimiter(WORLD_SYNC_LIMITS.progressRate),
        cursor: new PeerRateLimiter(WORLD_SYNC_LIMITS.cursorRate),
    };
    private readonly progressRoom = new TokenBucket(
        WORLD_SYNC_LIMITS.progressRoomRate.perSecond,
        WORLD_SYNC_LIMITS.progressRoomRate.burst
    );
    private readonly kicked = new Set<string>();
    /** Local edits taken back for breaking a cap: their undo / redo is not news. */
    private readonly takenBack = new WeakSet<WorldCommand>();
    private editChannel: RealtimeChannel | null = null;
    private ownerChannel: RealtimeChannel | null = null;
    private cursors: RemoteCursors | null = null;
    private hostId: string | null = null;
    private dirty = false;
    private writing = false;
    private retryWriteAt = 0;
    private updatedAt: string;
    private lastReconcile = 0;
    private reconcileTimer: number | null = null;
    private subscribedOnce = false;
    private cursorWasHit = false;
    private stopped = false;
    private readonly cleanups: Array<() => void> = [];

    constructor(private readonly deps: SharedWorldSessionDeps) {
        this.worldId = deps.record.summary.id;
        this.role = deps.record.role;
        this.canEdit = this.role === 'owner' || this.role === 'editor';
        this.updatedAt = deps.base.updatedAt;
        this.replica = new SharedWorldReplica(this.peerId, {
            commands: deps.base.doc.commands,
            rev: deps.base.rev,
            entityClock: deps.base.clock,
        });
    }

    get isHost(): boolean {
        return this.canEdit && this.hostId === this.peerId;
    }

    get editable(): boolean {
        return this.canEdit;
    }

    /** False once the session left (stopped, or the owner removed it). */
    get active(): boolean {
        return !this.stopped;
    }

    /** Snapshot hash of the shared world as this peer holds it. */
    hash(): string {
        return this.replica.hash();
    }

    async start(): Promise<boolean> {
        const { session, history, client } = this.deps;
        session.setCommandSource(() => this.replica.documentCommands());
        this.cleanups.push(() => session.setCommandSource(null));
        this.cleanups.push(history.subscribe((event, cmd) => this.onLocalEdit(event, cmd)));
        this.cleanups.push(onProgress((event) => this.sendProgress(event)));

        const scene = presenceSystem.scene;
        if (scene) this.cursors = new RemoteCursors(scene, (id) => this.locate(id));

        const joined = await presenceSystem.join({
            room: `world:${this.worldId}`,
            privateChannel: true,
            sessionId: this.peerId,
            meta: { joinedAt: this.joinedAt, canEdit: this.canEdit },
        });
        if (!joined) console.warn('[SharedWorlds] Could not join the world room (no presence)');

        // Kicks: only the owner can send here, so peers can act on one.
        const ownerChannel = client.channel(`world:${this.worldId}:owner`, {
            config: { private: true, broadcast: { self: false } },
        });
        ownerChannel.on('broadcast', { event: WORLD_SYNC_EVENTS.kick }, ({ payload }) =>
            this.onKick(payload)
        );
        ownerChannel.subscribe((status) => {
            if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR)
                console.warn('[SharedWorlds] The owner channel refused this session (no kicks)');
        });
        this.ownerChannel = ownerChannel;

        const channel = client.channel(`world:${this.worldId}:edit`, {
            config: { private: true, presence: { key: this.peerId }, broadcast: { self: false } },
        });
        channel
            .on('broadcast', { event: WORLD_SYNC_EVENTS.cmd }, ({ payload }) => this.onCmd(payload))
            .on('broadcast', { event: WORLD_SYNC_EVENTS.cursor }, ({ payload }) =>
                this.onCursor(payload)
            )
            .on(
                'broadcast',
                { event: WORLD_SYNC_EVENTS.sync },
                ({ payload }) => void this.onSync(payload)
            )
            .on('broadcast', { event: WORLD_SYNC_EVENTS.progress }, ({ payload }) =>
                this.onProgressMessage(payload)
            )
            .on('presence', { event: 'sync' }, () => this.electHost())
            .on('presence', { event: 'leave' }, ({ key }) => {
                if (key) this.cursors?.remove(key);
                this.electHost();
            });
        this.editChannel = channel;

        const subscribed = await new Promise<boolean>((resolve) => {
            channel.subscribe((status) => {
                if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
                    void this.onSubscribed();
                    resolve(true);
                } else if (
                    status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
                    status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
                ) {
                    resolve(false);
                }
            });
        });
        if (!subscribed) {
            console.warn(
                '[SharedWorlds] The edit channel refused this session; edits sync on save instead'
            );
            // Hand the command log back to the document session, so saves (and
            // the offline-first push) carry this player's edits.
            await this.stop();
            return false;
        }

        const tick = window.setInterval(() => this.tick(), 1000 / WORLD_SYNC_LIMITS.cursorHz);
        const writeBack = window.setInterval(() => void this.writeBack(), WRITE_BACK_MS);
        const onHide = () => {
            if (document.visibilityState === 'hidden') void this.writeBack();
        };
        const onPageHide = () => void this.writeBack();
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('pagehide', onPageHide);
        this.cleanups.push(() => {
            window.clearInterval(tick);
            window.clearInterval(writeBack);
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('pagehide', onPageHide);
        });
        if (this.role === 'owner') {
            presenceSystem.setKickHandler((peer) => void this.kick(peer));
            this.cleanups.push(() => presenceSystem.setKickHandler(null));
        }
        (window as Window & { __sharedWorld?: unknown }).__sharedWorld = this;
        return true;
    }

    async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        await this.writeBack(true);
        for (const fn of this.cleanups.splice(0)) fn();
        if (this.reconcileTimer !== null) window.clearTimeout(this.reconcileTimer);
        this.reconcileTimer = null;
        this.cursors?.dispose();
        this.cursors = null;
        for (const channel of [this.editChannel, this.ownerChannel]) {
            if (channel) await this.deps.client.removeChannel(channel);
        }
        this.editChannel = null;
        this.ownerChannel = null;
        await presenceSystem.leave();
        const w = window as Window & { __sharedWorld?: unknown };
        if (w.__sharedWorld === this) delete w.__sharedWorld;
    }

    // -- Joining and hosting ------------------------------------------------

    private async onSubscribed(): Promise<void> {
        if (this.canEdit && this.editChannel) {
            const meta: EditPresence = {
                id: this.peerId,
                joinedAt: this.joinedAt,
                canEdit: true,
                userId: this.deps.userId,
            };
            await this.editChannel.track(meta);
        }
        // Catch up from the stored world: on the first join, with what was
        // written since this copy was read; on a reconnect, with what the
        // room said while this session was away.
        void this.reconcile(true);
        this.subscribedOnce = true;
        this.electHost();
    }

    private editPresence(): Map<string, EditPresence> {
        const out = new Map<string, EditPresence>();
        const state = this.editChannel?.presenceState<EditPresence>() ?? {};
        for (const [key, entries] of Object.entries(state)) {
            const meta = entries[entries.length - 1];
            if (!meta) continue;
            out.set(key, {
                id: key,
                joinedAt:
                    typeof meta.joinedAt === 'number' ? meta.joinedAt : Number.MAX_SAFE_INTEGER,
                canEdit: meta.canEdit === true,
                userId: typeof meta.userId === 'string' ? meta.userId : undefined,
            });
        }
        return out;
    }

    private electHost(): void {
        const before = this.hostId;
        const candidates = [...this.editPresence().values()].filter((c) => !this.kicked.has(c.id));
        this.hostId = electHost(candidates);
        if (this.hostId !== before && this.isHost) {
            log.info('SharedWorlds', 'This session is the host: it saves the shared world');
            this.dirty = true;
        }
    }

    /**
     * Host: write the merged world back, then tell the room what it wrote.
     * The document, clock, rev and hash are taken in one tick, so they always
     * describe the same replica state; edits that land while the write is in
     * flight mark the world dirty again for the next one.
     */
    private async writeBack(leaving = false): Promise<void> {
        if (!this.isHost || !this.dirty || this.writing) return;
        if (!leaving && Date.now() < this.retryWriteAt) return;
        this.writing = true;
        const doc = this.deps.session.capture();
        const clock = this.replica.exportClock();
        const rev = this.replica.rev;
        const hash = this.replica.hash();
        this.dirty = false;
        this.deps.session.scheduleSave();
        try {
            const result = await this.deps.remote.publish(doc, {
                rev,
                entityClock: clock,
                expectedUpdatedAt: this.updatedAt,
            });
            if (result.ok) {
                this.updatedAt = result.world.updatedAt;
                this.retryWriteAt = 0;
                this.stats.writes++;
                this.deps.sync.noteSynced(result.world, doc, clock);
                this.send(WORLD_SYNC_EVENTS.sync, {
                    author: this.peerId,
                    rev,
                    hash,
                    updatedAt: this.updatedAt,
                });
                return;
            }
            this.dirty = true;
            if (result.code === 'conflict') {
                // Written elsewhere (an offline push, an earlier host): fold it in, retry next tick.
                await this.reconcile(true);
            } else if (result.code !== 'offline') {
                this.retryWriteAt = Date.now() + WRITE_BACK_RETRY_MS;
                console.warn(
                    `[SharedWorlds] Saving the shared world failed: ${result.code}: ${result.message}`
                );
            }
        } catch (err) {
            this.dirty = true;
            console.warn('[SharedWorlds] Saving the shared world failed:', err);
        } finally {
            this.writing = false;
        }
    }

    /**
     * Fetch the stored world and adopt what it holds that is newer; re-send
     * what it lacks. A call inside the throttle window is deferred to its end,
     * not dropped: the hash that asked for it may be the last one for a while.
     */
    private async reconcile(force = false): Promise<void> {
        const now = Date.now();
        if (!force && now - this.lastReconcile < RECONCILE_MIN_MS) {
            if (this.reconcileTimer === null && !this.stopped) {
                this.reconcileTimer = window.setTimeout(
                    () => {
                        this.reconcileTimer = null;
                        void this.reconcile();
                    },
                    this.lastReconcile + RECONCILE_MIN_MS - now
                );
            }
            return;
        }
        this.lastReconcile = now;
        const record = await this.deps.remote.fetch(this.worldId).catch(() => null);
        if (!record || this.stopped) return;
        const { effects, resend } = this.replica.reconcile({
            commands: record.doc.commands,
            rev: record.summary.rev,
            entityClock: record.entityClock,
        });
        for (const effect of effects) applyWorldEffect(effect);
        for (const message of resend) this.send(WORLD_SYNC_EVENTS.cmd, message);
        this.updatedAt = record.summary.updatedAt;
        this.stats.reconciles++;
        if (effects.length > 0 || resend.length > 0) {
            this.dirty = true;
            this.deps.session.scheduleSave();
        }
    }

    // -- Edits ----------------------------------------------------------------

    private onLocalEdit(event: EditHistoryEvent, cmd: WorldCommand): void {
        if (!this.canEdit) return;
        if (this.takenBack.has(cmd)) {
            this.takenBack.delete(cmd);
            return;
        }
        const data = cmd.serialize() as DocumentCommand | null;
        if (!data) return;
        const command = event === 'undo' ? invertCommand(data) : data;
        const refusal = this.replica.capRefusal(command);
        if (refusal) return this.takeBack(event, cmd, refusal);
        const { message, effects } = this.replica.local(command);
        for (const effect of effects) applyWorldEffect(effect);
        this.dirty = true;
        this.send(WORLD_SYNC_EVENTS.cmd, message);
    }

    /**
     * A local edit no peer would accept (the room is fuller than build mode
     * could see, or an undo / redo re-adds a piece): step it back out.
     */
    private takeBack(event: EditHistoryEvent, cmd: WorldCommand, refusal: string): void {
        log.info('SharedWorlds', `Took back a local edit: ${refusal}`);
        this.takenBack.add(cmd);
        showToast('This grove is full — that change was taken back', '⛔', 3000);
        queueMicrotask(() => {
            const { history } = this.deps;
            if (event === 'undo') history.redo();
            else if (history.isUndoable(cmd)) history.undo();
            else this.takenBack.delete(cmd);
        });
    }

    private onCmd(payload: unknown): void {
        const parsed = parseCmdMessage(payload);
        if (!parsed.ok) return this.drop(parsed.reason, parsed.detail, payload);
        const message = parsed.message;
        if (this.kicked.has(message.author)) return this.drop('blocked', 'kicked peer', payload);
        if (!this.limiters.cmd.allow(message.author, performance.now())) {
            return this.drop('rate_limited', `cmd from ${message.author}`, payload);
        }
        const outcome = this.replica.receive(message);
        if (outcome.status === 'duplicate') return;
        if (outcome.status === 'rejected') {
            this.drop(outcome.reason, outcome.detail, payload);
            // The host's word is final: take the refused edit back out for
            // peers that applied it.
            if (this.isHost) this.compensate(message);
            return;
        }
        for (const effect of outcome.effects) applyWorldEffect(effect);
        this.stats.applied++;
        if (outcome.effects.length > 0) {
            this.dirty = true;
            this.deps.session.scheduleSave();
        }
    }

    private compensate(refused: CmdMessage): void {
        const command = this.replica.compensation(refused);
        if (!command) return;
        const { message } = this.replica.local(command);
        this.send(WORLD_SYNC_EVENTS.cmd, message);
    }

    private async onSync(payload: unknown): Promise<void> {
        const parsed = parseSyncMessage(payload);
        if (!parsed.ok) return this.drop(parsed.reason, parsed.detail, payload);
        const { author, hash, rev, updatedAt } = parsed.message;
        if (author !== this.hostId) return;
        if (hash === this.replica.hash()) {
            this.updatedAt = updatedAt;
            // The row holds what this copy holds: none of it is an unsynced
            // local edit any more (the next offline merge starts from here).
            this.deps.sync.noteRoomState(this.worldId, {
                updatedAt,
                rev,
                commands: this.replica.documentCommands(),
                clock: this.replica.exportClock(),
            });
            return;
        }
        await this.reconcile();
    }

    // -- Cursors, progress, kicks --------------------------------------------

    private tick(): void {
        const now = performance.now();
        this.cursors?.prune(now);
        if (!this.canEdit) return;
        const cursor = getBuildCursor();
        if (!cursor.hit && !this.cursorWasHit) return;
        this.cursorWasHit = cursor.hit;
        this.send(WORLD_SYNC_EVENTS.cursor, {
            author: this.peerId,
            pos: cursor.hit ? [cursor.x, cursor.y, cursor.z] : null,
            selection: cursor.hit ? getBuildSelection().slice(0, 32) : [],
            tool: cursor.tool,
        });
    }

    private onCursor(payload: unknown): void {
        const parsed = parseCursorMessage(payload);
        if (!parsed.ok) return this.drop(parsed.reason, parsed.detail, payload);
        const { author } = parsed.message;
        if (this.kicked.has(author) || presenceSystem.isPeerMuted(author)) return;
        if (!this.limiters.cursor.allow(author, performance.now())) return;
        this.cursors?.update(parsed.message, performance.now());
    }

    /** Builders share progress (the edit topic); visitors keep theirs to themselves. */
    private sendProgress(event: ProgressEvent): void {
        if (!this.canEdit) return;
        const payload: Record<string, unknown> = {
            author: this.peerId,
            kind: event.kind,
            id: event.id,
        };
        if (event.type) payload.type = event.type.slice(0, 64);
        this.send(WORLD_SYNC_EVENTS.progress, payload);
    }

    private onProgressMessage(payload: unknown): void {
        const parsed = parseProgressMessage(payload);
        if (!parsed.ok) return this.drop(parsed.reason, parsed.detail, payload);
        const { author, kind, id, type } = parsed.message;
        if (this.kicked.has(author) || presenceSystem.isPeerMuted(author)) return;
        // From an editor in the room (its presence), not an id made up for the message.
        if (!this.editPresence().has(author)) {
            return this.drop('blocked', `progress from ${author}, who is not in the room`, payload);
        }
        const now = performance.now();
        if (!this.limiters.progress.allow(author, now) || !this.progressRoom.take(now)) {
            return this.drop('rate_limited', `progress from ${author}`, payload);
        }
        const refusal = progressRefusal(parsed.message, PROGRESS_CATALOG);
        if (refusal) return this.drop('malformed', refusal, payload);
        applyRemoteProgress(() => {
            if (kind === 'awakened') {
                const persistentId = Number(id);
                awakenedPersistence.markAwakened(persistentId, {
                    type: awakenedPersistence.placedType(persistentId) ?? type ?? 'unknown',
                });
            } else if (discoverySystem.restore([id]) > 0) {
                announce(
                    kind === 'stamp'
                        ? 'An explorer collected a stamp'
                        : 'An explorer made a discovery',
                    'polite'
                );
            }
        });
        this.deps.session.scheduleSave();
    }

    /**
     * Owner: remove a peer's membership first, then tell the room (on the
     * owner topic, which only the owner can send on).
     */
    private async kick(peerId: string): Promise<void> {
        if (this.role !== 'owner' || peerId === this.peerId) return;
        const target = this.editPresence().get(peerId);
        this.kicked.add(peerId);
        presenceSystem.blockPeer(peerId);
        this.cursors?.remove(peerId);
        if (target?.userId && target.userId !== this.deps.userId) {
            await this.deps.backend
                .removeMember(this.worldId, target.userId)
                .catch((err) => console.warn('[SharedWorlds] Could not revoke access:', err));
        }
        void this.ownerChannel?.send({
            type: 'broadcast',
            event: WORLD_SYNC_EVENTS.kick,
            payload: { author: this.peerId, target: peerId },
        });
        showToast('Removed from this world', '🚪', 2500);
        this.electHost();
    }

    private onKick(payload: unknown): void {
        const parsed = parseKickMessage(payload);
        if (!parsed.ok) return this.drop(parsed.reason, parsed.detail, payload);
        const { target } = parsed.message;
        if (target === this.peerId) {
            void this.onKickedSelf();
            return;
        }
        this.kicked.add(target);
        presenceSystem.blockPeer(target);
        this.cursors?.remove(target);
        this.electHost();
    }

    /** The owner removed this session: confirm with the database, then leave. */
    private async onKickedSelf(): Promise<void> {
        const record = await this.deps.remote.fetch(this.worldId).catch(() => null);
        const role = record?.role ?? null;
        if (this.canEdit && (role === 'owner' || role === 'editor')) {
            console.warn('[SharedWorlds] Ignored a kick: this account can still edit the world');
            return;
        }
        showToast('The owner removed you from this world', '🚪', 5000);
        await this.stop();
    }

    // -- Plumbing -------------------------------------------------------------

    private send(event: string, payload: unknown): void {
        if (!this.editChannel) return;
        if (
            event === WORLD_SYNC_EVENTS.cmd &&
            JSON.stringify(payload).length > WORLD_SYNC_LIMITS.maxCmdChars
        ) {
            console.warn(
                '[SharedWorlds] An edit is too large to broadcast; peers get it from the next save'
            );
            return;
        }
        if (event === WORLD_SYNC_EVENTS.cmd) this.stats.sent++;
        void this.editChannel.send({ type: 'broadcast', event, payload });
    }

    /** Refused inbound traffic: counted and logged, never applied. */
    private drop(reason: string, detail: string, payload: unknown): void {
        this.stats.dropped[reason] = (this.stats.dropped[reason] ?? 0) + 1;
        const author = (payload as { author?: unknown } | null)?.author;
        console.warn(
            `[SharedWorlds] Dropped inbound ${reason}${typeof author === 'string' ? ` from ${author}` : ''}: ${detail}`
        );
    }

    private locate(entityId: string): THREE.Vector3 | null {
        const state: EntityState | undefined = this.replica.stateOf(entityId);
        if (state) {
            const [x, y, z] = state.entity.position;
            return new THREE.Vector3(x, y, z);
        }
        for (const obj of animatedFoliage as unknown as THREE.Object3D[]) {
            if (obj?.userData?.mapEntityId === entityId) return obj.position.clone();
        }
        return null;
    }
}
