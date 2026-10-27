/**
 * @file src/world/document/compaction.ts
 * @brief Fold a run of authored commands into the fewest commands with the same result.
 *
 * Every command is a set of per-entity transitions `before → after` (a missing
 * side means "not in the world"): place is `∅ → s`, remove is `s → ∅`, move and
 * paint are `a → b`, batch is its children's transitions. Folding keeps, per
 * entity id, the state before its first transition and after its last, then
 * emits one command per entity whose state changed:
 *
 *   ∅ → s : place(s)      s → ∅ : remove(s)      a → b : move(a, b)
 *
 * Replaying the compacted list on the base world gives the same entities as
 * replaying the original (tests/world-document-replay.test.ts).
 */

import type { EntitySnapshot } from '../../systems/entity-snapshot-core.ts';
import type { DocumentCommand } from './schema.ts';

interface Transition {
    id: string;
    before: EntitySnapshot | null;
    after: EntitySnapshot | null;
}

function transitionsOf(cmd: DocumentCommand, out: Transition[]): void {
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
}

/** Order-insensitive deep equality for JSON values. */
function sameJson(a: unknown, b: unknown): boolean {
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

export function compactCommands(commands: readonly DocumentCommand[]): DocumentCommand[] {
    const net = new Map<string, { before: EntitySnapshot | null; after: EntitySnapshot | null }>();
    const transitions: Transition[] = [];
    for (const cmd of commands) transitionsOf(cmd, transitions);
    for (const t of transitions) {
        const entry = net.get(t.id);
        if (entry) entry.after = t.after;
        else net.set(t.id, { before: t.before, after: t.after });
    }

    const out: DocumentCommand[] = [];
    for (const { before, after } of net.values()) {
        if (!before && after) out.push({ type: 'place', snapshot: after });
        else if (before && !after) out.push({ type: 'remove', snapshot: before });
        else if (before && after && !sameJson(before, after)) {
            out.push({ type: 'move', from: before, to: after });
        }
    }
    return out;
}

/** Commands beyond this many in the history-free prefix trigger a fold. */
export const COMPACTION_THRESHOLD = 64;

/**
 * Compact the part of the log no undo step can reach: everything but the last
 * `undoableTail` commands, which must stay one-for-one with the undo stack.
 */
export function compactLog(
    commands: readonly DocumentCommand[],
    undoableTail: number,
    threshold = COMPACTION_THRESHOLD
): DocumentCommand[] {
    const tail = Math.max(0, Math.min(undoableTail, commands.length));
    const prefixLength = commands.length - tail;
    if (prefixLength < threshold) return commands.slice();
    return [...compactCommands(commands.slice(0, prefixLength)), ...commands.slice(prefixLength)];
}
