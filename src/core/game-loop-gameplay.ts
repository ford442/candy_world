import * as THREE from 'three';
import { profiler } from '../utils/profiler.ts';
import { safeSystemUpdate, safeUpdateBatcher, rendererRef, sceneRef, weatherSystemRef, cameraRef } from './game-loop-core.ts';
import { updateHUD, setLastStrikeState, getLastStrikeState } from './hud.ts';
import { player } from '../systems/physics/index.ts';
import { updateFallingBerries, collectFallingBerries } from '../foliage/berries.ts';
import { harmonyOrbSystem } from '../foliage/aurora.ts';
import { updateFallingClouds } from '../foliage/clouds.ts';
import { getGroundHeight } from '../systems/ground-system.ts';
import { CloudBatcher } from '../foliage/cloud-batcher.ts';
import { foliageClouds } from '../world/state.ts';
import { keyStates } from './input/index.ts';
import { getHarpoonLine } from './deferred-init.ts';
import { ensureGameplay, getGameplay, getJitterMineCooldown } from '../gameplay/lazy.ts';

export function updateGameplayPhase(delta: number, t: number, exploreActive: boolean, audioState: any) {
    const harpoonLine = getHarpoonLine();
    const gameplay = getGameplay();

    // Kick off (or reuse) dynamic import when the player presses an ability key
    // or after preloadGameplay() has started — never blocks the frame.
    if (!gameplay && (keyStates.action || keyStates.strike)) {
        void ensureGameplay();
    }

    profiler.measure('Gameplay', () => {
        if (exploreActive) {
            updateHUD({
                player: {
                    energy: player.energy,
                    maxEnergy: player.maxEnergy,
                    dashCooldown: (player as any).dashCooldown || 0,
                    isPhasing: (player as any).isPhasing || false,
                    phaseTimer: (player as any).phaseTimer || 0
                },
                audioState,
                delta,
                mineCooldown: getJitterMineCooldown()
            });
            return;
        }

        updateFallingBerries(delta, rendererRef);
        const berriesCollected = cameraRef ? collectFallingBerries(cameraRef.position, 1.5) : 0;

        if (harpoonLine && gameplay) {
            gameplay.updateHarpoonLine(harpoonLine, player.position, player.harpoon.anchor, player.harpoon.active);
        }
        if (berriesCollected > 0) {
            player.energy = Math.min(player.maxEnergy, player.energy + berriesCollected * 0.5);
        }
        player.energy = Math.max(0, player.energy - delta * 0.1);

        if (gameplay && sceneRef && weatherSystemRef) {
            gameplay.updateBlaster(delta, sceneRef, weatherSystemRef, t, rendererRef);
        }

        if (gameplay) {
            gameplay.jitterMineSystem.update(delta, player.position);
            if (keyStates.action) {
                gameplay.jitterMineSystem.spawnMine(player.position);
            }

            if (sceneRef) {
                gameplay.glitchGrenadeSystem.update(delta, sceneRef, rendererRef);
            }

            const isStrikePressed = keyStates.strike;
            const isStrikeTriggered = isStrikePressed && !getLastStrikeState();

            if (isStrikeTriggered) {
                gameplay.chordStrikeSystem.fire(player.position);
            }
            setLastStrikeState(isStrikePressed);

            if (sceneRef) {
                gameplay.chordStrikeSystem.update(delta, sceneRef, player);
            }
        } else {
            setLastStrikeState(keyStates.strike);
        }

        harmonyOrbSystem.update(delta, audioState, player.position);

        safeSystemUpdate(
            () => updateFallingClouds(delta, foliageClouds, getGroundHeight),
            'updateFallingClouds'
        );
        safeUpdateBatcher(CloudBatcher.getInstance(), delta, 'CloudBatcher');
        safeUpdateBatcher(CloudBatcher.getWalkableInstance(), delta, 'CloudBatcherWalkable');

        // Update HUD (cooldown reads 0 until gameplay chunk loads)
        updateHUD({
            player: {
                energy: player.energy,
                maxEnergy: player.maxEnergy,
                dashCooldown: (player as any).dashCooldown || 0,
                isPhasing: (player as any).isPhasing || false,
                phaseTimer: (player as any).phaseTimer || 0
            },
            audioState,
            delta,
            mineCooldown: getJitterMineCooldown()
        });
    });
}
