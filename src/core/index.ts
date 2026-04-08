// src/core/index.ts
// Barrel file for core module exports

export { animate, initGameLoopDependencies, addCameraShake, getGameTime, getAudioState, getBeatFlashIntensity } from './game-loop.ts';
export { updateHUD, updateTheme, toggleDayNight, setInputSystem, updateTrackerHUD } from './hud.ts';
export { initDeferredVisuals, initDeferredVisualsDependencies, runDeferredWarmup } from './deferred-init.ts';
export { scene, camera, renderer, player, addCameraShake as addCameraShakeMain } from './main.ts';
