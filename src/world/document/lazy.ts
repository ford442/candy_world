/**
 * @file src/world/document/lazy.ts
 * @brief Boot hook for the active WorldDocument. Stays in `app`; the document
 * code (and valibot) load in the `save-ui` chunk after the world is up.
 */

import { getUrlFlag } from '../../core/config/url-flags.ts';
import { isAutomation } from '../../core/platform/run-mode.ts';
import {
    isSharedWorldLink,
    openSharedWorldFromLink,
} from '../../systems/net/shared-worlds-lazy.ts';

let _worldEntered = false;

/**
 * True once the player has entered the world (Enter on the start screen). The
 * world before that is a preview that Enter regenerates, so nothing may be
 * authored into it.
 */
export function isWorldEntered(): boolean {
    return _worldEntered;
}

/**
 * Open the player's world (replay their edits, merge progress) once the base
 * world has generated. Automated runs (smoke tests, visual regression) start
 * from the generated world unless they pass `?authoring=1`; build mode and the
 * save menu still open a document on demand.
 */
export function loadWorldDocumentAfterWorldLoad(): void {
    _worldEntered = true;
    // A `?world=` link (#1975) opens that shared world instead; if it can't
    // be opened, the player's own world for the seed opens as usual.
    if (isSharedWorldLink()) {
        openSharedWorldFromLink(openOwnWorld);
        return;
    }
    if (isAutomation() && getUrlFlag('authoring') !== '1') return;
    openOwnWorld();
}

function openOwnWorld(): void {
    void import('./active.ts')
        .then((m) => m.onWorldGenerated())
        .catch((err) => console.warn('[WorldDocument] Could not open the saved world:', err));
}
