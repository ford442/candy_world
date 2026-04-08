// src/core/main.ts
// Main entry point - Core initialization and game startup

import * as THREE from 'three';
import '../../style.css';
import { validateNodeGeometries } from '../foliage/index.ts';
import { createMushroom } from '../foliage/mushrooms.ts';
import { InteractionSystem } from '../systems/interaction.ts';
import { musicReactivitySystem } from '../systems/music-reactivity.ts';
import { fluidSystem } from '../systems/fluid_system.ts';
import { AudioSystem } from '../audio/audio-system.ts';
import { BeatSync } from '../audio/beat-sync.ts';
import { WeatherSystem } from '../systems/weather.ts';
import { initWasm, getGroundHeight } from '../utils/wasm-loader.js';
import { getUnifiedGroundHeightTyped } from '../systems/physics.core.ts';
import { profiler } from '../utils/profiler.js';
import { enableStartupProfiler, finalizeStartupProfile, recordWASMInit } from '../utils/startup-profiler.ts';
import { startPhase, endPhase } from '../utils/startup-profiler.ts';
import { glitchGrenadeSystem } from '../systems/glitch-grenade.ts';

// Core imports
import { CONFIG } from './config.ts';
import { initScene, forceFullSceneWarmup } from './init.js';
import { initInput, keyStates } from './input/index.js';
import { initPostProcessing } from '../foliage/post-processing.ts';

// World & System imports
import { initWorld, generateMap, DEFAULT_MAP_CHUNK_SIZE } from '../world/generation.ts';
import { animatedFoliage } from '../world/state.ts';
import { fireRainbow } from '../gameplay/rainbow-blaster.ts';
import { player } from '../systems/physics/index.ts';

// Refactored module imports
import { animate, initGameLoopDependencies, addCameraShake } from './game-loop.ts';
import { updateTheme, toggleDayNight, setInputSystem } from './hud.ts';
import { initDeferredVisuals, initDeferredVisualsDependencies, runDeferredWarmup } from './deferred-init.ts';

// Export core objects for use by other modules
export { scene, camera, renderer, player, addCameraShake };

// --- Enable Startup Profiler ---
enableStartupProfiler({
    slowPhaseThreshold: 100,
    enableOverlay: true,
    enableConsole: true,
    saveToFile: true,
});

// --- Initialization Pipeline ---

// Phase 1: Core Scene Setup (Immediate)
console.time('Core Scene Setup');
const { scene, camera, renderer, ambientLight, sunLight, sunGlow, sunCorona, lightShaftGroup, sunGlowMat, coronaMat, uShaftOpacity } = initScene();

// Initialize Post Processing Pipeline
const postProcessing = initPostProcessing(renderer, scene, camera);

console.timeEnd('Core Scene Setup');

// Phase 2: Audio & Weather Systems (Lightweight)
console.time('Audio & Systems Init');
const audioSystem = new AudioSystem(CONFIG.audio.useScriptProcessorNode);
const beatSync = new BeatSync(audioSystem);
const weatherSystem = new WeatherSystem(scene);
weatherSystem.setRenderer(renderer);
console.timeEnd('Audio & Systems Init');

// Phase 3: World Generation (Critical Path)
console.time('World Generation');
if (window.setLoadingStatus) window.setLoadingStatus("Loading World Map...");

// CHANGE: Load only the base world (sky/ground) initially, defer content
const { moon } = initWorld(scene, weatherSystem, false);
console.timeEnd('World Generation');

// Initialize Music Reactivity with dependencies
musicReactivitySystem.init(scene, weatherSystem);
// Explicitly register moon (cleaner than traversing scene later)
musicReactivitySystem.registerMoon(moon);

// Hook up audio system note events to music reactivity
if (audioSystem.onNote) {
    audioSystem.onNote((note, velocity, channel) => {
        musicReactivitySystem.handleNoteOn(note, velocity, channel);
    });
} else {
    // If not, we might need to modify AudioSystem or use a polling approach in animate()
    // For now, let's assume we will add setNoteCallback to AudioSystem
    audioSystem.setNoteCallback((note, velocity, channel) => {
        musicReactivitySystem.handleNoteOn(note, velocity, channel);
    });
}

// Validate node material geometries to avoid TSL attribute errors
validateNodeGeometries(scene);

// Time offset for day/night cycle (shared with game-loop)
const timeOffset = { value: 0 };

// 4. Input Handling
const inputSystem = initInput(camera, audioSystem, 
    () => toggleDayNight(timeOffset), 
    () => (player as any).isDancing
);
setInputSystem(inputSystem);
const controls = inputSystem.controls;

// Initialize Interaction System
const interactionSystem = new InteractionSystem(camera, inputSystem.updateReticleState);

// Initialize deferred visual dependencies
initDeferredVisualsDependencies(scene, camera, renderer);

// Initialize game loop dependencies
initGameLoopDependencies({
    scene,
    camera,
    renderer,
    postProcessing,
    weatherSystem,
    audioSystem,
    beatSync,
    interactionSystem,
    moon,
    fireflies: null,
    controls,
    sunLight,
    ambientLight,
    sunGlow,
    sunCorona,
    lightShaftGroup,
    sunGlowMat,
    coronaMat,
    uShaftOpacity,
    timeOffset
});

// Optimization: Hoist reusable objects to module scope to prevent GC in animation loop
const _scratchClickDir = new THREE.Vector3();
const _scratchClickOrigin = new THREE.Vector3();

// DEV: Demo triggers
window.addEventListener('keydown', (e) => {
    try {
        if (!e.key) return;
        const key = e.key.toLowerCase();
        if (key === 'p') {
            profiler.toggle();
        } else if (key === 'o') {
            // Toggle startup profiler overlay
            import('../utils/startup-profiler.ts').then(({ toggleOverlay }) => {
                toggleOverlay();
            });
        } else if (key === 'f') {
            // Demo logic...
        } else if (key === 'g') {
            // Throw Glitch Grenade
            if (document.pointerLockElement) {
                camera.getWorldDirection(_scratchClickDir);
                glitchGrenadeSystem.throwGrenade(scene, camera.position, _scratchClickDir);
            }
        }
    } catch (err) {
        console.warn('Demo trigger error', err);
    }
});

// Mouse input: Rainbow Blaster (click while pointer locked)
window.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement) {
        // Left Click (0) -> Standard Interaction
        if (e.button === 0) {
            // First check if we are interacting with an object
            const handled = interactionSystem.triggerClick();

            // If interaction didn't handle it, fire rainbow blaster
            if (!handled) {
                camera.getWorldDirection(_scratchClickDir);
                _scratchClickOrigin.copy(camera.position).addScaledVector(_scratchClickDir, 1.0);
                _scratchClickOrigin.y -= 0.2; // Lower slightly
                fireRainbow(scene, _scratchClickOrigin, _scratchClickDir);
            }
        }
    }
});

// WASM Init & Game Startup
initWasm().then(async (wasmLoaded) => {
    const wasmInitStart = performance.now();
    console.log(`WASM module ${wasmLoaded ? 'active' : 'using JS fallbacks'}`);

    // Initialize C++ Fluid System (Phase 3)
    fluidSystem.init();

    // Record WASM initialization metrics
    recordWASMInit(wasmInitStart, true, wasmLoaded);

    // Use unified ground height for proper spawn positioning (accounts for lake carving)
    const initialGroundY = getUnifiedGroundHeightTyped(camera.position.x, camera.position.z, getGroundHeight);
    camera.position.y = initialGroundY + 1.8;
    console.log(`[Startup] Camera positioned at ground height: y=${camera.position.y.toFixed(2)}`);

    if (window.setLoadingStatus) window.setLoadingStatus("Preparing Scene...");

    // --- CRITICAL: Start Game Loop IMMEDIATELY (Before heavy compile) ---
    renderer.setAnimationLoop(animate);
    try { window.__sceneReady = true; } catch (e) { }

    // Hide loading screen early - the basic scene is ready
    if (window.setLoadingStatus) window.setLoadingStatus("Entering Candy World...");

    setTimeout(() => {
        if (window.hideLoadingScreen) window.hideLoadingScreen();
    }, 200);

    // Create a temporary "Preview" mushroom for the startup scene
    const previewMushroom = createMushroom({ size: 'giant', scale: 1.5, hasFace: true, isBouncy: true });
    previewMushroom.position.set(0, getUnifiedGroundHeightTyped(0, -10, getGroundHeight), -10);
    previewMushroom.rotation.y = Math.PI / 8;
    scene.add(previewMushroom);
    animatedFoliage.push(previewMushroom);

    const startButton = document.getElementById('startButton') as HTMLButtonElement | null;
    if (startButton) {
        startButton.disabled = false;
        startButton.innerHTML = 'Enter World <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>';
        startButton.focus();

        startButton.addEventListener('click', () => {
            console.log('[Startup] Entering world...');

            // UX: Show loading state immediately to prevent "freeze" feeling
            startButton.disabled = true;
            startButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>Generating... <span aria-hidden="true">🍭</span>';

            // Defer execution slightly to let the UI update
            setTimeout(async () => {
                scene.remove(previewMushroom);
                const idx = animatedFoliage.indexOf(previewMushroom);
                if (idx > -1) animatedFoliage.splice(idx, 1);

                // Use async map generation with progress updates
                // 🎨 Palette: Throttle announcements to prevent SR spam
                let lastAnnounced = -1;
                startButton.setAttribute('aria-busy', 'true');

                startPhase('Map Generation');
                await generateMap(weatherSystem, DEFAULT_MAP_CHUNK_SIZE, (current, total) => {
                    const percent = Math.floor((current / total) * 100);

                    // Always update visual gradient for smoothness
                    startButton.style.background = `linear-gradient(90deg, #FF6B6B ${percent}%, #FFB6C1 ${percent}%)`;

                    // Throttle text updates to every 10% or completion
                    if (percent - lastAnnounced >= 10 || percent === 100) {
                        startButton.innerHTML = `<span class="spinner" aria-hidden="true"></span>Generating ${percent}%... <span aria-hidden="true">🍭</span>`;
                        lastAnnounced = percent;
                    }
                });
                endPhase('Map Generation');

                startButton.removeAttribute('aria-busy');

                // UX: Now that generation is done, hide the instructions
                // (We delayed this in input.js to keep the "Generating..." message visible)
                const instructions = document.getElementById('instructions');
                if (instructions) instructions.style.display = 'none';

                // 🎨 Palette: Welcome Toast
                import('../utils/toast.js').then(({ showToast }) => {
                    showToast("Press [ESC] for Controls", "🎮", 4000);
                });

                // CRITICAL: Re-enable the button so that "Resume" works later (and checks in input.js pass)
                startButton.disabled = false;
                startButton.style.background = ''; // Reset style

                // Note: The pointer lock will happen automatically via input system
            }, 50);

        }, { once: true });
    }

    // --- DEFERRED NUCLEAR WARMUP ---
    // Delay this by 2 seconds to let the browser breathe after initial load
    runDeferredWarmup(scene, camera, renderer);

    setTimeout(() => {
        console.log('[Deferred] Loading celestial bodies and aurora...');
        startPhase('Deferred Visuals Init');
        initDeferredVisuals();
        endPhase('Deferred Visuals Init');

        // Startup is essentially complete after deferred visuals
        setTimeout(() => {
            finalizeStartupProfile();
        }, 100);
    }, 300);

});
