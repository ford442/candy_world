/**
 * @file src/systems/net/world-sync-protocol.ts
 * @brief Live co-editing of a shared world, as a pure protocol (#1975).
 *
 * Peers in `world:<id>` exchange authored edits as `cmd` messages. Each
 * message is one `DocumentCommand` (what `WorldCommand.serialize()` writes)
 * stamped with a Lamport `(rev, author)`. Every entity is a last-writer-wins
 * register: the write with the larger stamp holds, whatever order messages
 * arrive in and however often, so replicas that have seen the same messages
 * hold the same world (`SharedWorldReplica.hash()`). `(author, seq)` makes
 * delivery idempotent.
 *
 * Broadcast is best-effort, and an inbound check can depend on what a replica
 * already holds (the entity caps), so replicas can drift. The elected host
 * repairs that: it writes the merged document back with each entity's stamp
 * (`exportClock()`), announces its hash in a `sync` message, and a replica
 * whose hash differs fetches the document and `reconcile()`s: it adopts every
 * newer write the document holds and re-sends its own writes the host missed.
 * The host also answers a command it refused for the caps with a compensating
 * write (`compensation()`), so peers that applied it take it back out.
 *
 * Nothing here touches the renderer or the network: tests drive two replicas
 * through in-memory channels (tests/world-sync-protocol.test.ts), and
 * `shared-world-session.ts` binds one to Supabase Realtime and the live world.
 * docs/SHARED_WORLDS.md has the full protocol.
 */

import * as v from 'valibot';
import {
    entityStateHash,
    isUnchanged,
    netEntityChanges,
    sameJson,
    transitionsOf,
    type EntityState,
} from '../../world/document/entity-state.ts';
import {
    CANDY_PAINT_PALETTE,
    isCandyPaint,
    nearestCandyPaint,
} from '../../world/document/paint-palette.ts';
import {
    DocumentCommandSchema,
    EntitySnapshotSchema,
    type DocumentCommand,
} from '../../world/document/schema.ts';
import {
    SHARED_WORLD_LIMITS,
    sharedChunkKey,
    type ClockStamp,
    type EntityClock,
} from '../../world/document/shared-validation.ts';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Broadcast event names, next to presence's `pose`. */
export const WORLD_SYNC_EVENTS = {
    cmd: 'cmd',
    progress: 'progress',
    cursor: 'cursor',
    sync: 'sync',
    kick: 'kick',
} as const;

export const WORLD_SYNC_LIMITS = {
    /** Serialized `cmd` payload (a 32-piece move with its origins fits). */
    maxCmdChars: 96 * 1024,
    /** Serialized `progress` / `cursor` / `sync` / `kick` payload. */
    maxSmallChars: 2048,
    /** Entities one command may touch. */
    maxEntitiesPerCommand: 64,
    /** Inbound token buckets, per peer. */
    cmdRate: { perSecond: 12, burst: 40 },
    progressRate: { perSecond: 10, burst: 30 },
    /** All peers' `progress` together: a room can't be flooded by rotating author ids. */
    progressRoomRate: { perSecond: 4, burst: 40 },
    cursorRate: { perSecond: 8, burst: 8 },
    /** Build-mode cursor send rate (poses go at `CONFIG.presence.tickHz`). */
    cursorHz: 4,
} as const;

export type ProgressKind = 'awakened' | 'stamp' | 'discovery';

/** One authored edit. */
export interface CmdMessage {
    /** Peer (session) id; with `rev`, the write's stamp. */
    author: string;
    /** Per-author sequence number, from 1: `(author, seq)` dedupes delivery. */
    seq: number;
    /** Lamport clock value of this write. */
    rev: number;
    /** The document revision the author opened (diagnostics; see `reconcile`). */
    baseRev: number;
    command: DocumentCommand;
    /**
     * The author's base state for entities whose base it learned before this
     * write, with the stamp it learned it from (null: the document). A peer
     * that missed the entity's first write still learns its true base.
     */
    origins?: Record<string, OriginClaim>;
    /**
     * Sent again after a sync showed the host missed it. Skips the seq dedupe
     * (whose window may have given up on the gap); applying it twice is
     * harmless, the stamp comparison makes it a no-op.
     */
    resend?: true;
}

export interface OriginClaim {
    state: EntityState;
    stamp: ClockStamp | null;
}

/** Shared progress: one player awakening a flower awakens it for the room. */
export interface ProgressMessage {
    author: string;
    kind: ProgressKind;
    id: string;
    /** Flora type for `awakened` (so a peer that has not met it yet can keep it). */
    type?: string;
}

/** A build-mode reticle and selection, a few times a second. */
export interface CursorMessage {
    author: string;
    /** Null when the player is not aiming at the ground (or left build mode). */
    pos: [number, number, number] | null;
    selection: string[];
    tool?: string;
}

/** The host wrote the merged document back. */
export interface SyncMessage {
    author: string;
    rev: number;
    /** `SharedWorldReplica.hash()` of what it wrote. */
    hash: string;
    updatedAt: string;
}

/** The world owner removed a peer from the room. */
export interface KickMessage {
    author: string;
    target: string;
}

const PeerIdSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/));
const CountSchema = v.pipe(
    v.number(),
    v.integer(),
    v.minValue(0),
    v.maxValue(Number.MAX_SAFE_INTEGER)
);
const Finite = v.pipe(v.number(), v.finite());

const StampSchema = v.tuple([CountSchema, PeerIdSchema]);

const CmdMessageSchema = v.object({
    author: PeerIdSchema,
    seq: v.pipe(CountSchema, v.minValue(1)),
    rev: CountSchema,
    baseRev: CountSchema,
    command: DocumentCommandSchema,
    origins: v.optional(
        v.record(
            v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
            v.object({ state: v.nullable(EntitySnapshotSchema), stamp: v.nullable(StampSchema) })
        )
    ),
    resend: v.optional(v.literal(true)),
});

const ProgressMessageSchema = v.object({
    author: PeerIdSchema,
    kind: v.picklist(['awakened', 'stamp', 'discovery']),
    id: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_:.-]{1,128}$/)),
    type: v.optional(v.pipe(v.string(), v.maxLength(64))),
});

const CursorMessageSchema = v.object({
    author: PeerIdSchema,
    pos: v.nullable(v.tuple([Finite, Finite, Finite])),
    selection: v.pipe(v.array(v.pipe(v.string(), v.maxLength(128))), v.maxLength(32)),
    tool: v.optional(v.pipe(v.string(), v.maxLength(16))),
});

const SyncMessageSchema = v.object({
    author: PeerIdSchema,
    rev: CountSchema,
    hash: v.pipe(v.string(), v.regex(/^[0-9a-f]{14}$/)),
    updatedAt: v.pipe(v.string(), v.maxLength(64)),
});

const KickMessageSchema = v.object({ author: PeerIdSchema, target: PeerIdSchema });

export type InboundRejection = 'malformed' | 'too_large' | 'over_cap' | 'rate_limited' | 'blocked';

export type InboundResult<T> =
    { ok: true; message: T } | { ok: false; reason: InboundRejection; detail: string };

function parseWith<T>(
    schema: v.GenericSchema<unknown, T>,
    payload: unknown,
    maxChars: number,
    label: string
): InboundResult<T> {
    let chars: number;
    try {
        chars = JSON.stringify(payload)?.length ?? 0;
    } catch {
        return { ok: false, reason: 'malformed', detail: `${label} is not JSON` };
    }
    if (chars > maxChars) {
        return {
            ok: false,
            reason: 'too_large',
            detail: `${label} of ${chars} chars (max ${maxChars})`,
        };
    }
    const result = v.safeParse(schema, payload);
    if (!result.success) {
        const issue = result.issues[0];
        const path = v.getDotPath(issue);
        return {
            ok: false,
            reason: 'malformed',
            detail: `${label}${path ? ` at ${path}` : ''}: ${issue.message}`,
        };
    }
    return { ok: true, message: result.output };
}

/** Move and paint keep their entity: `from` and `to` share an id. */
function idsConsistent(cmd: DocumentCommand): boolean {
    if (cmd.type === 'batch') return cmd.commands.every(idsConsistent);
    if (cmd.type === 'move' || cmd.type === 'paint') return cmd.from.id === cmd.to.id;
    return true;
}

/**
 * Aesthetic guardrail: a colour outside `CANDY_PAINT_PALETTE` (a paint, a
 * placement, or a move that recolours) becomes the nearest candy colour.
 * Deterministic, so every replica clamps alike.
 */
export function clampCommandPalette(cmd: DocumentCommand): DocumentCommand {
    if (cmd.type === 'batch') return { ...cmd, commands: cmd.commands.map(clampCommandPalette) };
    if (cmd.type === 'remove') return cmd;
    const to = cmd.type === 'place' ? cmd.snapshot : cmd.to;
    const params: Record<string, unknown> = to.entity.params ?? {};
    const color = params.color;
    if (color === undefined || isCandyPaint(color)) return cmd;
    // A move that keeps the colour it had is not a recolour (map pieces).
    if (cmd.type === 'move' && color === (cmd.from.entity.params ?? {}).color) return cmd;
    const clamped =
        typeof color === 'number' && Number.isFinite(color)
            ? nearestCandyPaint(color & 0xffffff)
            : CANDY_PAINT_PALETTE[0].hex;
    const recoloured = { ...to, entity: { ...to.entity, params: { ...params, color: clamped } } };
    return cmd.type === 'place' ? { ...cmd, snapshot: recoloured } : { ...cmd, to: recoloured };
}

/** Validate an inbound `cmd` payload; the palette is clamped on the way in. */
export function parseCmdMessage(payload: unknown): InboundResult<CmdMessage> {
    const parsed = parseWith(CmdMessageSchema, payload, WORLD_SYNC_LIMITS.maxCmdChars, 'cmd');
    if (!parsed.ok) return parsed;
    const command = parsed.message.command;
    if (!idsConsistent(command)) {
        return { ok: false, reason: 'malformed', detail: 'cmd moves one entity onto another id' };
    }
    const touched = transitionsOf(command).length;
    if (touched === 0) return { ok: false, reason: 'malformed', detail: 'cmd changes nothing' };
    if (touched > WORLD_SYNC_LIMITS.maxEntitiesPerCommand) {
        return {
            ok: false,
            reason: 'over_cap',
            detail: `cmd touches ${touched} entities (max ${WORLD_SYNC_LIMITS.maxEntitiesPerCommand})`,
        };
    }
    return { ok: true, message: { ...parsed.message, command: clampCommandPalette(command) } };
}

export function parseProgressMessage(payload: unknown): InboundResult<ProgressMessage> {
    return parseWith(ProgressMessageSchema, payload, WORLD_SYNC_LIMITS.maxSmallChars, 'progress');
}

export function parseCursorMessage(payload: unknown): InboundResult<CursorMessage> {
    return parseWith(CursorMessageSchema, payload, WORLD_SYNC_LIMITS.maxSmallChars, 'cursor');
}

export function parseSyncMessage(payload: unknown): InboundResult<SyncMessage> {
    return parseWith(SyncMessageSchema, payload, WORLD_SYNC_LIMITS.maxSmallChars, 'sync');
}

export function parseKickMessage(payload: unknown): InboundResult<KickMessage> {
    return parseWith(KickMessageSchema, payload, WORLD_SYNC_LIMITS.maxSmallChars, 'kick');
}

/** What a peer's progress may name. */
export interface ProgressCatalog {
    /** Discovery ids (`DISCOVERY_MAP`). */
    discoveries: ReadonlySet<string>;
    /** Flora types that awaken (`AWAKENABLE_TYPES`). */
    awakenable: ReadonlySet<string>;
    /** The type of the flora placed here under this persistent id, if one is. */
    placedType?(persistentId: number): string | undefined;
}

/** `night_market_stamp:<stall entity id>` (`night-market-stamps.ts`). */
const STAMP_ID_RE = /^night_market_stamp:[A-Za-z0-9_.:-]{1,96}$/;

/**
 * Why a peer's progress can't be applied (null: it can). A discovery has to
 * be in the catalog, a stamp well formed, an awakening a uint32 persistent id
 * of an awakenable type; when the flora is placed here, its own type decides.
 */
export function progressRefusal(message: ProgressMessage, catalog: ProgressCatalog): string | null {
    if (message.kind === 'discovery') {
        return catalog.discoveries.has(message.id) ? null : `unknown discovery "${message.id}"`;
    }
    if (message.kind === 'stamp') {
        return STAMP_ID_RE.test(message.id) ? null : `malformed stamp "${message.id}"`;
    }
    const persistentId = Number(message.id);
    if (!/^[0-9]{1,10}$/.test(message.id) || persistentId <= 0 || persistentId > 0xffffffff) {
        return `malformed flora id "${message.id}"`;
    }
    const placed = catalog.placedType?.(persistentId);
    if (placed && message.type && placed !== message.type) {
        return `flora ${persistentId} is a ${placed}, not a ${message.type}`;
    }
    const type = placed ?? message.type;
    return type && catalog.awakenable.has(type) ? null : `a "${type ?? 'unknown'}" can't awaken`;
}

// ---------------------------------------------------------------------------
// Rate limits, dedupe, host election
// ---------------------------------------------------------------------------

export class TokenBucket {
    private tokens: number;
    private last: number | null = null;

    constructor(
        private readonly perSecond: number,
        private readonly burst: number
    ) {
        this.tokens = burst;
    }

    /** Spend one token at time `now` (ms); false when the bucket is empty. */
    take(now: number): boolean {
        if (this.last !== null) {
            const refill = (Math.max(0, now - this.last) / 1000) * this.perSecond;
            this.tokens = Math.min(this.burst, this.tokens + refill);
        }
        this.last = now;
        if (this.tokens < 1) return false;
        this.tokens -= 1;
        return true;
    }
}

/** One token bucket per peer. */
export class PeerRateLimiter {
    private readonly buckets = new Map<string, TokenBucket>();

    constructor(private readonly rate: { perSecond: number; burst: number }) {}

    allow(peer: string, now: number): boolean {
        let bucket = this.buckets.get(peer);
        if (!bucket) {
            bucket = new TokenBucket(this.rate.perSecond, this.rate.burst);
            this.buckets.set(peer, bucket);
        }
        return bucket.take(now);
    }

    forget(peer: string): void {
        this.buckets.delete(peer);
    }
}

/** Seen `(author, seq)` pairs: a contiguous floor per author plus the gaps above it. */
export class SeqTracker {
    private readonly byAuthor = new Map<string, { floor: number; above: Set<number> }>();

    constructor(private readonly maxGaps = 1024) {}

    /** Record `seq`; false when it was seen before. */
    add(author: string, seq: number): boolean {
        let entry = this.byAuthor.get(author);
        if (!entry) {
            entry = { floor: 0, above: new Set() };
            this.byAuthor.set(author, entry);
        }
        if (seq <= entry.floor || entry.above.has(seq)) return false;
        entry.above.add(seq);
        // A seq lost for good would grow the set forever: past `maxGaps`, give up
        // on the oldest gap (a straggler below the floor is then dropped as seen;
        // the host's sync repairs whatever it carried).
        while (entry.above.size > this.maxGaps) {
            const lowest = Math.min(...entry.above);
            entry.above.delete(lowest);
            entry.floor = lowest;
        }
        while (entry.above.has(entry.floor + 1)) {
            entry.above.delete(entry.floor + 1);
            entry.floor++;
        }
        return true;
    }
}

export interface HostCandidate {
    id: string;
    /** When the peer joined the room (ms since epoch). */
    joinedAt: number;
    /** Only an editor can write the document back. */
    canEdit: boolean;
}

/** The host is the editor who joined first (ties: the smaller id). */
export function electHost(candidates: Iterable<HostCandidate>): string | null {
    let best: HostCandidate | null = null;
    for (const c of candidates) {
        if (!c.canEdit) continue;
        if (
            !best ||
            c.joinedAt < best.joinedAt ||
            (c.joinedAt === best.joinedAt && c.id < best.id)
        ) {
            best = c;
        }
    }
    return best ? best.id : null;
}

// ---------------------------------------------------------------------------
// The replica
// ---------------------------------------------------------------------------

/** Lamport order; null (the opened document's own base) sorts before every write. */
export function compareStamps(a: ClockStamp | null, b: ClockStamp | null): number {
    if (a === b) return 0;
    if (!a) return b ? -1 : 0;
    if (!b) return 1;
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}

/** What the world must do for one entity: show `to` where it showed `from`. */
export interface WorldEffect {
    id: string;
    from: EntityState;
    to: EntityState;
}

/** A shared world as stored: its commands and co-editing clock. */
export interface SharedDocumentState {
    commands: readonly DocumentCommand[];
    rev?: number;
    entityClock?: EntityClock;
}

export type ReceiveOutcome =
    | { status: 'applied'; effects: WorldEffect[]; superseded: number }
    | { status: 'duplicate' }
    | { status: 'rejected'; reason: 'over_cap' | 'clock'; detail: string };

/** A write may run at most this far ahead of the replica's clock (a forged rev would win forever). */
export const MAX_REV_JUMP = SHARED_WORLD_LIMITS.maxRevJump;

export interface ReplicaCaps {
    total: number;
    perChunk: number;
}

interface Register {
    /** Null: the opened document's own base state. */
    stamp: ClockStamp | null;
    /** Undefined: as the base world has it (the document's clock knew only the stamp). */
    state: EntityState | undefined;
}

interface Origin {
    /** The entity before any authored edit (null: not in the base world). */
    state: EntityState;
    /** The write it was learned from; null for the document base (earliest of all). */
    stamp: ClockStamp | null;
}

export class SharedWorldReplica {
    private clock = 0;
    private seq = 0;
    private readonly baseRev: number;
    private readonly registers = new Map<string, Register>();
    private readonly origins = new Map<string, Origin>();
    private readonly seen = new SeqTracker();
    /** This peer's latest message per entity, for re-sending after a sync. */
    private readonly ownLatest = new Map<string, CmdMessage>();

    constructor(
        readonly author: string,
        doc: SharedDocumentState,
        private readonly caps: ReplicaCaps | null = {
            total: SHARED_WORLD_LIMITS.maxEntities,
            perChunk: SHARED_WORLD_LIMITS.maxEntitiesPerChunk,
        }
    ) {
        this.adoptBase(doc);
        this.baseRev = this.clock;
    }

    /** The Lamport high-water mark (`worlds.rev`). */
    get rev(): number {
        return this.clock;
    }

    /** A local edit: stamp it, record it, and say what the world must still fix. */
    local(command: DocumentCommand): { message: CmdMessage; effects: WorldEffect[] } {
        const stamp: ClockStamp = [++this.clock, this.author];
        const message: CmdMessage = {
            author: this.author,
            seq: ++this.seq,
            rev: stamp[0],
            baseRev: this.baseRev,
            command,
        };
        this.seen.add(this.author, message.seq);
        const effects: WorldEffect[] = [];
        const origins: Record<string, OriginClaim> = {};
        for (const [id, change] of netEntityChanges([command])) {
            this.noteOrigin(id, change.before, stamp);
            const origin = this.origins.get(id)!;
            if (origin.stamp === null || compareStamps(origin.stamp, stamp) < 0) {
                origins[id] = { state: origin.state, stamp: origin.stamp };
            }
            const actual = this.shownState(id, change.before);
            // Every command despawns by id before it places, except a place onto
            // an id that is already live (a remote write got there first): that
            // one leaves the world as it was, so put it right.
            if (change.before === null && actual !== null && !sameJson(actual, change.after)) {
                effects.push({ id, from: actual, to: change.after });
            }
            this.registers.set(id, { stamp, state: change.after });
            this.ownLatest.set(id, message);
        }
        if (Object.keys(origins).length > 0) message.origins = origins;
        return { message, effects };
    }

    /** An inbound edit (already through `parseCmdMessage`). */
    receive(message: CmdMessage): ReceiveOutcome {
        if (message.author === this.author) return { status: 'duplicate' };
        if (!this.seen.add(message.author, message.seq) && !message.resend) {
            return { status: 'duplicate' };
        }
        if (message.rev > this.clock + MAX_REV_JUMP) {
            return {
                status: 'rejected',
                reason: 'clock',
                detail: `rev ${message.rev} is ${message.rev - this.clock} ahead of this room`,
            };
        }
        this.clock = Math.max(this.clock, message.rev);
        const stamp: ClockStamp = [message.rev, message.author];
        const winners: Array<[string, { before: EntityState; after: EntityState }]> = [];
        const changes = netEntityChanges([message.command]);
        for (const [id, change] of changes) {
            const claim = message.origins?.[id];
            if (claim) this.noteOrigin(id, claim.state, claim.stamp);
            this.noteOrigin(id, change.before, stamp);
            if (compareStamps(stamp, this.registers.get(id)?.stamp ?? null) > 0)
                winners.push([id, change]);
        }

        const overCap = this.capViolation(winners);
        if (overCap) return { status: 'rejected', reason: 'over_cap', detail: overCap };

        const effects: WorldEffect[] = [];
        for (const [id, change] of winners) {
            const from = this.shownState(id, change.before);
            this.registers.set(id, { stamp, state: change.after });
            if (!sameJson(from, change.after)) effects.push({ id, from, to: change.after });
        }
        return { status: 'applied', effects, superseded: changes.size - winners.length };
    }

    /**
     * Host only: the write that takes a refused command back out for peers who
     * applied it (it restores what this host holds). Send it through `local`.
     */
    compensation(refused: CmdMessage): DocumentCommand | null {
        const out: DocumentCommand[] = [];
        for (const [id, change] of netEntityChanges([refused.command])) {
            const held = this.shownState(id, change.before);
            const shown = change.after;
            if (sameJson(held, shown)) continue;
            if (held === null) out.push({ type: 'remove', snapshot: shown! });
            else if (shown === null) out.push({ type: 'place', snapshot: held });
            else out.push({ type: 'move', from: shown, to: held });
        }
        if (out.length === 0) return null;
        return out.length === 1 ? out[0] : { type: 'batch', label: 'over cap', commands: out };
    }

    /**
     * Anti-entropy against a stored document: adopt every write it holds that
     * is newer than ours, and return our own writes it is missing (broadcast
     * them as they are: they carry `resend`). The document's commands may be
     * any log; its clock decides.
     */
    reconcile(doc: SharedDocumentState): { effects: WorldEffect[]; resend: CmdMessage[] } {
        const clock = doc.entityClock ?? {};
        this.clock = Math.max(this.clock, doc.rev ?? 0);
        const changes = netEntityChanges(doc.commands);
        const ids = new Set<string>([
            ...changes.keys(),
            ...Object.keys(clock),
            ...this.registers.keys(),
        ]);
        const effects: WorldEffect[] = [];
        const resend = new Set<CmdMessage>();

        for (const id of ids) {
            const docStamp = clock[id] ?? null;
            if (docStamp) this.clock = Math.max(this.clock, docStamp[0]);
            const change = changes.get(id);
            // The document's `before` is its writer's idea of the base state.
            if (change && !this.origins.has(id))
                this.origins.set(id, { state: change.before, stamp: null });
            const localStamp = this.registers.get(id)?.stamp ?? null;
            const cmp = compareStamps(docStamp, localStamp);

            if (cmp < 0) {
                if (localStamp && localStamp[1] === this.author) {
                    const own = this.ownLatest.get(id);
                    if (own && own.rev === localStamp[0]) resend.add(own);
                }
                continue;
            }
            // The same write on both sides: nothing to adopt (a differing view of
            // whether it is a change is a base-state disagreement, not an edit).
            if (cmp === 0 && docStamp !== null) continue;
            // A newer write in the document, or the same base: the document holds.
            const target = change ? change.after : this.origins.get(id)?.state;
            if (target === undefined) {
                if (cmp > 0) this.registers.set(id, { stamp: docStamp, state: undefined });
                continue;
            }
            const shown = this.shownState(id, change?.before ?? null);
            this.registers.set(id, { stamp: docStamp, state: target });
            if (!sameJson(shown, target)) effects.push({ id, from: shown, to: target });
        }
        // Marked, so a peer whose dedupe window gave up on the gap still takes them.
        return { effects, resend: [...resend].map((m) => ({ ...m, resend: true as const })) };
    }

    /**
     * The authored state of the world: entity id → snapshot, or null for an
     * entity removed from the base world. Entities back at their base state
     * are left out, so equal worlds compare equal however they got there.
     */
    materialize(): Map<string, EntityState> {
        const out = new Map<string, EntityState>();
        for (const [id, reg] of this.registers) {
            if (reg.state === undefined) continue;
            const origin = this.origins.get(id);
            if (origin && isUnchanged(reg.state, origin.state)) continue;
            out.set(id, reg.state);
        }
        return out;
    }

    /** What this replica holds for `id`: a snapshot, null (absent), or undefined (as generated / unknown). */
    stateOf(id: string): EntityState | undefined {
        return this.registers.get(id)?.state;
    }

    /** Snapshot hash of `materialize()`: equal hashes, equal worlds. */
    hash(): string {
        return entityStateHash(this.materialize());
    }

    /** The world as a compact command log: one place, move or remove per authored entity. */
    documentCommands(): DocumentCommand[] {
        const out: DocumentCommand[] = [];
        const states = this.materialize();
        for (const id of [...states.keys()].sort()) {
            const state = states.get(id) ?? null;
            const origin = this.origins.get(id)?.state ?? null;
            if (origin === null && state) out.push({ type: 'place', snapshot: state });
            else if (origin && state === null) out.push({ type: 'remove', snapshot: origin });
            else if (origin && state) out.push({ type: 'move', from: origin, to: state });
        }
        return out;
    }

    /** Per entity, the stamp of the write its state came from (`worlds.entity_clock`). */
    exportClock(): EntityClock {
        const out: EntityClock = {};
        for (const [id, reg] of this.registers)
            if (reg.stamp) out[id] = [reg.stamp[0], reg.stamp[1]];
        return out;
    }

    /**
     * Would this local edit take the world past a cap, as `receive` judges a
     * peer's? Build mode checks its own placements and moves; this is the
     * backstop (a redo, an undo, a world this replica holds fuller). Ask
     * before `local`; null means within the caps.
     */
    capRefusal(command: DocumentCommand): string | null {
        return this.capViolation([...netEntityChanges([command])]);
    }

    /** Authored entities, in total and in the fullest chunk a write would touch. */
    private capViolation(winners: ReadonlyArray<[string, { after: EntityState }]>): string | null {
        if (!this.caps || winners.length === 0) return null;
        const next = new Map<string, EntityState>();
        for (const [id, change] of winners) next.set(id, change.after);
        const before = this.countAuthored(null);
        const after = this.countAuthored(next);
        if (after.total > this.caps.total && after.total > before.total) {
            return `world would hold ${after.total} pieces (max ${this.caps.total})`;
        }
        for (const [key, count] of after.perChunk) {
            if (count > this.caps.perChunk && count > (before.perChunk.get(key) ?? 0)) {
                return `chunk ${key} would hold ${count} pieces (max ${this.caps.perChunk})`;
            }
        }
        return null;
    }

    private countAuthored(overrides: ReadonlyMap<string, EntityState> | null): {
        total: number;
        perChunk: Map<string, number>;
    } {
        const perChunk = new Map<string, number>();
        let total = 0;
        // Every present entity a write touched counts, as in build mode and
        // `countDocumentEntities` (a piece moved back is re-placed, so authored).
        const visit = (_id: string, state: EntityState | undefined): void => {
            if (!state) return;
            const [x, , z] = state.entity.position;
            const key = sharedChunkKey(x, z);
            perChunk.set(key, (perChunk.get(key) ?? 0) + 1);
            total++;
        };
        for (const [id, reg] of this.registers) {
            visit(id, overrides?.has(id) ? overrides.get(id) : reg.state);
        }
        if (overrides)
            for (const [id, state] of overrides) if (!this.registers.has(id)) visit(id, state);
        return { total, perChunk };
    }

    /**
     * What the world shows for `id` now. An entity no write has touched shows
     * its base state: the known origin, else `fallback` (a write's `before`).
     */
    private shownState(id: string, fallback: EntityState): EntityState {
        const state = this.registers.get(id)?.state;
        if (state !== undefined) return state;
        const origin = this.origins.get(id);
        return origin ? origin.state : fallback;
    }

    /** The earliest write's `before` is the entity's base state. */
    private noteOrigin(id: string, before: EntityState, stamp: ClockStamp | null): void {
        const known = this.origins.get(id);
        if (!known || (known.stamp !== null && compareStamps(stamp, known.stamp) < 0)) {
            this.origins.set(id, { state: before, stamp });
        }
    }

    private adoptBase(doc: SharedDocumentState): void {
        const clock = doc.entityClock ?? {};
        this.clock = Math.max(this.clock, doc.rev ?? 0);
        for (const [id, change] of netEntityChanges(doc.commands)) {
            this.noteOrigin(id, change.before, null);
            this.registers.set(id, { stamp: clock[id] ?? null, state: change.after });
        }
        for (const [id, stamp] of Object.entries(clock)) {
            this.clock = Math.max(this.clock, stamp[0]);
            if (!this.registers.has(id)) this.registers.set(id, { stamp, state: undefined });
        }
    }
}
