import * as THREE from 'three';
import { profiler } from '../utils/profiler.ts';
import { cameraRef, controlsRef, sceneRef, rendererRef, gameTime } from './game-loop-core.ts';
import { updatePhysics, player } from '../systems/physics/index.ts';
import { keyStates } from './input/index.ts';
import { updateSparkleTrail } from '../foliage/sparkle-trail.ts';
import { updateGroundDebug, isGroundDebugEnabled } from '../debug/ground-debug.ts';
import { createShield } from '../foliage/shield.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { getSparkleTrail, getPlayerShieldMesh, setPlayerShieldMesh } from './deferred-init.ts';
import { uPlayerPosition, uPlayerVelocity } from '../foliage/index.ts';

export function updatePhysicsPhase(delta: number, devOrbitActive: boolean, audioState: any) {
    const sparkleTrail = getSparkleTrail();
    let playerShieldMesh = getPlayerShieldMesh();

    profiler.measure('Physics', () => {
        if (!devOrbitActive) {
            updatePhysics(delta, cameraRef!, controlsRef, keyStates, audioState);
        }

        if (player.position && uPlayerPosition.value) {
            (uPlayerPosition.value as any).copy(devOrbitActive && cameraRef ? cameraRef.position : player.position);
            if (uPlayerVelocity.value && player.velocity) {
                (uPlayerVelocity.value as any).copy(player.velocity);
            }
        }

        if (sparkleTrail && player.position && player.velocity) {
            updateSparkleTrail(sparkleTrail, player.position, player.velocity, gameTime, rendererRef);
        }

        if (isGroundDebugEnabled() && player.position && cameraRef) {
            updateGroundDebug(player.position, cameraRef.position);
        }

        if (unlockSystem.isUnlocked('arpeggio_shield')) {
            if (!playerShieldMesh && sceneRef) {
                playerShieldMesh = createShield();
                sceneRef.add(playerShieldMesh);
                (player as any).hasShield = true;
                setPlayerShieldMesh(playerShieldMesh);
                console.log('[Shield] Activated Arpeggio Shield');
            }
            if (playerShieldMesh) {
                playerShieldMesh.position.copy(player.position);
                playerShieldMesh.position.y += 1.0;
            }
        }
    });
}
