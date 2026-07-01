// src/core/index.ts
// Barrel file for core module exports

export { animate, initGameLoopDependencies, addCameraShake, getGameTime, getAudioState, getBeatFlashIntensity } from './game-loop.ts';
export { updateHUD, updateTheme, toggleDayNight, setInputSystem } from './hud.ts';
export { initDeferredVisuals, initDeferredVisualsDependencies, runDeferredWarmup, abortWarmup, applyAwakenedPersistenceAfterWorldLoad } from './deferred-init.ts';
export { scene, camera, renderer, player, addCameraShake as addCameraShakeMain } from './main.ts';
