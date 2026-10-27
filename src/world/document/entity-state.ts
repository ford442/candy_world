/**
 * @file src/world/document/entity-state.ts
 * @brief What a command log does to each entity, as data.
 *
 * Every command is a set of per-entity transitions `before → after` (a missing
 * side means "not in the world"): place is `∅ → s`, remove is `s → ∅`, move and
 * paint are `a → b`, batch is its children's transitions. Compaction, the
 * shared-world validator and the co-editing replica all reason in these terms.
 * Renderer-free and import-free at runtime (the edge function loads it).
 */

import type { EntitySnapshot } from '../../systems/entity-snapshot-types.ts';
import type { DocumentCommand } from './schema.ts';

export interface EntityTransition {
    id: string;
    before: EntitySnapshot | null;
    after: EntitySnapshot | null;
}

/** Append `cmd`'s transitions to `out`, in the order they take effect. */
export function transitionsOf(
    cmd: DocumentCommand,
    out: EntityTransition[] = []
): EntityTransition[] {
    switch (cmd.type) {
        case 'place':
            out.push({ id: cmd.snapshot.id, before: null, after: cmd.snapshot });
            break;
        case 'remove':
            out.push({ id: cmd.snapshot.id, before: cmd.snapshot, after: null });
            break;
        case 'move':
        case 'paint':
            out.push({ id: cmd.to.id, before: cmd.from, after: cmd.to });
            break;
        case 'batch':
            for (const child of cmd.commands) transitionsOf(child, out);
            break;
    }
    return out;
}

/** Per entity id: the state before its first transition and after its last. */
export interface NetEntityChange {
    before: EntitySnapshot | null;
    after: EntitySnapshot | null;
}

export function netEntityChanges(
    commands: readonly DocumentCommand[]
): Map<string, NetEntityChange> {
    const net = new Map<string, NetEntityChange>();
    const transitions: EntityTransition[] = [];
    for (const cmd of commands) transitionsOf(cmd, transitions);
    for (const t of transitions) {
        const entry = net.get(t.id);
        if (entry) entry.after = t.after;
        else net.set(t.id, { before: t.before, after: t.after });
    }
    return net;
}

/** The command that undoes `cmd` (what an undo step broadcasts). */
export function invertCommand(cmd: DocumentCommand): DocumentCommand {
    switch (cmd.type) {
        case 'place':
            return { type: 'remove', snapshot: cmd.snapshot };
        case 'remove':
            return { type: 'place', snapshot: cmd.snapshot };
        case 'move':
            return { type: 'move', from: cmd.to, to: cmd.from };
        case 'paint':
            return { type: 'paint', from: cmd.to, to: cmd.from };
        case 'batch': {
            const out: DocumentCommand = {
                type: 'batch',
                commands: cmd.commands.map(invertCommand).reverse(),
            };
            if (cmd.label) out.label = cmd.label;
            return out;
        }
    }
}

/** Order-insensitive deep equality for JSON values. */
export function sameJson(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        const bArr = b as unknown[];
        return a.length === bArr.length && a.every((v, i) => sameJson(v, bArr[i]));
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = Object.keys(ao).filter((k) => ao[k] !== undefined);
    const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
    return aKeys.length === bKeys.length && aKeys.every((k) => sameJson(ao[k], bo[k]));
}

/** JSON with object keys sorted and `undefined` members dropped: equal values, equal text. */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
        if (obj[key] === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
    }
    return `{${parts.join(',')}}`;
}

/** cyrb53: a fast 53-bit string hash, as 14 hex digits. Not cryptographic. */
export function hashString(text: string, seed = 0): string {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return n.toString(16).padStart(14, '0');
}

/**
 * Hash of an entity map (id → state, null = removed): the same entities in
 * the same states give the same hash, whatever order they were reached in.
 * Two replicas, or a document and the world it was replayed into, compare
 * with it ("snapshot hash equal").
 */
export function entityStateHash(states: ReadonlyMap<string, EntitySnapshot | null>): string {
    const ids = [...states.keys()].sort();
    const parts: string[] = [];
    for (const id of ids)
        parts.push(`${JSON.stringify(id)}:${canonicalJson(states.get(id) ?? null)}`);
    return hashString(parts.join('\n'));
}

/** An entity's state: its snapshot, or null when it is not in the world. */
export type EntityState = EntitySnapshot | null;

/** True when `state` is just the base world's own version (`origin`): nothing authored. */
export function isUnchanged(state: EntityState, origin: EntityState): boolean {
    return state === null ? origin === null : origin !== null && sameJson(state, origin);
}

/**
 * The authored states a command log leaves (removed ids map to null),
 * leaving out entities it changed and changed back.
 */
export function authoredEntityStates(
    commands: readonly DocumentCommand[]
): Map<string, EntityState> {
    const out = new Map<string, EntityState>();
    for (const [id, change] of netEntityChanges(commands)) {
        if (!isUnchanged(change.after, change.before)) out.set(id, change.after);
    }
    return out;
}

/** `entityStateHash` of a command log's authored states. */
export function documentStateHash(commands: readonly DocumentCommand[]): string {
    return entityStateHash(authoredEntityStates(commands));
}
