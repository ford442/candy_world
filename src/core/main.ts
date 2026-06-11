// src/core/main.ts
// Main entry point - Core initialization and game startup

import * as THREE from 'three';

declare global {
    interface Window {
        __visualRegression?: {
            ready: boolean;
            stableFrames: number;
            frameCount: number;
            isHeadless?: boolean;
        };
    }
}
import '../../style.css';

import { InteractionSystem } from '../systems/interaction.ts';
import { getGroundHeight } from '../utils/wasm-loader.ts';
import { getUnifiedGroundHeightTyped } from '../systems/physics.core.ts';
import { profiler } from '../utils/profiler.ts';
import { enableStartupProfiler, finalizeStartupProfile, toggleOverlay } from '../utils/startup-profiler.ts';
import { startPhase, endPhase } from '../utils/startup-profiler.ts';
import { glitchGrenadeSystem } from '../systems/glitch-grenade.ts';

// Core imports
import { CONFIG } from './config.ts';
import { ShaderWarmup } from '../rendering/shader-warmup.ts';
import { keyStates } from './input/index.ts';
import { setCameraRef } from './camera-ref.ts';

// World & System imports
import { initDeferredWorldContent, populateWorld, WorldMode } from '../world/generation.ts';
import { animatedFoliage, interactiveObjects } from '../world/state.ts';
import { installWorldExportTools } from '../world/map-exporter.ts';
import { fireRainbow } from '../gameplay/rainbow-blaster.ts';
import { player, populatePhysicsGrids } from '../systems/physics/index.ts';

// Refactored module imports
import { animate, addCameraShake } from './game-loop.ts';
import { updateTheme } from './hud.ts';
import { initDeferredVisuals, runDeferredWarmup } from './deferred-init.ts';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { showDeferredIndicator, hideDeferredIndicator } from '../ui/index.ts';
import { reset as resetSpawnTracker, getReport as getSpawnReport } from '../world/spawn-tracker.ts';
import { globalLoadingManager } from '../systems/loading-manager.ts';
import { validateWorldPopulation } from '../world/world-health.ts';
import { showModeBadge } from '../ui/mode-badge.ts';
import { DeferredLoader, LoadPriority } from '../systems/deferred-loader.ts';
import { initLoadingScreen, installLegacyAPI } from '../ui/loading-screen.ts';
import { installBatcherTelemetry } from '../foliage/batcher-telemetry.ts';

// Debug staging + progressive boot
import { initDebugPanel, runBootStage } from '../debug/index.ts';
import { runPreLoopBootstrap } from './progressive-startup.ts';

// Export core objects for use by other modules
// We defer the export until after sceneInitResult is available, but for now we just declare let and assign them.
let scene: any, camera: any, renderer: any;
export { scene, camera, renderer, player, addCameraShake };

// --- Initialize Loading Screen (replaces old spinner overlay) ---
if (CONFIG.safeMode) {
    console.warn('[Startup] safeMode active (?safe=1) — shader warmup and compute disabled');
    (window as any).__computeDisabled = true;
}

// Wait-for-full preference: URL param (?waitForFull) or localStorage key.
// URL param wins; localStorage persists the checkbox choice across sessions.
const WAIT_FULL_KEY = 'candy_waitForFull';
let waitForFullPopulation =
    new URLSearchParams(location.search).has('waitForFull') ||
    localStorage.getItem(WAIT_FULL_KEY) === '1';

const loadingScreen = initLoadingScreen({ theme: 'candy', showEstimatedTime: true });
loadingScreen.show();
installLegacyAPI();

// --- Top-level error boundary (Issue #1) ---
// Catch any unhandled promise rejections during startup and surface them to the
// loading screen so the user never sees a silent hang at 0%.
window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason;
    const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    console.error('[Bootstrap] Unhandled rejection during startup:', err);
    try {
        loadingScreen.showFatalError(
            `Startup failed: ${msg}\n\nRefresh the page to try again.`
        );
    } catch (_) {
        // Loading screen may not be initialized yet — surface in the DOM directly.
        // We attempt 'loading-overlay' first (the outermost wrapper defined in
        // index.html), then fall back to 'loading-container' (the inner card).
        // Use textContent to avoid XSS when inserting the error message.
        const fallback = document.getElementById('loading-overlay') ??
            document.getElementById('loading-container');
        if (fallback) {
            const p = document.createElement('p');
            p.style.cssText = 'color:red;padding:1rem';
            p.textContent = `Error: ${msg}`;
            const btn = document.createElement('button');
            btn.textContent = 'Reload';
            btn.addEventListener('click', () => window.location.reload());
            p.appendChild(document.createElement('br'));
            p.appendChild(btn);
            fallback.appendChild(p);
        }
    }
    // Don't suppress the event — let DevTools still see it
});

// --- Fix Issue #5: Loading screen race condition guard ---
// Tracks whether enterWorld() has started so warmupAndStartLoop() does not
// hide the loading screen while map-generation is in progress.
let _worldGenerationActive = false;

// --- Enable Startup Profiler ---

enableStartupProfiler({
    slowPhaseThreshold: 100,
    enableOverlay: false,
    enableConsole: true,
    saveToFile: true,
});

// --- Initialize Debug Panel (if ?debug=1) ---
initDebugPanel();
installBatcherTelemetry();

// --- Progressive pre-loop boot (core → wasm) ---
const timeOffset = { value: 0 };

const bootResult = await runPreLoopBootstrap(loadingScreen, timeOffset);
if (!bootResult) {
    throw new Error('Progressive boot halted before game loop could start');
}

scene = bootResult.scene;
camera = bootResult.camera;
renderer = bootResult.renderer;
const mode = bootResult.mode;
const postProcessing = bootResult.postProcessing;
const audioSystem = bootResult.audioSystem;
const beatSync = bootResult.beatSync;
const weatherSystem = bootResult.weatherSystem;
const moon = bootResult.moon;
const inputSystem = bootResult.inputSystem;
const controls = bootResult.controls;
let interactionSystem = bootResult.interactionSystem;
const {
    ambientLight,
    sunLight,
    sunGlow,
    sunCorona,
    lightShaftGroup,
    sunGlowMat,
    coronaMat,
    uShaftOpacity,
} = bootResult;

setCameraRef(camera);

// Set global game object so playwright tests can interact with camera, etc
(window as any).game = { camera, scene, animatedFoliage, interactiveObjects };
installWorldExportTools();

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
        } else if (key === 'o' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
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
            const handled = interactionSystem?.triggerClick?.() ?? false;

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
    await runBootStage('shaderWarmup', async () => {
        if (CONFIG.safeMode) {
            console.warn('[Startup] safeMode active — skipping shader warmup and compileAsync');
            return;
        }
        loadingScreen.startPhase('shader-warmup');
        loadingScreen.updateProgress(5, 'Pre-compiling shaders...');

        // Replace the monolithic compileAsync + forceFullSceneWarmup with a
        // time-budgeted batched approach so no single task exceeds ~100 ms.
        const BATCH_SIZE = 10;
        const BUDGET_MS = 100;
        let batchCount = 0;

        try {
            const warmup = new ShaderWarmup();
            const targets = warmup.getTargets();

            for (let i = 0; i < targets.length; i += BATCH_SIZE) {
                const batchStart = performance.now();
                const batch = targets.slice(i, i + BATCH_SIZE);

                for (const target of batch) {
                    const mat = target.create();
                    try {
                        await warmup.warmupSingle(mat, renderer, target.name);
                    } catch (_e) { /* skip non-critical failures */ }
                }

                batchCount++;
                const batchMs = performance.now() - batchStart;
                const pct = 5 + Math.round((i / targets.length) * 85);
                loadingScreen.updateProgress(pct, `Warming shaders (${i + batch.length}/${targets.length})...`);

                // Yield after every batch to stay within the long-task budget.
                if (batchMs > BUDGET_MS || i + batch.length < targets.length) {
                    await new Promise<void>(resolve => setTimeout(resolve, 0));
                }
            }
            warmup.dispose();
            console.log(`[Startup] Shaders pre-compiled in ${batchCount} batch(es)`);
        } catch (err) {
            console.warn('[Warmup] Shader compilation error (non-fatal):', err);
        }

        loadingScreen.updateProgress(90, 'Finalizing scene...');
        console.log('[Startup] Shaders pre-compiled');
        loadingScreen.updateProgress(100, 'Scene ready!');
        loadingScreen.completePhase('shader-warmup');
    });

    // Start game loop NOW — player can move immediately
    renderer.setAnimationLoop(animate);
    try { (window as any).__sceneReady = true; } catch (e) { }

    // Issue #5: Only hide the initial loading screen if world generation has not
    // yet started. If the user clicked "Start" during shader warmup, enterWorld()
    // will have set _worldGenerationActive = true and is managing the screen itself.
    if (!_worldGenerationActive) {
        loadingScreen.hide();
    }
})();

// --- START BUTTON + MAP GENERATION (unchanged UX) ---
const startButton = document.getElementById('startButton') as HTMLButtonElement | null;

if (startButton) {
    startButton.disabled = false;
    startButton.setAttribute('aria-disabled', 'false');
    startButton.setAttribute('aria-busy', 'false');
    startButton.removeAttribute('title');
    startButton.innerHTML = 'Enter the Dream <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>';

    // ♿ Aria: Announce to screen readers that the world is ready
    import('../ui/announcer.ts').then(({ announce }) => {
        announce('World loaded. Press Enter to enter the world.', 'assertive');
    }).catch(err => console.warn('Failed to load announcer:', err));

    // Three-state startup mode: CORE (fastest), FULL (complete), FAST_FULL (full map but heavily reduced population for quicker loads)
    let coreOnlyMode = true;
    let fastFullMode = false;

    const btnCoreOnly = document.getElementById('btn-core-only') as HTMLButtonElement | null;
    const btnFullGame = document.getElementById('btn-full-game') as HTMLButtonElement | null;
    const btnFastFull = document.getElementById('btn-fast-full') as HTMLButtonElement | null;
    const modeSelect = document.getElementById('mode-select');
    const modeDescription = document.getElementById('mode-description');

    const updateStartupMode = (mode: 'CORE' | 'FULL' | 'FAST_FULL') => {
        coreOnlyMode = mode === 'CORE';
        fastFullMode = mode === 'FAST_FULL';

        console.log(`[Startup] Mode selected: ${mode}`);

        const isCore = mode === 'CORE';
        const isFast = mode === 'FAST_FULL';

        if (btnCoreOnly) {
            btnCoreOnly.setAttribute('aria-pressed', String(isCore));
        }
        if (btnFullGame) {
            btnFullGame.setAttribute('aria-pressed', String(mode === 'FULL'));
        }
        if (btnFastFull) {
            btnFastFull.setAttribute('aria-pressed', String(isFast));
        }

        if (modeDescription) {
            modeDescription.textContent = isCore
                ? 'Fast startup with classic candy terrain, trees, mushrooms, and clouds.'
                : isFast
                    ? 'Full musical map with greatly reduced object count for much faster loading.'
                    : 'Full game with the complete musical foliage map.';
        }

        startButton.innerHTML = isCore
            ? 'Enter the Dream <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>'
            : isFast
                ? 'Enter Fast Dream <span aria-hidden="true">🌿</span> <span class="key-badge" aria-hidden="true">Enter</span>'
                : 'Enter Full Dream <span aria-hidden="true">🌸</span> <span class="key-badge" aria-hidden="true">Enter</span>';
    };

    const getGenerationLabel = (mode: WorldMode) => {
        if (mode === 'CORE') return 'Generating core world...';
        return fastFullMode ? 'Generating light full world (reduced objects)...' : 'Generating world map...';
    };

    updateStartupMode('CORE');

    if (btnCoreOnly && btnFullGame && btnFastFull) {
        btnCoreOnly.addEventListener('click', () => updateStartupMode('CORE'));
        btnFullGame.addEventListener('click', () => updateStartupMode('FULL'));
        btnFastFull.addEventListener('click', () => updateStartupMode('FAST_FULL'));
    }

    // Wire the wait-for-full checkbox
    const waitFullCheckbox = document.getElementById('wait-full-checkbox') as HTMLInputElement | null;
    if (waitFullCheckbox) {
        waitFullCheckbox.checked = waitForFullPopulation;
        waitFullCheckbox.addEventListener('change', () => {
            waitForFullPopulation = waitFullCheckbox.checked;
            localStorage.setItem(WAIT_FULL_KEY, waitForFullPopulation ? '1' : '0');

            // ♿ Aria: Announce the toggle change explicitly for screen readers
            import('../ui/announcer.ts').then(({ announce }) => {
                announce(`Scenery wait mode ${waitForFullPopulation ? 'enabled - world will fully load before entry' : 'disabled'}`, 'polite');
            });
        });
    }

    let worldGenerated = false;
    let isGenerating = false;

    function yieldFrame(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 50));
    }

    async function enterWorld() {
        if (isGenerating || !startButton || worldGenerated) return;

        isGenerating = true;
        // Issue #5: Signal to warmupAndStartLoop that world generation is active.
        // This prevents the shader-warmup IIFE from hiding the loading screen
        // while map generation is in progress.
        _worldGenerationActive = true;
        console.log('[Startup] Entering world...');

        // Immediate UI feedback
        startButton.disabled = true;
        startButton.setAttribute('aria-disabled', 'true');
        startButton.setAttribute('aria-busy', 'true');
        startButton.setAttribute('title', 'Generating world...');
        startButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>Generating... <span aria-hidden="true">🍭</span>';

        await yieldFrame(); // Let the spinner paint
        const requestedMode: WorldMode = coreOnlyMode ? 'CORE' : 'FULL';
        const useFastPopulation = fastFullMode;   // "Fast Full" = Full map but with aggressive population reduction
        let activeWorldMode: WorldMode = requestedMode;

        const worldGenResult = await runBootStage('worldGeneration', async () => {
            // Clean up preview mushroom if it exists (from optimize branch)
            // Note: previewMushroom is defined in previous world generation runs
            const previewMushroom = (window as any).previewMushroom;
            if (typeof previewMushroom !== 'undefined' && previewMushroom) {
                scene.remove(previewMushroom);
                if (previewMushroom.geometry) previewMushroom.geometry.dispose();
                if (previewMushroom.material) {
                    if (Array.isArray(previewMushroom.material)) {
                        previewMushroom.material.forEach((m: any) => m.dispose());
                    } else {
                        previewMushroom.material.dispose();
                    }
                }
                previewMushroom.traverse((child: any) => {
                    const mesh = child as THREE.Mesh;
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) {
                            mesh.material.forEach((m: any) => m.dispose());
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

            console.log(`[Startup] Enter world requested in ${requestedMode} mode`);

            if (modeSelect) {
                modeSelect.style.display = 'none';
            }
            showModeBadge(requestedMode);

            loadingScreen.show();
            loadingScreen.startPhase('map-generation');
            loadingScreen.updateProgress(0, getGenerationLabel(requestedMode));
            resetSpawnTracker(); // fresh counts for this population attempt

            let lastAnnounced = -1;
            startPhase('Map Generation');

            activeWorldMode = await populateWorld(scene, weatherSystem!, requestedMode, (current: number, total: number, label?: string, entityType?: string) => {
                const percent = Math.floor((current / total) * 100);
                const baseLabel = label ?? getGenerationLabel(requestedMode);
                const progressLabel = entityType ? `${baseLabel} · ${entityType}` : baseLabel;
                loadingScreen.updateProgress(percent, progressLabel);
                startButton.style.background = requestedMode === 'CORE'
                    ? `linear-gradient(90deg, #FF9ECD ${percent}%, #FFD4E3 ${percent}%)`
                    : `linear-gradient(90deg, #FF6B6B ${percent}%, #FFB6C1 ${percent}%)`;

                if (percent - lastAnnounced >= 10 || percent === 100) {
                    startButton.innerHTML = `<span class="spinner" aria-hidden="true"></span>Generating ${percent}%... <span aria-hidden="true">${requestedMode === 'CORE' ? '🍭' : '🍭'}</span>`;
                    lastAnnounced = percent;
                }
            }, useFastPopulation ? { fastPopulation: true } : undefined);

            if (activeWorldMode !== requestedMode) {
                console.warn(`[Startup] Full mode fallback engaged: booted in ${activeWorldMode} mode instead of ${requestedMode}`);
                showModeBadge(activeWorldMode);
            }

            endPhase('Map Generation');

            // Clean up the temporary fast population override
            delete (window as any).__fastPopulationOverride;

            // ⚡ Critical: Populate physics grids right after map generation
            populatePhysicsGrids();

            loadingScreen.updateProgress(100, 'World generation complete!');
            loadingScreen.completePhase('map-generation');
            loadingScreen.hide();

            // ♿ Aria: Announce that the game is fully loaded and exploration has started
            import('../ui/announcer.ts').then(({ announce }) => {
                announce('World generated. Welcome to Candy World.', 'assertive');
            });
        });

        if (!worldGenResult.success) {
            throw new Error(worldGenResult.error || 'World generation failed');
        }

        try {
            const instructions = document.getElementById('instructions');
            if (instructions) instructions.style.display = 'none';

            import('../utils/toast.ts').then(({ showToast }) => {
                showToast("Click to explore! Press [ESC] for Controls", "🎮", 4000);
            });

            // Start background processor for deferred work.
            // resetCounters() syncs totalTasks to the queue length (which already
            // contains horizon tasks from generateMap) and clears stale callbacks
            // so start() isn't blocked by isRunning=true.
            globalBackgroundProcessor.resetCounters();

            // In waitForFull mode, keep the main loading screen up as a 'deferred-population'
            // phase. Mark it non-skippable so users see the full progress.
            if (waitForFullPopulation) {
                if (!globalLoadingManager.getTask('deferred-population')) {
                    globalLoadingManager.registerTask({
                        id: 'deferred-population',
                        name: 'World Population',
                        weight: 0.2,
                        description: 'Populating horizon...',
                        isDeferred: true,
                    });
                }
                loadingScreen.markPhaseNonSkippable('deferred-population');
                loadingScreen.startPhase('deferred-population');
            } else {
                showDeferredIndicator();
            }

            globalBackgroundProcessor.onProgress((completed, total) => {
                const failedSoFar = globalBackgroundProcessor.getFailedCount();
                const etaMs = globalBackgroundProcessor.getEstimatedTimeRemainingMs();
                globalLoadingManager.reportDeferredProgress(completed, total, failedSoFar, etaMs);
            });

            globalBackgroundProcessor.onComplete((completed, total, bgFailed) => {
                if (waitForFullPopulation) {
                    globalLoadingManager.reportDeferredProgress(completed, total, bgFailed);
                    globalLoadingManager.completeTask('deferred-population');
                    loadingScreen.completePhase('deferred-population');
                } else {
                    hideDeferredIndicator();
                }

                populatePhysicsGrids();
                finalizeStartupProfile();
                console.log('[Startup] All deferred background tasks completed.');

                // Surface spawn report
                try {
                    const r = getSpawnReport();
                    const report = { ...r, backgroundFailed: bgFailed };
                    (window as any).__worldPopulationReport = report;
                    if (r.failed > 0) {
                        console.warn(`[Startup] Population complete with ${r.failed} spawn failures out of ${r.attempted}. See spawn tracker report.`);
                        if (!waitForFullPopulation) {
                            // Badge already visible; toast as last-resort hint if missed
                            import('../utils/toast.ts').then(({ showToast }) => {
                                showToast(`Some objects failed to load (${r.failed}). Click the ⚠ badge or check console.`, '⚠️', 5000);
                            }).catch(() => {});
                        }
                    } else if (r.attempted > 0) {
                        console.log(`[Startup] Population complete: ${r.succeeded}/${r.attempted} objects spawned cleanly.`);
                    }
                } catch {}

                document.dispatchEvent(new CustomEvent('worldFullyPopulated'));

                // === Visual Regression Readiness Signal ===
                if (typeof window !== 'undefined') {
                    if (!window.__visualRegression) {
                        window.__visualRegression = {
                            ready: false,
                            stableFrames: 0,
                            frameCount: 0,
                            isHeadless: false
                        };
                    }
                    window.__visualRegression.ready = true;
                    window.__visualRegression.isHeadless =
                        /headless/i.test(navigator.userAgent) ||
                        !!navigator.webdriver;
                    console.log('[VisualRegression] Scene ready signal set');
                }

                // Run world health validation and surface any warnings.
                try {
                    const health = validateWorldPopulation(activeWorldMode ?? 'UNKNOWN');
                    if (!health.healthy) {
                        import('../utils/toast.ts').then(({ showToast }) => {
                            const summary = health.warnings.length === 1
                                ? health.warnings[0]
                                : `${health.warnings.length} world health warnings — see console`;
                            showToast(summary, '⚠️', 7000);
                        }).catch(() => {});
                    }
                } catch (e) {
                    console.warn('[WorldHealth] Validation threw:', e);
                }
            });

            // Queue non-critical visuals
            globalBackgroundProcessor.enqueue({
                id: 'deferred_visuals',
                priority: 100,
                execute: () => {
                    runBootStage('deferredVisuals', () => {
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
                priority: 90,
                execute: () => {
                    runDeferredWarmup(scene, camera, renderer);
                }
            });

            globalBackgroundProcessor.start();

            worldGenerated = true;
            startButton.style.background = '';
            const wasFast = !!(window as any).__fastPopulationOverride || fastFullMode;
            if (activeWorldMode === 'CORE') {
                startButton.innerHTML = 'Regenerate Core Dream <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>';
            } else if (wasFast) {
                startButton.innerHTML = 'Regenerate Fast Dream <span aria-hidden="true">🌿</span> <span class="key-badge" aria-hidden="true">Enter</span>';
            } else {
                startButton.innerHTML = 'Regenerate Full Dream <span aria-hidden="true">🌸</span> <span class="key-badge" aria-hidden="true">Enter</span>';
            }

        } catch (err) {
            console.error('[Init] World generation failed:', err);
            loadingScreen.hide();
            startButton.style.background = '';
            startButton.innerHTML = 'Retry';
            import('../ui/announcer.ts').then(({ announce }) => {
                announce('World generation failed. Please try again.', 'assertive');
            });
        } finally {
            _worldGenerationActive = false;
            isGenerating = false;
            startButton.disabled = false;
            startButton.setAttribute('aria-disabled', 'false');
            startButton.setAttribute('aria-busy', 'false');
            startButton.removeAttribute('title');

            // ♿ Aria: Announce if they somehow return back or if it completes
            import('../ui/announcer.ts').then(({ announce }) => {
                announce('World loaded. Press Enter to enter the world.', 'assertive');
            }).catch(err => console.warn('Failed to load announcer:', err));
        }
    }

    // Regenerate support
    startButton.addEventListener('click', () => {
        if (!isGenerating) {
            enterWorld();
        }
    });
}

// --- DEFERRED WORLD CONTENT (non-blocking, after loop is running) ---
function startDeferredWorldLoading() {
    runBootStage('deferredWorld', async () => {
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
