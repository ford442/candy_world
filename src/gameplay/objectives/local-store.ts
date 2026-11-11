/**
 * @file src/gameplay/objectives/local-store.ts
 * @brief A local mirror of Melody state, so what was announced is known the moment the chunk loads.
 *
 * The world document is the durable, shared home of `progress.melodies`, but in normal play it opens
 * after the player enters the world, well after this chunk has loaded. Without a local copy the
 * first `evaluate()` would see no saved state and announce every Melody as started (or completed)
 * again on every reload. Inventory, discoveries and awakened flora keep a `localStorage` mirror for
 * the same reason; the document unions on top of it (`unionMelodyProgress`).
 *
 * The storage is passed in so Node tests can use a fake. Storage that throws (private browsing,
 * quota) or holds garbage reads as empty and writes are dropped: Melodies still work, they just
 * lose the mirror.
 */

import {
    emptyMelodyProgress,
    unionMelodyProgress,
    type MelodyProgress,
} from '../../systems/melody-progress.ts';

export const MELODY_STORAGE_KEY = 'candy_world_melodies';

const VERSION = 1;

export function loadLocalMelodyProgress(
    storage: Pick<Storage, 'getItem'> | null | undefined
): MelodyProgress {
    try {
        const raw = storage?.getItem(MELODY_STORAGE_KEY);
        if (!raw) return emptyMelodyProgress();
        const data = JSON.parse(raw) as {
            version?: unknown;
            completed?: unknown;
            step?: unknown;
        } | null;
        if (!data || data.version !== VERSION) return emptyMelodyProgress();
        const completed = Array.isArray(data.completed)
            ? data.completed.filter((id): id is string => typeof id === 'string')
            : [];
        const step: Record<string, number> = {};
        if (data.step && typeof data.step === 'object' && !Array.isArray(data.step)) {
            for (const [id, n] of Object.entries(data.step)) {
                if (typeof n === 'number') step[id] = n;
            }
        }
        // The union sanitises: drops unsafe keys and non-finite or negative indexes.
        return unionMelodyProgress({ completed, step });
    } catch {
        return emptyMelodyProgress();
    }
}

export function saveLocalMelodyProgress(
    storage: Pick<Storage, 'setItem'> | null | undefined,
    progress: Readonly<MelodyProgress>
): void {
    try {
        storage?.setItem(
            MELODY_STORAGE_KEY,
            JSON.stringify({ version: VERSION, completed: progress.completed, step: progress.step })
        );
    } catch {
        /* Storage unavailable or full: the mirror is a convenience, not the record. */
    }
}
