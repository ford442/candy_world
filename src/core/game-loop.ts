// src/core/game-loop.ts
// Main animation loop and game state management

import * as THREE from 'three';

import {
    initGameLoopDependencies,
    getGameTime,
    setGameTime,
    getAudioState,
    getBeatFlashIntensity,
    sceneRef,
    cameraRef,
    rendererRef,
    postProcessingRef,
    _loggedWebGPULimits,
    setLoggedWebGPULimits,
    WebGPURendererWithDeviceLimits,
    timeOffsetRef,
    firefliesRef,
    beatFlashIntensity, setBeatFlashIntensity,
    cameraZoomPulse, setCameraZoomPulse,
    cameraShake, setCameraShakeCore,
    lastBeatPhase, setLastBeatPhase,
    baseFOV,
    _interactionLists,
    interactionSystemRef
} from './game-loop-core.ts';

import { updateAudioPhase } from './game-loop-audio.ts';
import { updateVisualsPhase } from './game-loop-visuals.ts';
import { updateParticlesPhase } from './game-loop-particles.ts';
import { updatePostFX, renderPostProcessing } from './game-loop-postfx.ts';
import { updateComputePhase } from './game-loop-compute.ts';
import { updatePhysicsPhase } from './game-loop-physics.ts';
import { updateGameplayPhase } from './game-loop-gameplay.ts';

import { profiler } from '../utils/profiler.ts';
import { isExploreActive, getExploreCamera, updateExploreCamera } from './camera-modes.ts';
import { keyStates } from './input/index.ts';
import { player } from '../systems/physics/index.ts';
import { updateDandelionSeeds } from '../foliage/dandelion-seeds.ts';
import { updateImpacts } from '../foliage/impacts.ts';
import { animatedFoliage, foliageMushrooms, foliageClouds } from '../world/state.ts';

// Re-exports
export { initGameLoopDependencies, getGameTime, getAudioState, getBeatFlashIntensity };
export { addCameraShake } from './camera-shake.ts';

// --- Animation Loop State ---
const clock = new THREE.Clock();

export function animate() {
    if (!sceneRef || !cameraRef || !rendererRef || !postProcessingRef) return;

    profiler.startFrame();

    if (!_loggedWebGPULimits) {
        const limits = (rendererRef as WebGPURendererWithDeviceLimits).backend?.device?.limits;
        if (limits) {
            console.log(
                `[WebGPU] Buffer limits: maxUniformBufferBindingSize=${limits.maxUniformBufferBindingSize}, maxStorageBufferBindingSize=${limits.maxStorageBufferBindingSize}, maxBufferSize=${limits.maxBufferSize}`
            );
            setLoggedWebGPULimits(true);
        }
    }

    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);

    // 1. Audio and Beat phase
    const audioState = updateAudioPhase(rawDelta);

    const currentBPM = audioState?.bpm || 120;
    const timeFactor = 120 / Math.max(10, currentBPM);
    let gt = getGameTime() + delta * timeFactor;
    setGameTime(gt);

    const currentBeatPhase = audioState?.beatPhase || 0;
    if (currentBeatPhase < lastBeatPhase && lastBeatPhase > 0.8) {
        const kickTrigger = audioState?.kickTrigger || 0;
        if (kickTrigger > 0.3) {
            setBeatFlashIntensity(0.5 + kickTrigger * 0.5);
            setCameraZoomPulse(2 + kickTrigger * 3);
        }
    }
    setLastBeatPhase(currentBeatPhase);

    let bfi = beatFlashIntensity;
    if (bfi > 0) {
        bfi *= 0.9;
        if (bfi < 0.01) bfi = 0;
        setBeatFlashIntensity(bfi);
    }

    let czp = cameraZoomPulse;
    if (czp > 0) {
        cameraRef.fov = baseFOV - czp;
        cameraRef.updateProjectionMatrix();
        czp *= 0.85;
        if (czp < 0.1) {
            czp = 0;
            cameraRef.fov = baseFOV;
            cameraRef.updateProjectionMatrix();
        }
        setCameraZoomPulse(czp);
    }

    let cs = cameraShake;
    if (cs > 0) {
        cs *= 0.9;
        if (cs < 0.001) cs = 0;
        setCameraShakeCore(cs);
    }

    profiler.measure('Interaction', () => {
        if (interactionSystemRef) {
            _interactionLists[0] = animatedFoliage || [];
            _interactionLists[1] = foliageMushrooms || [];
            _interactionLists[2] = foliageClouds || [];
            interactionSystemRef.update(delta, cameraRef!.position, _interactionLists as any);
        }
    });

    const exploreActive = isExploreActive();

    // 2. Visuals phase (Weather, Lighting, Shadows, Day/Night, Sky, TSL Uniforms)
    const visualsState = updateVisualsPhase(
        delta,
        gt + timeOffsetRef.value,
        gt,
        audioState,
        getBeatFlashIntensity(),
        exploreActive,
        player.position
    );

    // 3. Particles and Music Reactivity phase
    updateParticlesPhase(
        delta,
        gt + timeOffsetRef.value,
        audioState,
        visualsState.isNightNow,
        visualsState.cyclePos >= (0.2 + 0.3 + 0.1 + 0.1) // deep night start approx, exact logic is in config
    );

    // 4. PostFX and Camera phase
    profiler.measure('PostFX', () => {
        updatePostFX(delta);
    });

    updateExploreCamera(delta);

    // Update Explore Camera Mode
    if (exploreActive && getExploreCamera()?.isHybrid()) {
        let forward = 0;
        let strafe = 0;
        if (keyStates.forward) forward += 1;
        if (keyStates.backward) forward -= 1;
        if (keyStates.left) strafe -= 1;
        if (keyStates.right) strafe += 1;
        getExploreCamera()?.panTargetXZ(forward, strafe, delta);
    }

    if (firefliesRef) {
        firefliesRef.visible = visualsState.cyclePos >= (0.2 + 0.3 + 0.1 + 0.1);
    }

    // 5. Compute passes
    updateComputePhase();

    updateImpacts(rendererRef, gt + timeOffsetRef.value);
    updateDandelionSeeds(rendererRef);

    // 6. Physics Phase
    const devOrbitActive = exploreActive;
    updatePhysicsPhase(delta, devOrbitActive, audioState);

    // 7. Gameplay Phase
    updateGameplayPhase(delta, gt + timeOffsetRef.value, exploreActive, audioState);

    // 8. Render
    renderPostProcessing();

    profiler.endFrame();
}
