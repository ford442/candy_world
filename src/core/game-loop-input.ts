// src/core/game-loop-input.ts
// Tick phase: interaction queries + explore-camera handoff.
// Ability triggers (jitter mine / chord strike) stay in gameplay to preserve frame order.

import { isExploreActive, getExploreCamera, updateExploreCamera } from './camera-modes.ts';
import { keyStates } from './input/index.ts';
import {
    cameraRef,
    interactionSystemRef,
    _interactionLists,
} from './game-loop-core.ts';
import { animatedFoliage, foliageMushrooms, foliageClouds } from '../world/state.ts';
import { profiler } from '../utils/profiler.ts';

/** Interaction raycasts / hover — early in the frame, before visuals. */
export function updateInteractionPhase(delta: number): void {
    profiler.measure('Interaction', () => {
        if (interactionSystemRef && cameraRef) {
            _interactionLists[0] = animatedFoliage || [];
            _interactionLists[1] = foliageMushrooms || [];
            _interactionLists[2] = foliageClouds || [];
            interactionSystemRef.update(delta, cameraRef.position, _interactionLists as any);
        }
    });
}

/**
 * Explore-camera mode: advance orbit/hybrid camera and optional WASD pan on hybrid targets.
 * Called after PostFX (same slot as the former inline block in animate()).
 */
export function updateExploreCameraPhase(delta: number, exploreActive: boolean = isExploreActive()): void {
    updateExploreCamera(delta);

    if (exploreActive && getExploreCamera()?.isHybrid()) {
        let forward = 0;
        let strafe = 0;
        if (keyStates.forward) forward += 1;
        if (keyStates.backward) forward -= 1;
        if (keyStates.left) strafe -= 1;
        if (keyStates.right) strafe += 1;
        getExploreCamera()?.panTargetXZ(forward, strafe, delta);
    }
}
