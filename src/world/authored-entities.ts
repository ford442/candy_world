/**
 * @file src/world/authored-entities.ts
 * @brief Map entity ids that world commands own.
 *
 * Once a command has placed, removed, moved or repainted an entity, that id
 * belongs to the authoring layer: ChunkStreamer must not spawn the map copy of
 * it when its chunk streams in (the edit would be undone, or the entity
 * duplicated). A leaf module, so the streamer can check it without importing
 * the lazy authoring chunk.
 */

const _claimed = new Set<string>();

export function claimAuthoredEntity(id: string): void {
    if (id) _claimed.add(id);
}

export function isAuthoredEntity(id: string): boolean {
    return _claimed.has(id);
}

export function __resetAuthoredEntitiesForTests(): void {
    _claimed.clear();
}
