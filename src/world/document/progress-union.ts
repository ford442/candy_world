/**
 * @file src/world/document/progress-union.ts
 * @brief Union of two progress records: progress only grows.
 *
 * Renderer- and system-free, so the document session and shared-world sync
 * (`shared-sync.ts`) can both merge progress.
 */

import type { DocumentProgress } from './schema.ts';

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
