/**
 * @file src/world/document/progress-bridge.ts
 * @brief Read player progress out of the live systems, and merge a document's back in.
 *
 * Progress only grows: merging a document is a union (item counts keep the
 * larger value), so loading a world can never take a discovery away. During
 * the `legacyRead` release the live systems still persist to their own keys
 * too, so a rollback keeps everything.
 */

import { awakenedPersistence } from '../../systems/awakened-persistence-api.ts';
import { discoverySystem } from '../../systems/discovery.ts';
import { unlockSystem } from '../../systems/unlocks.ts';
import { isSugarCavesUnlocked, unlockSugarCaves } from '../part-ii-unlock.ts';
import { normalizeAwakened, splitStamps } from './legacy-records.ts';
import type { DocumentProgress } from './schema.ts';

export function readLiveProgress(now = Date.now()): DocumentProgress {
    const { discoveries, stamps } = splitStamps(discoverySystem.getDiscoveredIds());
    return {
        discoveries,
        unlocks: unlockSystem.getUnlockedIds(),
        inventory: unlockSystem.getInventory(),
        awakened: normalizeAwakened(awakenedPersistence.serialize(), now),
        stamps,
        partII: { sugarCavesUnlocked: isSugarCavesUnlocked() },
    };
}

/**
 * Union a document's progress into the live systems. Resolves once the
 * awakened store (a lazy chunk) has taken its share.
 */
export async function mergeLiveProgress(progress: DocumentProgress): Promise<void> {
    discoverySystem.restore(progress.discoveries);
    discoverySystem.restore(progress.stamps);
    unlockSystem.restore(progress.unlocks, progress.inventory);
    if (progress.partII.sugarCavesUnlocked && !isSugarCavesUnlocked()) unlockSugarCaves();
    await awakenedPersistence.merge(
        progress.awakened.map((a) => ({
            persistentId: a.persistentId,
            entityId: String(a.persistentId),
            type: a.type,
            biome: a.biome,
            awakenedAt: a.awakenedAt,
            lastNoteColor: a.lastNoteColor,
            emissiveScale: a.emissiveScale,
        }))
    );
}

/** Union two progress records (used when a loaded document meets live progress). */
export function unionProgress(a: DocumentProgress, b: DocumentProgress): DocumentProgress {
    const inventory = { ...a.inventory };
    for (const key in b.inventory) inventory[key] = Math.max(inventory[key] ?? 0, b.inventory[key]);
    const awakened = new Map(a.awakened.map((r) => [r.persistentId, r]));
    for (const r of b.awakened) {
        const existing = awakened.get(r.persistentId);
        if (!existing || r.awakenedAt < existing.awakenedAt) awakened.set(r.persistentId, r);
    }
    return {
        discoveries: [...new Set([...a.discoveries, ...b.discoveries])],
        unlocks: [...new Set([...a.unlocks, ...b.unlocks])],
        inventory,
        awakened: [...awakened.values()],
        stamps: [...new Set([...a.stamps, ...b.stamps])],
        partII: { sugarCavesUnlocked: a.partII.sugarCavesUnlocked || b.partII.sugarCavesUnlocked },
    };
}
