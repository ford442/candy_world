/**
 * @file src/systems/net/shared-worlds-lazy.ts
 * @brief Shared-world entry points that stay in `app` (#1975). The rest
 * (supabase-js, the co-editing room, the Worlds panel) is the lazy `net`
 * chunk, loaded only for a `?world=` link, the Worlds panel, or a world that
 * has been published. Single-player boot never loads it.
 */

import type { WorldDocumentV1 } from '../../world/document/schema.ts';
import { readSharedWorldIdFromURL } from '../../world/world-seed.ts';

type SharedWorldsModule = typeof import('./shared-worlds.ts');

let _mod: SharedWorldsModule | null = null;
let _load: Promise<SharedWorldsModule> | null = null;

function load(): Promise<SharedWorldsModule> {
    if (!_load) {
        _load = import('./shared-worlds.ts').then((m) => {
            _mod = m;
            return m;
        });
        _load.catch(() => {
            _load = null;
        });
    }
    return _load;
}

/** True when the page was opened from a shared world link. */
export function isSharedWorldLink(): boolean {
    return readSharedWorldIdFromURL() !== null;
}

/** Open the linked shared world (after the base world for its seed has generated). */
export function openSharedWorldFromLink(onFallback: () => void): void {
    load()
        .then((m) => m.openSharedWorldFromLink(onFallback))
        .catch((err) => {
            console.warn('[SharedWorlds] Could not load shared worlds:', err);
            onFallback();
        });
}

/**
 * A published world was saved locally (`active.ts` fires the event; an event,
 * not an import, keeps the document chunk from depending on this one): push
 * it when the network allows.
 */
if (typeof window !== 'undefined') {
    window.addEventListener('candy:shared-document-saved', (e: Event) => {
        const doc = (e as CustomEvent<WorldDocumentV1>).detail;
        void load().then((m) => m.onSharedDocumentSaved(doc));
    });
}

/** Photo mode: "Set as world thumbnail", when an editable shared world is open. */
export function getSharedWorldThumbnailAction(): {
    label: string;
    run(image: Blob): Promise<string>;
} | null {
    return _mod?.thumbnailAction() ?? null;
}
