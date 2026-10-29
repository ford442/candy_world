/**
 * @file src/systems/build-mode-lazy.ts
 * @brief Build mode entry point. Stays in `app`; the editor itself is the lazy
 * `authoring` chunk (`systems/authoring/build-mode.ts`), loaded on first use.
 * Its flags live in `build-mode-state.ts`.
 */

import type * as THREE from 'three';
import { showToast } from '../utils/toast.ts';
import { isWorldEntered } from '../world/document/lazy.ts';
import { getBuildModeLock, isBuildModeActive } from './build-mode-state.ts';

let _load: Promise<typeof import('./authoring/build-mode.ts')> | null = null;

export function toggleBuildMode(scene: THREE.Scene): void {
    if (!isWorldEntered()) {
        // The start-screen preview is regenerated on Enter: edits there would vanish.
        showToast('Enter the world to start building', '🏗️', 2500);
        return;
    }
    const lock = getBuildModeLock();
    if (lock && !isBuildModeActive()) {
        showToast(lock, '🔒', 3500);
        return;
    }
    if (!_load) {
        _load = import('./authoring/build-mode.ts');
        _load.catch(() => {
            _load = null;
        });
    }
    _load
        .then((m) => m.toggleBuildMode(scene))
        .catch((err) => console.warn('[BuildMode] Could not load build mode:', err));
}
