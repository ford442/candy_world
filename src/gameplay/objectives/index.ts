/**
 * @file src/gameplay/objectives/index.ts
 * @brief Entry of the lazy `objectives` chunk: load the Melody files, build the objective system,
 * wire it to the player's progress (#2028 slice B).
 *
 * Loaded by `objectives-lazy.ts` after `__sceneReady`. Importing this module starts the layer.
 *
 * Everything that can move a step funnels into one cheap `evaluate()`: a harvest, a first-time
 * discovery or awakening, and a document being applied. Evaluating is idempotent, so a cue that
 * fires twice, or one that arrives before the state it reports, costs nothing.
 */

import { announceQuest } from '../../ui/announcer.ts';
import { awakenedPersistence } from '../../systems/awakened-persistence-api.ts';
import { discoverySystem } from '../../systems/discovery-optimized.ts';
import { registerMelodyStore } from '../../systems/melody-progress.ts';
import { onProgress } from '../../systems/progress-events.ts';
import { unlockSystem } from '../../systems/unlocks.ts';
import { loadLocalMelodyProgress, saveLocalMelodyProgress } from './local-store.ts';
import {
    createObjectiveSystem,
    type MelodyEvent,
    type ObjectiveSnapshot,
    type ObjectiveSystem,
} from './objective-system.ts';
import { parseMelodyFiles } from './schema.ts';

// Every `assets/melodies/*.json` is a Melody: adding one needs no code change here. Keys are
// paths; the file name is what an error should name.
const FILES = import.meta.glob('../../../assets/melodies/*.json', {
    eager: true,
    import: 'default',
}) as Record<string, unknown>;

function melodyFiles(): Record<string, unknown> {
    const byName: Record<string, unknown> = {};
    for (const path of Object.keys(FILES))
        byName[path.slice(path.lastIndexOf('/') + 1)] = FILES[path];
    return byName;
}

/** What the player has right now, read fresh on every evaluate. */
const snapshot: ObjectiveSnapshot = {
    itemCount: (id) => unlockSystem.getItemCount(id),
    isDiscovered: (id) => discoverySystem.isDiscovered(id),
    awakenedCount: (type) => {
        // 0 until the awakened store's own chunk has loaded, so the count can only rise.
        if (!type) return awakenedPersistence.count();
        let n = 0;
        for (const record of awakenedPersistence.serialize()) if (record.type === type) n++;
        return n;
    },
};

/** Quest announcements: "Quest started: …", "Quest updated: …", "Quest completed: …". */
function announce(event: MelodyEvent, title: string, detail?: string): void {
    if (event === 'step') announceQuest('updated', detail ? `${title}. Next: ${detail}` : title);
    else announceQuest(event, title);
}

function localStorageOrNull(): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null; // access itself can throw (blocked site data)
    }
}

function startObjectives(): ObjectiveSystem {
    const storage = localStorageOrNull();
    const system = createObjectiveSystem({
        melodies: parseMelodyFiles(melodyFiles()),
        snapshot,
        announce,
        // What this browser already announced; the document unions on top of it when it opens.
        initial: loadLocalMelodyProgress(storage),
    });
    system.onChange(() => saveLocalMelodyProgress(storage, system.getProgress()));

    // From here the document layer reads and merges through this system. Anything a document
    // applied before this chunk loaded is handed over now, silently.
    registerMelodyStore({ read: system.getProgress, apply: system.apply });

    unlockSystem.onHarvest(() => system.evaluate());
    onProgress(() => system.evaluate());
    // Saved awakened flora only count once the store's chunk has loaded. `merge([])` resolves
    // when it has, without touching anything, so this is "evaluate once it is ready".
    void awakenedPersistence.merge([]).then(() => system.evaluate());

    system.evaluate();
    return system;
}

export const objectiveSystem: ObjectiveSystem = startObjectives();
