import * as THREE from 'three';
import { updateGroundDebug, isGroundDebugEnabled } from '../debug/tools-stub.ts';
import { updatePlacementDebug, isPlacementDebugEnabled } from '../debug/tools-stub.ts';
import {
    updatePhysicsSandbox,
    setPhysicsSandboxPlayer,
    ensurePhysicsSandbox,
    isPhysicsSandboxEnabled,
} from '../debug/tools-stub.ts';
import {
    ensureSoftBodyDemo,
    isSoftBodyDemoEnabled,
    setSoftBodyDemoPlayer,
    updateSoftBodyDemo,
} from '../debug/tools-stub.ts';
import { uPlayerPosition, uPlayerVelocity } from '../foliage/index.ts';
import { createShield } from '../foliage/shield.ts';
import { updateSparkleTrail } from '../foliage/sparkle-trail.ts';
import { updatePhysics, player, type AudioState } from '../systems/physics/index.ts';
import { PlayerInterpolator } from '../systems/physics/player-interpolation.ts';
import { setRigidBodyPlayerProxy, updateRigidBodies } from '../systems/physics/rigid-bodies.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { profiler } from '../utils/profiler.ts';
import { getSparkleTrail, getPlayerShieldMesh, setPlayerShieldMesh } from './deferred-init.ts';
import { cameraRef, controlsRef, sceneRef, rendererRef, gameTime } from './game-loop-core.ts';
import { keyStates } from './input/index.ts';
import type { AudioFrame } from './scheduler/index.ts';

const _scratchDir = new THREE.Vector3();
const _interp = new PlayerInterpolator();

/**
 * One fixed step of the character controller (`fixed` phase, #1973). Writes
 * `player` and the camera; `updatePlayerViewPhase` then blends the camera for
 * the render.
 */
export function stepPlayerPhysics(
    fixedDt: number,
    devOrbitActive: boolean,
    audioState: AudioFrame | null
): void {
    if (devOrbitActive || !cameraRef) return;
    const camera = cameraRef;
    profiler.measure('Physics', () => {
        _interp.beginStep(camera, player);
        // Null without an audio system, as before; the physics helpers check for it.
        updatePhysics(fixedDt, camera, controlsRef, keyStates, audioState as AudioState);
        _interp.endStep(camera, player);
    });
}

/**
 * Once per frame, after the fixed steps: the camera and every player-following
 * visual use the position blended between the last two fixed states.
 */
export function updatePlayerViewPhase(fixedAlpha: number, devOrbitActive: boolean): void {
    if (!cameraRef) return;
    const renderPos = _interp.present(cameraRef, player, fixedAlpha, !devOrbitActive);

    if (uPlayerPosition.value) {
        (uPlayerPosition.value as unknown as THREE.Vector3).copy(
            devOrbitActive ? cameraRef.position : renderPos
        );
        if (uPlayerVelocity.value) {
            (uPlayerVelocity.value as unknown as THREE.Vector3).copy(player.velocity);
        }
    }

    const sparkleTrail = getSparkleTrail();
    if (sparkleTrail) {
        updateSparkleTrail(sparkleTrail, renderPos, player.velocity, gameTime, rendererRef);
    }

    if (isGroundDebugEnabled()) {
        updateGroundDebug(player.position, cameraRef.position);
    }

    if (isPlacementDebugEnabled()) {
        cameraRef.getWorldDirection(_scratchDir);
        updatePlacementDebug(cameraRef.position, _scratchDir);
    }

    if (unlockSystem.isUnlocked('arpeggio_shield')) {
        let playerShieldMesh = getPlayerShieldMesh();
        if (!playerShieldMesh && sceneRef) {
            playerShieldMesh = createShield();
            sceneRef.add(playerShieldMesh);
            player.hasShield = true;
            setPlayerShieldMesh(playerShieldMesh);
            console.log('[Shield] Activated Arpeggio Shield');
        }
        if (playerShieldMesh) {
            playerShieldMesh.position.copy(renderPos);
            playerShieldMesh.position.y += 1.0;
        }
    }
}

/**
 * Dynamic props: rigid bodies, the ?debugPhysics=1 sandbox and the ?softBody=1
 * cloth. Variable-step for now — the solver syncs meshes inside its step, so
 * moving it to `fixed` needs per-body interpolation first.
 */
export function updateRigidBodyPhase(delta: number): void {
    profiler.measure('RigidBodies', () => {
        // After the character controller, so the bodies see the player's final
        // position. The proxy is one-way: the solver never writes back to
        // `player`, so jump/dash are untouched.
        setRigidBodyPlayerProxy(player.position, player.velocity);
        updateRigidBodies(delta);
        // Unconditional: the gizmos must still repaint on the frame the last
        // body falls asleep (awake count is already 0 by then). No-ops unless
        // ?debugPhysics=1 has loaded the sandbox module.
        updatePhysicsSandbox();

        if (isPhysicsSandboxEnabled()) {
            if (sceneRef) ensurePhysicsSandbox(sceneRef, player.position);
            setPhysicsSandboxPlayer(player.position);
        }

        // Experimental cloth prototype (?softBody=1). Steps after the character
        // controller for the same reason the rigid bodies do: it reads the
        // player's final position, and never writes back to it.
        if (isSoftBodyDemoEnabled()) {
            if (sceneRef) ensureSoftBodyDemo(sceneRef, player.position);
            setSoftBodyDemoPlayer(player.position);
            updateSoftBodyDemo(delta);
        }
    });
}
