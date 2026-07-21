/**
 * Lazy gameplay loader — keeps ability systems out of the initial `app` chunk.
 *
 * Modules load on first ability use, or via `preloadGameplay()` after `__sceneReady`.
 * Runtime behaviour is unchanged once loaded; until then updates/fire are no-ops.
 */
import type * as GameplayModule from './index.ts';

type GameplayAPI = typeof GameplayModule;

let _loadPromise: Promise<GameplayAPI> | null = null;
let _api: GameplayAPI | null = null;

export function isGameplayLoaded(): boolean {
    return _api !== null;
}

export function getGameplay(): GameplayAPI | null {
    return _api;
}

/** Start (or reuse) the dynamic import. Safe to call every frame / on keydown. */
export function ensureGameplay(): Promise<GameplayAPI> {
    if (_api) return Promise.resolve(_api);
    if (!_loadPromise) {
        _loadPromise = import('./index.ts').then((mod) => {
            _api = mod;
            return mod;
        });
    }
    return _loadPromise;
}

/** Prefetch after scene ready so first ability press is usually warm. */
export function preloadGameplay(): Promise<GameplayAPI> {
    return ensureGameplay();
}

/** HUD-safe cooldown; 0 until gameplay chunk is loaded. */
export function getJitterMineCooldown(): number {
    return _api?.jitterMineSystem.cooldownTimer ?? 0;
}
