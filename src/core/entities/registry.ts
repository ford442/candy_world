// src/core/entities/registry.ts
// The one record of which live world entities exist and which kinds each
// belongs to (#1973). An entity is a THREE.Object3D, identified by obj.uuid;
// it can belong to several kinds at once (a mushroom is also animated foliage
// and an obstacle). Per-kind lists are exposed only as read-only views that
// stay referentially stable, so modules may hold them from load time and
// per-frame loops never allocate.
//
// Not an ECS: no components, no systems. Kinds carry lifecycle hooks; the
// module that registers a kind owns its hooks. See docs/ARCHITECTURE.md
// ("Entity kinds").
import type * as THREE from 'three';

export interface EntityHooks<Ctx = unknown> {
    /** After the entity joins the kind (once per kind). */
    onSpawn?: (id: string, obj: THREE.Object3D) => void;
    /** After the entity leaves the kind (once per kind), with the despawn caller's context. */
    onDespawn?: (id: string, obj: THREE.Object3D, ctx: Ctx | undefined) => void;
    /** Entities of a pinned kind have no safe teardown: despawn refuses them. */
    pinned?: boolean;
}

/** Kinds an object belongs to by its own data, applied by `adopt`. */
export type EntityClassifier = (obj: THREE.Object3D) => string | null | undefined;

export interface EntityRegistryOptions {
    /**
     * Optional secondary key (e.g. a map entity id) captured when the entity
     * is first spawned; several entities may share one key. See `byKey`.
     */
    keyOf?: (obj: THREE.Object3D) => string | undefined;
}

interface EntityRecord {
    readonly obj: THREE.Object3D;
    readonly kinds: Set<string>;
    readonly key: string | undefined;
}

interface KindState<Ctx> {
    hooks: EntityHooks<Ctx> | null;
    /** View members, in spawn order. Usually the object itself; see spawn's `member`. */
    readonly members: unknown[];
    /** obj → member, so despawn removes the right view element. */
    readonly memberOf: Map<THREE.Object3D, unknown>;
}

const EMPTY: readonly never[] = Object.freeze([]);

/**
 * Order-preserving removal (some callers diff a view by length, e.g.
 * restoreEntityWith). Returns the list's new length.
 */
function removeItem(list: unknown[], item: unknown): number {
    const idx = list.indexOf(item);
    if (idx !== -1) list.splice(idx, 1);
    return list.length;
}

export class EntityRegistry<Ctx = unknown> {
    private readonly kinds = new Map<string, KindState<Ctx>>();
    private readonly records = new Map<string, EntityRecord>();
    private readonly keyed = new Map<string, THREE.Object3D[]>();
    private readonly classifiers: EntityClassifier[] = [];
    private readonly keyOf: ((obj: THREE.Object3D) => string | undefined) | undefined;

    constructor(options: EntityRegistryOptions = {}) {
        this.keyOf = options.keyOf;
    }

    private stateFor(kind: string): KindState<Ctx> {
        let state = this.kinds.get(kind);
        if (!state) {
            state = { hooks: null, members: [], memberOf: new Map() };
            this.kinds.set(kind, state);
        }
        return state;
    }

    /** Declare a kind and its hooks. A view taken before this keeps working. */
    registerKind(kind: string, hooks: EntityHooks<Ctx> = {}): void {
        const state = this.stateFor(kind);
        if (state.hooks) {
            console.warn(`[EntityRegistry] Kind ${kind} already registered`);
            return;
        }
        state.hooks = hooks;
    }

    /** Add a rule `adopt` uses to place an object in a kind by its own data. */
    registerClassifier(classifier: EntityClassifier): void {
        this.classifiers.push(classifier);
    }

    /**
     * Add `obj` to `kind`. `member` is what the kind's view holds for it
     * (default: `obj` itself); a kind whose view lists per-entity managers
     * (vine swings) passes the manager. Idempotent per (entity, kind).
     */
    spawn(kind: string, obj: THREE.Object3D, member: unknown = obj): string {
        const id = obj.uuid;
        let record = this.records.get(id);
        if (record) {
            if (record.obj !== obj) {
                throw new Error(`[EntityRegistry] id ${id} belongs to another object`);
            }
            if (record.kinds.has(kind)) return id;
            record.kinds.add(kind);
        } else {
            record = { obj, kinds: new Set([kind]), key: this.keyOf?.(obj) };
            this.records.set(id, record);
            if (record.key !== undefined) {
                let list = this.keyed.get(record.key);
                if (!list) this.keyed.set(record.key, (list = []));
                list.push(obj);
            }
        }

        const state = this.stateFor(kind);
        state.members.push(member);
        state.memberOf.set(obj, member);
        state.hooks?.onSpawn?.(id, obj);
        return id;
    }

    /**
     * Run every classifier on `obj` and join the kinds they name (registered
     * kinds only). For objects that reach teardown without having been
     * spawned under their batcher kind. Returns the entity id.
     */
    adopt(obj: THREE.Object3D): string {
        for (const classify of this.classifiers) {
            const kind = classify(obj);
            if (kind && this.kinds.get(kind)?.hooks) this.spawn(kind, obj);
        }
        return obj.uuid;
    }

    /** False when the entity, or what `adopt` would make it, is in a pinned kind. */
    canDespawn(obj: THREE.Object3D): boolean {
        const kinds = [
            ...(this.records.get(obj.uuid)?.kinds ?? []),
            ...this.classifiers.map((c) => c(obj)),
        ];
        return !kinds.some((kind) => kind && this.kinds.get(kind)?.hooks?.pinned);
    }

    /**
     * Remove the entity from one kind, or from every kind when `kind` is
     * omitted, firing each kind's onDespawn exactly once. False for an unknown
     * id or a kind the entity is not in.
     */
    despawn(id: string, kind?: string, ctx?: Ctx): boolean {
        const record = this.records.get(id);
        if (!record) return false;
        if (kind !== undefined) {
            if (!record.kinds.has(kind)) return false;
            this.leave(record, id, kind, ctx);
        } else {
            // Snapshot: a hook may not change which kinds remain to tear down.
            for (const k of [...record.kinds]) this.leave(record, id, k, ctx);
        }
        if (record.kinds.size === 0) this.forget(record, id);
        return true;
    }

    private leave(record: EntityRecord, id: string, kind: string, ctx: Ctx | undefined): void {
        record.kinds.delete(kind);
        const state = this.kinds.get(kind);
        if (!state) return;
        // spawn's default parameter means a member is never undefined.
        const member = state.memberOf.get(record.obj);
        if (member !== undefined) {
            state.memberOf.delete(record.obj);
            removeItem(state.members, member);
        }
        state.hooks?.onDespawn?.(id, record.obj, ctx);
    }

    private forget(record: EntityRecord, id: string): void {
        this.records.delete(id);
        const list = record.key === undefined ? undefined : this.keyed.get(record.key);
        if (list && removeItem(list, record.obj) === 0) this.keyed.delete(record.key!);
    }

    /**
     * The live, read-only list for `kind`. The same array for the registry's
     * lifetime: spawn/despawn update it in place, so hold it and read it every
     * frame without allocating. Only the registry mutates it.
     */
    view<T = THREE.Object3D>(kind: string): ReadonlyArray<T> {
        return this.stateFor(kind).members as T[];
    }

    /** `view(kind)` typed as the entity objects themselves. */
    query(kind: string): ReadonlyArray<THREE.Object3D> {
        return this.view<THREE.Object3D>(kind);
    }

    byId(id: string): THREE.Object3D | undefined {
        return this.records.get(id)?.obj;
    }

    has(id: string): boolean {
        return this.records.has(id);
    }

    /** The kinds the entity is in, in join order; empty for an unknown id. */
    kindsOf(id: string): ReadonlyArray<string> {
        const record = this.records.get(id);
        return record ? [...record.kinds] : EMPTY;
    }

    /** Live entities whose `keyOf` matched `key` when first spawned. */
    byKey(key: string): ReadonlyArray<THREE.Object3D> {
        return this.keyed.get(key) ?? EMPTY;
    }
}
