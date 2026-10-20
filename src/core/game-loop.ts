// src/core/game-loop.ts
// Thin animate() coordinator: build the frame inputs, run the SystemScheduler,
// read back GPU timings. The frame itself is registered in game-loop-systems.ts
// (phase order: docs/SCHEDULER.md).

import * as THREE from 'three';
import { performanceBudget } from '../systems/performance-budget/performance-budget-core.ts';
import { getPhotoMode } from '../systems/photo-mode/lazy.ts';
import { player } from '../systems/physics/index.ts';
import { profiler } from '../utils/profiler.ts';
import { isExploreActive } from './camera-modes.ts';
import { updateAudioPhase } from './game-loop-audio.ts';
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
} from './game-loop-core.ts';
import { registerFrameSystems } from './game-loop-systems.ts';
import { getPlatformCapabilities } from './platform/capabilities.ts';
import { SystemScheduler } from './scheduler/index.ts';

// Re-exports (public surface for main.ts / index.ts)
export { initGameLoopDependencies, getGameTime, getAudioState, getBeatFlashIntensity };
export { addCameraShake } from './camera-shake.ts';

// --- Animation Loop State ---
const clock = new THREE.Clock();

export const frameScheduler = new SystemScheduler();
registerFrameSystems(frameScheduler);

let _entryLogged = false;
let _firstFrameLogged = false;

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

    const rawDelta = clock.getDelta();
    const photoMode = getPhotoMode();
    photoMode?.update(rawDelta);
    const simDelta = photoMode?.getSimulationDelta(rawDelta) ?? rawDelta;
    const delta = Math.min(simDelta, 0.1);

    // Audio is sampled once, before any system runs: every phase reads the
    // same analysis, and game time advances at the track's tempo.
    const audioState = updateAudioPhase(delta);
    const currentBPM = audioState?.bpm || 120;
    const timeFactor = 120 / Math.max(10, currentBPM);
    const gt = getGameTime() + delta * timeFactor;
    setGameTime(gt);

    frameScheduler.runFrame({
        dt: delta,
        rawDt: rawDelta,
        time: gt,
        audio: audioState,
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
