// src/core/game-loop.ts
// Thin animate() coordinator: read the frame clock, run the SystemScheduler,
// read back GPU timings. The frame itself is registered in game-loop-systems.ts
// (phases, fixed step and how to add a system: docs/ARCHITECTURE.md).

import * as THREE from 'three';
import { installFrameHitchCounter } from '../rendering/frame-hitches.ts';
import { createGpuFrameTimer, type GpuFrameTimer } from '../rendering/gpu-frame-timer.ts';
import { performanceBudget } from '../systems/performance-budget/performance-budget-core.ts';
import { getPhotoMode } from '../systems/photo-mode/lazy.ts';
import { player } from '../systems/physics/index.ts';
import { profiler } from '../utils/profiler.ts';
import { simRng } from '../utils/sim-rng.ts';
import { getWorldSeed } from '../world/world-seed.ts';
import { isExploreActive } from './camera-modes.ts';
import {
    initGameLoopDependencies,
    getGameTime,
    getAudioState,
    getBeatFlashIntensity,
    sceneRef,
    cameraRef,
    rendererRef,
    postProcessingRef,
    _loggedWebGPULimits,
    setLoggedWebGPULimits,
    WebGPURendererWithDeviceLimits,
} from './game-loop-core.ts';
import { registerFrameSystems } from './game-loop-systems.ts';
import { getPlatformCapabilities } from './platform/capabilities.ts';
import { frameScheduler } from './scheduler/frame-scheduler.ts';

// Re-exports (public surface for main.ts / index.ts)
export { initGameLoopDependencies, getGameTime, getAudioState, getBeatFlashIntensity };
export { addCameraShake } from './camera-shake.ts';
export { frameScheduler };

// --- Animation Loop State ---
// `Timer` replaces the deprecated `Clock`; not connected to the Page Visibility
// API, so a hidden tab still yields one long delta (clamped below), as before.
const clock = new THREE.Timer();

registerFrameSystems(frameScheduler);
if (typeof window !== 'undefined') window.__frameScheduler = frameScheduler;

let _entryLogged = false;
let _firstFrameLogged = false;
/** Created on the first rendered frame; a no-op unless timestamp-query was granted. */
let gpuFrameTimer: GpuFrameTimer | null = null;
/** First-frame time and hitches in the first 30 s of play (shader-compile stalls). */
const frameHitches = installFrameHitchCounter();

export function animate() {
    if (!_entryLogged) {
        console.log('[GameLoop] Entered animate() first frame');
    }

    if (!sceneRef || !cameraRef || !rendererRef || !postProcessingRef) {
        if (!_entryLogged) {
            console.log('[GameLoop] Early exit - missing refs', {
                sceneRef: !!sceneRef,
                cameraRef: !!cameraRef,
                rendererRef: !!rendererRef,
                postProcessingRef: !!postProcessingRef,
            });
            _entryLogged = true;
        }
        return;
    }
    _entryLogged = true;

    frameHitches.beginFrame(performance.now());
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
        // The map's seed is known by the first frame; the sim stream starts from it.
        simRng.setSeed(getWorldSeed());
    }

    clock.update();
    const rawDelta = clock.getDelta();
    const photoMode = getPhotoMode();
    photoMode?.update(rawDelta);
    const simDelta = photoMode?.getSimulationDelta(rawDelta) ?? rawDelta;
    const delta = Math.min(simDelta, 0.1);

    frameScheduler.runFrame({
        dt: delta,
        rawDt: rawDelta,
        player,
        camera: cameraRef,
        caps: getPlatformCapabilities(),
        exploreActive: isExploreActive(),
    });

    if (!_firstFrameLogged) {
        console.log('[GameLoop] First frame complete:', frameScheduler.getOrder().join(' → '));
        _firstFrameLogged = true;
    }

    profiler.endFrame();
    performanceBudget.endFrame();

    // GPU time from timestamp-query (when granted), sampled every few frames.
    if (rendererRef) {
        gpuFrameTimer ??= createGpuFrameTimer(rendererRef, (ms) => {
            performanceBudget.setGpuFrameTime(ms);
            postProcessingRef?.onGpuFrameTime?.(ms);
        });
        gpuFrameTimer.endFrame();
    }
    frameHitches.endFrame(performance.now());
}
