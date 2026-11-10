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
import { discoverySystem } from '../../systems/discovery-optimized.ts';
import { applyMelodyProgress, readMelodyProgress } from '../../systems/melody-progress.ts';
import { unlockSystem } from '../../systems/unlocks.ts';
import { isSugarCavesUnlocked, unlockSugarCaves } from '../part-ii-unlock.ts';
import { normalizeAwakened, splitStamps } from './legacy-records.ts';
import type { DocumentProgress } from './schema.ts';

// Pure, so shared-world sync can merge progress without the live systems.
export { unionProgress } from './progress-union.ts';

export function readLiveProgress(now = Date.now()): DocumentProgress {
    const { discoveries, stamps } = splitStamps(discoverySystem.getDiscoveredIds());
    return {
        discoveries,
        unlocks: unlockSystem.getUnlockedIds(),
        inventory: unlockSystem.getInventory(),
        awakened: normalizeAwakened(awakenedPersistence.serialize(), now),
        stamps,
        partII: { sugarCavesUnlocked: isSugarCavesUnlocked() },
        // The lazy objectives chunk owns this state once it has loaded; before that the leaf
        // holds whatever a document applied, so a capture never drops saved chains.
        melodies: readMelodyProgress(),
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
    // Last, so the inventory, discoveries and awakened flora merged above are in place when the
    // objective system re-evaluates. Applying is silent: nothing here is announced as a quest.
    applyMelodyProgress(progress.melodies);
}
