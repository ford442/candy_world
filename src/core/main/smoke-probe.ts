/**
 * `window.__smokeProbe()`: a read-only snapshot of the state the remote smoke
 * (`tests/smoke-remote.mjs`) checks its core flows against: player position,
 * day/night, build mode, whether the world has been entered. Nothing here
 * changes game state; flows are driven through real input events.
 */
import { isBuildModeActive } from '../../systems/build-mode-state.ts';
import { player } from '../../systems/physics/physics-types.ts';
import { isWorldEntered } from '../../world/document/lazy.ts';
import { getIsNight } from '../hud.ts';

export interface SmokeProbe {
    player: [number, number, number];
    isNight: boolean;
    buildMode: boolean;
    worldEntered: boolean;
    pointerLocked: boolean;
}

export function installSmokeProbe(): void {
    (window as unknown as { __smokeProbe?: () => SmokeProbe }).__smokeProbe = () => ({
        player: [player.position.x, player.position.y, player.position.z],
        isNight: getIsNight(),
        buildMode: isBuildModeActive(),
        worldEntered: isWorldEntered(),
        pointerLocked: document.pointerLockElement !== null,
    });
}
