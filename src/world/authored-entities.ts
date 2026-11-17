/**
 * @file src/world/authored-entities.ts
 * @brief Map entity ids that world commands own.
 *
 * Once a command has placed, removed, moved or repainted an entity, that id
 * belongs to the authoring layer: ChunkStreamer must not spawn the map copy of
 * it when its chunk streams in (the edit would be undone, or the entity
 * duplicated). A leaf module, so the streamer can check it without importing
 * the lazy authoring chunk.
 *
 * It also records which authored entities a `PlaceCommand` has placed and
 * not undone, keyed by entity id: the Melody `build` trigger counts these.
 * Replaying a command log (load, shared-world catch-up) places the same ids
 * again, so a replay cannot inflate the count.
 */

import { emitObjectiveCue } from '../systems/objective-signals.ts';

const _claimed = new Set<string>();

export function claimAuthoredEntity(id: string): void {
    if (id) _claimed.add(id);
}

export function isAuthoredEntity(id: string): boolean {
    return _claimed.has(id);
}

const _placed = new Map<string, string>();

/** A PlaceCommand made `id` (of entity `type`) live. Idempotent per id. */
export function markPlacedEntity(id: string, type: string): void {
    if (!id || _placed.get(id) === type) return;
    _placed.set(id, type);
    emitObjectiveCue({ kind: 'build' });
}

/** A PlaceCommand was undone. */
export function unmarkPlacedEntity(id: string): void {
    if (_placed.delete(id)) emitObjectiveCue({ kind: 'build' });
}

/** Authored entities placed and still live, of `type` when given. */
export function placedEntityCount(type?: string): number {
    if (!type) return _placed.size;
    let n = 0;
    for (const t of _placed.values()) if (t === type) n++;
    return n;
}

export function __resetAuthoredEntitiesForTests(): void {
    _claimed.clear();
    _placed.clear();
}
