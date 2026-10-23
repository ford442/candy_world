/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
// src/core/game-loop.ts
// Thin animate() coordinator — tick phases live in sibling game-loop-*.ts modules.
// Frame order is intentional; do not reorder phases without a gameplay audit.

import * as THREE from 'three';
import { tickComputeOrchestrator } from '../compute/compute-orchestrator.ts';
import { ensureHeroAnimationDemo, isHeroAnimationDemoEnabled } from '../debug/tools-stub.ts';
import { updateDandelionSeeds } from '../foliage/dandelion-seeds.ts';
import { setFireflyMeshesVisible } from '../foliage/firefly-registry.ts';
import { updateImpacts } from '../foliage/impacts.ts';
import { updateHeroAnimations } from '../systems/animation/clip-player.ts';
import { updateBehaviorSystem } from '../systems/ecs/behaviors/index.ts';
import { updateFaunaSystem } from '../systems/fauna/index.ts';
import { initLivingScore, updateLivingScore } from '../systems/living-score.ts';
import { updatePresenceSystem } from '../systems/net/lazy.ts';
import { performanceBudget } from '../systems/performance-budget/performance-budget-core.ts';
import { getPhotoMode } from '../systems/photo-mode/lazy.ts';
import { player } from '../systems/physics/index.ts';
import { scheduler } from '../systems/scheduler/system-scheduler.ts';
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
    audioSystemRef,
    cameraRef,
    rendererRef,
    postProcessingRef,
    _loggedWebGPULimits,
    setLoggedWebGPULimits,
    WebGPURendererWithDeviceLimits,
    timeOffsetRef,
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

const FIXED_TIME_STEP = 1.0 / 60.0;
const MAX_STEPS = 5;
let accumulator = 0;

let _firstFrameLogged = false;
// initLivingScore() is async, so calling it every frame allocates a Promise
// per frame even after its own once-guard returns. Call it once.
let _livingScoreBooted = false;


// eslint-disable-next-line @typescript-eslint/no-explicit-any
scheduler.register('AUDIO', (ctx: any) => {
    ctx.audioState = updateAudioPhase(ctx.delta);

    const currentBPM = ctx.audioState?.bpm || 120;
    ctx.timeFactor = 120 / Math.max(10, currentBPM);
    const gt = getGameTime() + ctx.delta * ctx.timeFactor;
    setGameTime(gt);
    ctx.gameTime = gt;

    const currentBeatPhase = ctx.audioState?.beatPhase || 0;
    if (currentBeatPhase < lastBeatPhase && lastBeatPhase > 0.8) {
        const kickTrigger = ctx.audioState?.kickTrigger || 0;
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
        if (cameraRef) cameraRef.fov = baseFOV - czp;
        if (cameraRef) cameraRef.updateProjectionMatrix();
        czp *= 0.85;
        if (czp < 0.1) {
            czp = 0;
            if (cameraRef) cameraRef.fov = baseFOV;
            if (cameraRef) cameraRef.updateProjectionMatrix();
        }
        setCameraZoomPulse(czp);
    }

    let cs = cameraShake;
    if (cs > 0) {
        cs *= 0.9;
        if (cs < 0.001) cs = 0;
        setCameraShakeCore(cs);
    }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
scheduler.register('INPUT', (ctx: any) => {
    updateInteractionPhase(ctx.delta);
});

scheduler.register('STREAMING', () => {
    updateStreamingPhase(player.position);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
scheduler.register('VISUALS', (ctx: any) => {
    ctx.exploreActive = isExploreActive();
    ctx.visualsState = updateVisualsPhase(
        ctx.delta,
        ctx.gameTime + timeOffsetRef.value,
        ctx.gameTime,
        ctx.audioState,
        getBeatFlashIntensity(),
        ctx.exploreActive,
        player.position
    );

    updateGenerativeAudioContext(player.position, ctx.visualsState.dayNightBias);
    if (audioSystemRef) {
        if (!_livingScoreBooted) {
            _livingScoreBooted = true;
            void initLivingScore();
        }
        updateLivingScore(audioSystemRef, ctx.visualsState.dayNightBias, ctx.delta);
    }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
scheduler.register('FOLIAGE', (ctx: any) => {
    updateFoliagePhase(
        ctx.delta,
        ctx.audioState,
        ctx.visualsState.isNightNow,
        ctx.visualsState.weatherStateStr,
        ctx.visualsState.weatherIntensity,
        ctx.visualsState.dayNightBias
    );
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
scheduler.register('PARTICLES', (ctx: any) => {
    updateParticlesPhase(
        ctx.delta,
        ctx.gameTime + timeOffsetRef.value,
        ctx.audioState,
        ctx.visualsState.isNightNow,
        ctx.visualsState.isDeepNight
    );
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
scheduler.register('POSTFX', (ctx: any) => {
    profiler.measure('PostFX', () => {
        updatePostFX(ctx.delta);
    });

    updateExploreCameraPhase(ctx.delta, ctx.exploreActive);
    setFireflyMeshesVisible(ctx.visualsState.isNightNow);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
scheduler.register('COMPUTE', (ctx: any) => {
    updateComputePhase();
    tickComputeOrchestrator();

    updateImpacts(rendererRef, ctx.gameTime + timeOffsetRef.value);
    updateDandelionSeeds(rendererRef);
    updateFaunaSystem(ctx.delta, ctx.gameTime + timeOffsetRef.value);
    updateBehaviorSystem(ctx.delta, ctx.gameTime + timeOffsetRef.value);
    updateHeroAnimations(ctx.delta);
    if (isHeroAnimationDemoEnabled() && sceneRef && player.position) {
        ensureHeroAnimationDemo(sceneRef, player.position);
    }
    updateSugarCavesTraversal(player.position.x, player.position.y, player.position.z);
    if (cameraRef) updatePresenceSystem(ctx.delta, cameraRef, player.position);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
scheduler.register('PHYSICS', (ctx: any) => {
    const devOrbitActive = ctx.exploreActive;
    updatePhysicsPhase(ctx.delta, devOrbitActive, ctx.audioState);
    if (!_firstFrameLogged) {
        console.log('[GameLoop] Physics phase completed');
    }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
scheduler.register('GAMEPLAY', (ctx: any) => {
    updateGameplayPhase(ctx.delta, ctx.gameTime + timeOffsetRef.value, ctx.exploreActive, ctx.audioState);
    if (!_firstFrameLogged) {
        console.log('[GameLoop] Gameplay phase completed');
    }
});

scheduler.register('RENDER', () => {
    renderPostProcessing();
});

let _systemsRegistered = false;

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
    performanceBudget.beginFrame();

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
    if (!_systemsRegistered) {
        _systemsRegistered = true;
        // Systems are registered on import
    }

    accumulator += delta;
    let steps = 0;

    while (accumulator >= FIXED_TIME_STEP && steps < MAX_STEPS) {
        scheduler.updateContext({ delta: FIXED_TIME_STEP, rawDelta: rawDelta });

        // 1. Audio and Beat phase
        scheduler.execute('AUDIO');

        // 1a. Input
        scheduler.execute('INPUT');

        // 1b. Chunk streaming
        scheduler.execute('STREAMING');

        // 5. Compute passes
        scheduler.execute('COMPUTE');

        // 6. Physics Phase
        scheduler.execute('PHYSICS');

        // 7. Gameplay Phase
        scheduler.execute('GAMEPLAY');

        accumulator -= FIXED_TIME_STEP;
        steps++;
    }

    if (accumulator >= FIXED_TIME_STEP) {
        accumulator = 0; // Prevent spiral of death
    }

    // Update context for visuals using the original frame delta
    scheduler.updateContext({ delta, rawDelta });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ctx = scheduler.getContext();

    // 2. Visuals phase
    scheduler.execute('VISUALS');

    // 2b. Foliage materials + batcher LOD
    scheduler.execute('FOLIAGE');

    // 3. Particles and Music Reactivity phase
    scheduler.execute('PARTICLES');

    // 4. PostFX and Camera phase
    scheduler.execute('POSTFX');

    // 8. Render
    scheduler.execute('RENDER');

    if (!_firstFrameLogged) {
        console.log('[GameLoop] Render phase completed - First frame loop fully complete');
    }

    profiler.endFrame();
    performanceBudget.endFrame();

    if (rendererRef && rendererRef.info) {
        // GPU frame times are typically read async after the frame completes.
        // WebGPURenderer resolves timestamps internally during render().
        // We pull the computed values here at the end of the frame loop.
        const computeTime = (rendererRef.info.compute && rendererRef.info.compute.timestamp) || 0;
        const renderTime = (rendererRef.info.render && rendererRef.info.render.timestamp) || 0;
        const totalGpuTime = computeTime + renderTime;

        if (totalGpuTime > 0) {
            performanceBudget.setGpuFrameTime(totalGpuTime);
        } else {
            performanceBudget.setGpuFrameTime(null);
        }
    }
}
