// src/core/main.ts
// Main entry point - Core initialization and game startup

import * as THREE from 'three';
import '../../style.css';
import { validateNodeGeometries } from '../foliage/index.ts';

import { InteractionSystem } from '../systems/interaction.ts';
import { musicReactivitySystem } from '../systems/music-reactivity.ts';
import { fluidSystem } from '../systems/fluid_system.ts';
import { AudioSystem } from '../audio/audio-system.ts';
import { BeatSync } from '../audio/beat-sync.ts';
import { WeatherSystem } from '../systems/weather.ts';
import { initWasm, getGroundHeight } from '../utils/wasm-loader.js';
import { getUnifiedGroundHeightTyped } from '../systems/physics.core.ts';
import { profiler } from '../utils/profiler.js';
import { enableStartupProfiler, finalizeStartupProfile, recordWASMInit, toggleOverlay } from '../utils/startup-profiler.ts';
import { startPhase, endPhase } from '../utils/startup-profiler.ts';
import { glitchGrenadeSystem } from '../systems/glitch-grenade.ts';

// Core imports
import { CONFIG } from './config.ts';
import { initScene, forceFullSceneWarmup } from './init.js';
import { initInput, keyStates } from './input/index.ts';
import { initPostProcessing } from '../foliage/post-processing.ts';

// World & System imports
import { initCriticalWorld, initDeferredWorldContent, initWorld, initWorldCritical, initWorldContent, generateMap, DEFAULT_MAP_CHUNK_SIZE } from '../world/generation.ts';
import { animatedFoliage, interactiveObjects } from '../world/state.ts';
import { fireRainbow } from '../gameplay/rainbow-blaster.ts';
import { player, populatePhysicsGrids } from '../systems/physics/index.ts';

// Refactored module imports
import { animate, initGameLoopDependencies, addCameraShake } from './game-loop.ts';
import { updateTheme, toggleDayNight, setInputSystem } from './hud.ts';
import { initDeferredVisuals, initDeferredVisualsDependencies, runDeferredWarmup } from './deferred-init.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { showDeferredIndicator, hideDeferredIndicator } from '../ui/index.ts';
import { DeferredLoader, LoadPriority } from '../systems/deferred-loader.ts';
import { initLoadingScreen, installLegacyAPI } from '../ui/loading-screen.ts';

// Debug staging system
import { StageLoader, showDebugError, initDebugPanel } from '../debug/index.ts';

// Export core objects for use by other modules
export { scene, camera, renderer, player, addCameraShake };

// --- Initialize Loading Screen (replaces old spinner overlay) ---
const loadingScreen = initLoadingScreen({ theme: 'candy', showEstimatedTime: true });
loadingScreen.show();
installLegacyAPI();

// Hide the old HTML loading overlay now that the new system is active
const oldOverlay = document.getElementById('loading-overlay');
if (oldOverlay) {
    oldOverlay.style.display = 'none';
}

// --- Enable Startup Profiler ---

enableStartupProfiler({
    slowPhaseThreshold: 100,
    enableOverlay: false,
    enableConsole: true,
    saveToFile: true,
});

// --- Initialize Debug Panel (if ?debug=1) ---
initDebugPanel();

// --- Initialization Pipeline with Debug Staging ---

// Phase 1: Core Scene Setup (Immediate)
loadingScreen.startPhase('core-scene');
console.time('Core Scene Setup');

let sceneInitResult: ReturnType<typeof initScene>;
await StageLoader.loadStage('core', () => {
    sceneInitResult = initScene();
});

if (!sceneInitResult) {
    const msg = 'Core scene initialization was skipped or failed';
    console.error('[Startup] Core Scene Setup failed');
    loadingScreen.showFatalError(`Failed to initialize 3D scene.\n${msg}`);
    throw new Error(msg);
}

const { scene, camera, renderer, ambientLight, sunLight, sunGlow, sunCorona, lightShaftGroup, sunGlowMat, coronaMat, uShaftOpacity } = sceneInitResult;
loadingScreen.updateProgress(70, 'Initializing post-processing...');

// Initialize Post Processing Pipeline
let postProcessing: any;
await StageLoader.loadStage('postProcessing', () => {
    postProcessing = initPostProcessing(renderer, scene, camera);
});

console.timeEnd('Core Scene Setup');
loadingScreen.updateProgress(100);
loadingScreen.completePhase('core-scene');

// Phase 2: Audio & Weather Systems (Lightweight)
loadingScreen.startPhase('audio-init');
console.time('Audio & Systems Init');

let audioSystem: AudioSystem | undefined;
let beatSync: BeatSync | undefined;
await StageLoader.loadStage('audio', () => {
    audioSystem = new AudioSystem(CONFIG.audio.useScriptProcessorNode);
    (window as any).AudioSystem = audioSystem;
    loadingScreen.updateProgress(40, 'Creating audio system...');
    beatSync = new BeatSync(audioSystem);
});

let weatherSystem: WeatherSystem | undefined;
await StageLoader.loadStage('weather', () => {
    loadingScreen.updateProgress(70, 'Initializing weather system...');
    weatherSystem = new WeatherSystem(scene);
    weatherSystem.setRenderer(renderer);
});
console.timeEnd('Audio & Systems Init');
loadingScreen.updateProgress(100);
loadingScreen.completePhase('audio-init');

// Phase 3: World Generation (Critical Path)
loadingScreen.startPhase('world-generation');
console.time('World Generation');
loadingScreen.updateProgress(10, 'Loading critical world...');

// CHANGE: Load only the base world (sky/ground) initially, defer content
let moon: any;
await StageLoader.loadStage('worldCritical', () => {
    const result = initWorldCritical(scene, weatherSystem!);
    moon = result.moon;
});

console.timeEnd('World Generation');
loadingScreen.updateProgress(100, 'Base world ready');
loadingScreen.completePhase('world-generation');

// Initialize Music Reactivity with dependencies
await StageLoader.loadStage('musicReactivity', () => {
    musicReactivitySystem.init(scene, weatherSystem!);
    // Explicitly register moon (cleaner than traversing scene later)
    if (moon) {
        musicReactivitySystem.registerMoon(moon);
    }
    
    // Hook up audio system note events to music reactivity
    if (audioSystem) {
        if (audioSystem.onNote) {
            audioSystem.onNote((note: number, velocity: number, channel: number) => {
                musicReactivitySystem.handleNoteOn(note, velocity, channel);
            });
        } else {
            // If not, we might need to modify AudioSystem or use a polling approach in animate()
            // For now, let's assume we will add setNoteCallback to AudioSystem
            audioSystem.setNoteCallback((note: number, velocity: number, channel: number) => {
                musicReactivitySystem.handleNoteOn(note, velocity, channel);
            });
        }
    }
});

// Validate node material geometries to avoid TSL attribute errors
// DEFERRED: This full-scene traversal is expensive. Run it during idle time.
if ('requestIdleCallback' in window) {
    requestIdleCallback(() => validateNodeGeometries(scene), { timeout: 3000 });
} else {
    setTimeout(() => validateNodeGeometries(scene), 100);
}

// Time offset for day/night cycle (shared with game-loop)
const timeOffset = { value: 0 };

// 4. Input Handling
let inputSystem: any;
let controls: any;
await StageLoader.loadStage('input', () => {
    inputSystem = initInput(camera, audioSystem!, 
        () => toggleDayNight(timeOffset), 
        () => (player as any).isDancing
    );
    setInputSystem(inputSystem);
    controls = inputSystem.controls;
});

// Initialize Interaction System
let interactionSystem: InteractionSystem | undefined;
await StageLoader.loadStage('interaction', () => {
    interactionSystem = new InteractionSystem(camera, inputSystem.updateReticleState);
});

// Initialize deferred visual dependencies
initDeferredVisualsDependencies(scene, camera, renderer);

// Initialize game loop dependencies
await StageLoader.loadStage('gameLoop', () => {
    initGameLoopDependencies({
        scene,
        camera,
        renderer,
        postProcessing,
        weatherSystem: weatherSystem!,
        audioSystem: audioSystem!,
        beatSync: beatSync!,
        interactionSystem: interactionSystem!,
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
            toggleOverlay();
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

// --- IMMEDIATE: Position player (AS WASM already loaded via TLA) ---
const initialGroundY = getUnifiedGroundHeightTyped(camera.position.x, camera.position.z, getGroundHeight);
camera.position.y = initialGroundY + 1.8;
// ⚡ FIX: Sync player explicitly to prevent a massive camera swoop frame 1
player.position.copy(camera.position);
player.velocity.set(0, 0, 0);
console.log(`[Startup] Camera positioned at ground height: y=${camera.position.y.toFixed(2)}`);

// --- SHADER WARMUP (before loop starts to prevent first-frame stutter) ---
(async function warmupAndStartLoop() {
    await StageLoader.loadStage('shaderWarmup', async () => {
        loadingScreen.startPhase('shader-warmup');
        loadingScreen.updateProgress(5, 'Pre-compiling shaders...');
        await renderer.compileAsync(scene, camera);
        loadingScreen.updateProgress(55, 'Warming up pipelines...');
        await forceFullSceneWarmup(renderer, scene, camera);
        loadingScreen.updateProgress(90, 'Finalizing scene...');
        console.log('[Startup] Shaders pre-compiled');
        loadingScreen.updateProgress(100, 'Scene ready!');
        loadingScreen.completePhase('shader-warmup');
    });

    // Start game loop NOW — player can move immediately
    renderer.setAnimationLoop(animate);
    try { (window as any).__sceneReady = true; } catch (e) { }

    loadingScreen.hide();
})();

// --- BACKGROUND: Optional Emscripten C++ module (non-blocking) ---
// The JS fallbacks are already active; Emscripten just adds native performance.
StageLoader.loadStage('wasm', async () => {
    await initWasm();
    console.log('[WASM] Emscripten loaded in background');
    fluidSystem.init();
    recordWASMInit(performance.now(), true, true);
}).catch(err => {
    console.warn('[WASM] Emscripten failed, using JS fallbacks:', err);
    recordWASMInit(performance.now(), false, false);
});

// --- START BUTTON + MAP GENERATION (unchanged UX) ---
const startButton = document.getElementById('startButton') as HTMLButtonElement | null;

if (startButton) {
    startButton.disabled = false;
    startButton.setAttribute('aria-disabled', 'false');
    startButton.setAttribute('aria-busy', 'false');
    startButton.removeAttribute('title');
    startButton.innerHTML = 'Enter World <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>';

    let worldGenerated = false;
    let isGenerating = false;

    function yieldFrame(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 50));
    }

    async function enterWorld() {
        if (isGenerating || !startButton || worldGenerated) return;

        isGenerating = true;
        console.log('[Startup] Entering world...');

        // Immediate UI feedback
        startButton.disabled = true;
        startButton.setAttribute('aria-disabled', 'true');
        startButton.setAttribute('aria-busy', 'true');
        startButton.setAttribute('title', 'Generating world...');
        startButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>Generating... <span aria-hidden="true">🍭</span>';

        await yieldFrame(); // Let the spinner paint

        const worldGenResult = await StageLoader.loadStage('worldGeneration', async () => {
            // Clean up preview mushroom if it exists (from optimize branch)
            if (typeof previewMushroom !== 'undefined' && previewMushroom) {
                scene.remove(previewMushroom);
                previewMushroom.traverse((child) => {
                    const mesh = child as THREE.Mesh;
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) {
                            mesh.material.forEach(m => m.dispose());
                        } else {
                            mesh.material.dispose();
                        }
                    }
                });
                const idx = animatedFoliage.indexOf(previewMushroom);
                if (idx > -1) animatedFoliage.splice(idx, 1);
                const intIdx = interactiveObjects.indexOf(previewMushroom);
                if (intIdx > -1) interactiveObjects.splice(intIdx, 1);
            }

            loadingScreen.show();
            loadingScreen.startPhase('map-generation');
            loadingScreen.updateProgress(0, 'Generating world map...');

            let lastAnnounced = -1;
            startPhase('Map Generation');

            await generateMap(weatherSystem!, DEFAULT_MAP_CHUNK_SIZE, (current: number, total: number) => {
                const percent = Math.floor((current / total) * 100);
                loadingScreen.updateProgress(percent, `Generating world... ${percent}%`);
                startButton.style.background = `linear-gradient(90deg, #FF6B6B ${percent}%, #FFB6C1 ${percent}%)`;

                if (percent - lastAnnounced >= 10 || percent === 100) {
                    startButton.innerHTML = `<span class="spinner" aria-hidden="true"></span>Generating ${percent}%... <span aria-hidden="true">🍭</span>`;
                    lastAnnounced = percent;
                }
            });

            endPhase('Map Generation');

            // ⚡ Critical: Populate physics grids right after map generation
            populatePhysicsGrids();

            loadingScreen.updateProgress(100, 'World generation complete!');
            loadingScreen.completePhase('map-generation');
            loadingScreen.hide();
        });

        if (!worldGenResult.success) {
            throw new Error(worldGenResult.error || 'World generation failed');
        }

        try {
            const instructions = document.getElementById('instructions');
            if (instructions) instructions.style.display = 'none';

            import('../utils/toast.js').then(({ showToast }) => {
                showToast("Click to explore! Press [ESC] for Controls", "🎮", 4000);
            });

            // Start background processor for deferred work
            showDeferredIndicator();
            globalBackgroundProcessor.onComplete(() => {
                hideDeferredIndicator();
                finalizeStartupProfile();
                console.log('[Startup] All deferred background tasks completed.');
            });

            // Queue non-critical visuals
            globalBackgroundProcessor.enqueue({
                id: 'deferred_visuals',
                execute: () => {
                    StageLoader.loadStage('deferredVisuals', () => {
                        console.log('[Deferred] Loading celestial bodies and aurora...');
                        startPhase('Deferred Visuals Init');
                        initDeferredVisuals();
                        endPhase('Deferred Visuals Init');
                    });
                }
            });

            // Queue any remaining deferred warmup
            globalBackgroundProcessor.enqueue({
                id: 'shader_warmup',
                execute: () => {
                    runDeferredWarmup(scene, camera, renderer);
                }
            });

            globalBackgroundProcessor.start();

            worldGenerated = true;
            startButton.style.background = '';
            startButton.innerHTML = 'Regenerate World <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>';

        } catch (err) {
            console.error('[Init] World generation failed:', err);
            loadingScreen.hide();
            startButton.style.background = '';
            startButton.innerHTML = 'Retry';
        } finally {
            isGenerating = false;
            startButton.disabled = false;
            startButton.setAttribute('aria-disabled', 'false');
            startButton.setAttribute('aria-busy', 'false');
            startButton.removeAttribute('title');
        }
    }

    // Auto-start world generation so player isn't stuck at blank screen
    enterWorld();

    // Regenerate support
    startButton.addEventListener('click', () => {
        if (!isGenerating) {
            enterWorld();
        }
    });
}

// --- DEFERRED WORLD CONTENT (non-blocking, after loop is running) ---
function startDeferredWorldLoading() {
    StageLoader.loadStage('deferredWorld', async () => {
        await initDeferredWorldContent(scene, weatherSystem!, (pct, label) => {
            if (pct % 25 === 0 || pct === 100) {
                console.log(`[Deferred World] ${pct}%: ${label}`);
            }
        });
    }).catch(err => {
        console.error('[World] Deferred content failed:', err);
    });
}

// Start deferred world content shortly after loop begins
setTimeout(startDeferredWorldLoading, 150);

// --- DEFERRED VISUAL LOADER (kept for now, but consider consolidating) ---
const deferredVisualLoader = new DeferredLoader({ batchSize: 1, useIdleCallback: true, idleTimeout: 100 });

deferredVisualLoader.add(LoadPriority.HIGH, 'deferredVisuals', () => {
    console.log('[Deferred] Loading celestial bodies and aurora (via DeferredLoader)...');
    startPhase('Deferred Visuals Init');
    initDeferredVisuals();
    endPhase('Deferred Visuals Init');
});

deferredVisualLoader.add(LoadPriority.LOW, 'startupProfile', () => {
    finalizeStartupProfile();
});

deferredVisualLoader.on('complete', ({ loaded }) => {
    console.log(`[DeferredLoader] All ${loaded} visual elements loaded`);
});

// Start idle-based loader a bit later
setTimeout(() => {
    deferredVisualLoader.start();
}, 400);
