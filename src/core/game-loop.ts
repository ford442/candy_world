// src/core/game-loop.ts
// Thin animate() coordinator — tick phases live in sibling game-loop-*.ts modules.
// Frame order is intentional; do not reorder phases without a gameplay audit.

import * as THREE from 'three';
import { tickComputeOrchestrator } from '../compute/compute-orchestrator.ts';
import { ensureHeroAnimationDemo, isHeroAnimationDemoEnabled } from '../debug/tools-stub.ts';
import { updateDandelionSeeds } from '../foliage/dandelion-seeds.ts';
import { updateImpacts } from '../foliage/impacts.ts';
import { updateHeroAnimations } from '../systems/animation/clip-player.ts';
import { updateBehaviorSystem } from '../systems/ecs/behaviors/index.ts';
import { updateFaunaSystem } from '../systems/fauna/index.ts';
import { updatePresenceSystem } from '../systems/net/lazy.ts';
import { getPhotoMode } from '../systems/photo-mode/lazy.ts';
import { player } from '../systems/physics/index.ts';
import { profiler } from '../utils/profiler.ts';
import { updateSugarCavesTraversal } from '../world/sugar-caves-traversal.ts';
import { isExploreActive } from './camera-modes.ts';
import { updateAudioPhase, updateGenerativeAudioContext } from './game-loop-audio.ts';
import { updateComputePhase } from './game-loop-compute.ts';
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
    beatFlashIntensity,
    setBeatFlashIntensity,
    cameraZoomPulse,
    setCameraZoomPulse,
    cameraShake,
    setCameraShakeCore,
    lastBeatPhase,
    setLastBeatPhase,
    baseFOV,
} from './game-loop-core.ts';
import { updateFoliagePhase } from './game-loop-foliage.ts';
import { updateGameplayPhase } from './game-loop-gameplay.ts';
import { updateInteractionPhase, updateExploreCameraPhase } from './game-loop-input.ts';
import { updateParticlesPhase } from './game-loop-particles.ts';
import { updatePhysicsPhase } from './game-loop-physics.ts';
import { updatePostFX, renderPostProcessing } from './game-loop-postfx.ts';
import { updateStreamingPhase } from './game-loop-streaming.ts';
import { updateVisualsPhase } from './game-loop-visuals.ts';

// Re-exports (public surface for main.ts / index.ts)
export { initGameLoopDependencies, getGameTime, getAudioState, getBeatFlashIntensity };
export { addCameraShake } from './camera-shake.ts';

// --- Animation Loop State ---
const clock = new THREE.Clock();

let _firstFrameLogged = false;

export function animate() {
    if (!_firstFrameLogged) {
        console.log('[GameLoop] Entered animate() first frame');
    }

    if (!sceneRef || !cameraRef || !rendererRef || !postProcessingRef) {
        if (!_firstFrameLogged) {
            console.log('[GameLoop] Early exit - missing refs', {
                sceneRef: !!sceneRef,
                cameraRef: !!cameraRef,
                rendererRef: !!rendererRef,
                postProcessingRef: !!postProcessingRef,
            });
            _firstFrameLogged = true;
        }
        return;
    }

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

    if (!_firstFrameLogged) {
        console.log('[GameLoop] Passing ref check, proceeding to tick phases...');
        _firstFrameLogged = true;
    }

    const rawDelta = clock.getDelta();
    const photoMode = getPhotoMode();
    photoMode?.update(rawDelta);
    const simDelta = photoMode?.getSimulationDelta(rawDelta) ?? rawDelta;
    const delta = Math.min(simDelta, 0.1);

    // 1. Audio and Beat phase
    const audioState = updateAudioPhase(delta);

    const currentBPM = audioState?.bpm || 120;
    const timeFactor = 120 / Math.max(10, currentBPM);
    const gt = getGameTime() + delta * timeFactor;
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

    // 1b. Chunk streaming (#1546/#1548) — no-op unless the "play" boot path
    // is active; drives horizon load/evict as the player crosses chunk bounds.
    updateStreamingPhase(player.position);

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

    updateGenerativeAudioContext(player.position, visualsState.dayNightBias);

    // 2b. Foliage materials + batcher LOD (after sky/fog uniforms settle)
    updateFoliagePhase(
        delta,
        audioState,
        visualsState.isNightNow,
        visualsState.weatherStateStr,
        visualsState.weatherIntensity,
        visualsState.dayNightBias
    );

    // 3. Particles and Music Reactivity phase
    updateParticlesPhase(
        delta,
        gt + timeOffsetRef.value,
        audioState,
        visualsState.isNightNow,
        visualsState.cyclePos >= 0.2 + 0.3 + 0.1 + 0.1 // deep night start approx, exact logic is in config
    );

    // 4. PostFX and Camera phase
    profiler.measure('PostFX', () => {
        updatePostFX(delta);
    });

    updateExploreCameraPhase(delta, exploreActive);

    if (firefliesRef) {
        firefliesRef.visible = visualsState.cyclePos >= 0.2 + 0.3 + 0.1 + 0.1;
    }

    // 5. Compute passes
    updateComputePhase();
    tickComputeOrchestrator();

    updateImpacts(rendererRef, gt + timeOffsetRef.value);
    updateDandelionSeeds(rendererRef);
    updateFaunaSystem(delta, gt + timeOffsetRef.value);
    // Entity behaviors (bob/interact highlight) — after fauna so a behavior can
    // read this frame's entity transforms, before the hero mixer tick.
    updateBehaviorSystem(delta, gt + timeOffsetRef.value);
    // Hero clip animation: one mixer tick for every registered rig, after the
    // systems that may have changed which clip a rig should be playing. Systems
    // themselves call playHeroClip/stopHeroClip and never touch the loop.
    updateHeroAnimations(delta);
    if (isHeroAnimationDemoEnabled() && sceneRef && player.position) {
        ensureHeroAnimationDemo(sceneRef, player.position);
    }
    updateSugarCavesTraversal(player.position.x, player.position.y, player.position.z);
    updatePresenceSystem(delta, cameraRef, player.position);

    // 6. Physics Phase
    const devOrbitActive = exploreActive;
    updatePhysicsPhase(delta, devOrbitActive, audioState);
    if (!_firstFrameLogged) {
        console.log('[GameLoop] Physics phase completed');
    }

    // 7. Gameplay Phase
    updateGameplayPhase(delta, gt + timeOffsetRef.value, exploreActive, audioState);
    if (!_firstFrameLogged) {
        console.log('[GameLoop] Gameplay phase completed');
    }

    // 8. Render
    renderPostProcessing();

    if (!_firstFrameLogged) {
        console.log('[GameLoop] Render phase completed - First frame loop fully complete');
    }

    profiler.endFrame();
}
