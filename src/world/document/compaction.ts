/**
 * @file src/world/document/compaction.ts
 * @brief Fold a run of authored commands into the fewest commands with the same result.
 *
 * Every command is a set of per-entity transitions `before → after` (a missing
 * side means "not in the world"): place is `∅ → s`, remove is `s → ∅`, move and
 * paint are `a → b`, batch is its children's transitions (`entity-state.ts`).
 * Folding keeps, per entity id, the state before its first transition and
 * after its last, then emits one command per entity whose state changed:
 *
 *   ∅ → s : place(s)      s → ∅ : remove(s)      a → b : move(a, b)
 *
 * Replaying the compacted list on the base world gives the same entities as
 * replaying the original (tests/world-document-replay.test.ts).
 */

import { netEntityChanges, sameJson } from './entity-state.ts';
import type { DocumentCommand } from './schema.ts';

export function compactCommands(commands: readonly DocumentCommand[]): DocumentCommand[] {
    const out: DocumentCommand[] = [];
    for (const { before, after } of netEntityChanges(commands).values()) {
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
