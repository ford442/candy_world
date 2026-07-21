// src/core/game-loop.ts
// Thin animate() coordinator — tick phases live in sibling game-loop-*.ts modules.
// Frame order is intentional; do not reorder phases without a gameplay audit.

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
} from './game-loop-core.ts';

import { updateAudioPhase } from './game-loop-audio.ts';
import { updateInteractionPhase, updateExploreCameraPhase } from './game-loop-input.ts';
import { updateVisualsPhase } from './game-loop-visuals.ts';
import { updateFoliagePhase } from './game-loop-foliage.ts';
import { updateParticlesPhase } from './game-loop-particles.ts';
import { updatePostFX, renderPostProcessing } from './game-loop-postfx.ts';
import { updateComputePhase } from './game-loop-compute.ts';
import { updatePhysicsPhase } from './game-loop-physics.ts';
import { updateGameplayPhase } from './game-loop-gameplay.ts';

import { profiler } from '../utils/profiler.ts';
import { isExploreActive } from './camera-modes.ts';
import { player } from '../systems/physics/index.ts';
import { updateDandelionSeeds } from '../foliage/dandelion-seeds.ts';
import { updateImpacts } from '../foliage/impacts.ts';

// Re-exports (public surface for main.ts / index.ts)
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

    updateInteractionPhase(delta);

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

    // 2b. Foliage materials + batcher LOD (after sky/fog uniforms settle)
    updateFoliagePhase(
        delta,
        audioState,
        visualsState.isNightNow,
        visualsState.weatherStateStr,
        visualsState.weatherIntensity,
        visualsState.dayNightBias,
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

    updateExploreCameraPhase(delta, exploreActive);

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
