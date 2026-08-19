import { StageLoader } from '../../debug/index.ts';
import { initFaunaDebug } from '../../debug/tools-stub.ts';
import { isWebGLLiteMode } from '../../rendering/webgl-debug.ts';
import { initFaunaSystem } from '../../systems/fauna/index.ts';
import { globalLoadingManager } from '../../systems/loading-manager.ts';
import { initPresenceFromOptIn } from '../../systems/net/lazy.ts';
import { populatePhysicsGrids } from '../../systems/physics/index.ts';
import { announce } from '../../ui/announcer.ts';
import {
    showDeferredIndicator,
    hideDeferredIndicator,
    setDeferredProgress,
    setDeferredFailures,
} from '../../ui/loading-screen.ts';
import { showModeBadge } from '../../ui/mode-badge-lazy.ts';
import {
    installReadinessProgress,
    showReadinessGenerating,
    markReadinessPlayable,
    markReadinessReady,
    reportReadinessProgress,
} from '../../ui/readiness-progress.ts';
import { globalBackgroundProcessor } from '../../utils/background-processor.ts';
import { safeRemoveAndDispose } from '../../utils/dispose-utils.ts';
import { trapFocusInside } from '../../utils/interaction-utils.ts';
import { finalizeStartupProfile, startPhase, endPhase } from '../../utils/startup-profiler.ts';
import { showToast } from '../../utils/toast.ts';
import { initCloudPlacer } from '../../world/cloud-placer-lazy.ts';
import { populateWorld } from '../../world/generation.ts';
import type { WorldMode } from '../../world/generation-utils.ts';
import { initSkyIslandDebug, rebuildSkyIslandDebug } from '../../world/sky-island-graph.ts';
import { spawnTracker } from '../../world/spawn-tracker.ts';
import {
    reset as resetSpawnTracker,
    getReport as getSpawnReport,
} from '../../world/spawn-tracker.ts';
import { animatedFoliage, interactiveObjects } from '../../world/state.ts';
import {
    applyAwakenedPersistenceAfterWorldLoad,
    initDeferredVisuals,
    runDeferredWarmup,
} from '../deferred-init.ts';
import {
    loadStartupProfile,
    setStartupPath,
    isBootInstant,
    profileDescription,
    enterButtonLabel,
    profileLoadHint,
    type StartupPath,
    type StartupProfile,
} from '../startup-profile.ts';
import type { MainContext } from './context.ts';
import { camera, renderer, scene } from './exports.ts';

function yieldFrame(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
}

function whenSceneReady(): Promise<void> {
    try {
        if ((window as any).__sceneReady === true) return Promise.resolve();
    } catch {
        /* ignore */
    }
    return new Promise((resolve) => {
        const started = performance.now();
        const tick = () => {
            try {
                if ((window as any).__sceneReady === true || performance.now() - started > 30000) {
                    resolve();
                    return;
                }
            } catch {
                resolve();
                return;
            }
            setTimeout(tick, 50);
        };
        tick();
    });
}

function pathToWorldMode(path: StartupPath): WorldMode {
    return path === 'core' ? 'CORE' : 'FULL';
}

function pathEmoji(path: StartupPath): string {
    return path === 'explore' ? '🌸' : '🍭';
}

export function setupStartScreen(ctx: MainContext): void {
    const { loadingScreen } = ctx;
    const startButton = document.getElementById('startButton') as HTMLButtonElement | null;
    const statusEl = document.getElementById('world-status');

    if (!startButton) return;

    installReadinessProgress();

    startButton.disabled = false;
    startButton.setAttribute('aria-disabled', 'false');
    startButton.removeAttribute('aria-busy');
    startButton.removeAttribute('title');

    loadingScreen.onComplete(() => {
        if (!startButton.disabled) {
            startButton.focus();
        }

        const instructions = document.getElementById('instructions');
        if (instructions && instructions.style.display !== 'none' && ctx.inputSystem && ctx.inputSystem.session) {
            if (!ctx.inputSystem.session.focus.releasePauseMenuFocus) {
                ctx.inputSystem.session.focus.releasePauseMenuFocus = trapFocusInside(instructions, { skipAutoFocus: true });
            }
        }
    });

    announce('World loaded. Press Enter to enter the world.', 'assertive');

    let profile: StartupProfile = loadStartupProfile();
    
    const modeDescription = document.getElementById('mode-description');
    const fullWorldToggle = document.getElementById('toggleFullWorld') as HTMLButtonElement | null;

    const syncProfileUi = () => {
        
        if (fullWorldToggle) {
            const explore = profile.path === 'explore';
            fullWorldToggle.setAttribute('aria-checked', String(explore));
        }

        if (modeDescription) {
            modeDescription.textContent = profileDescription(profile);
        }

        startButton.innerHTML = `${enterButtonLabel(profile.path)} <span aria-hidden="true">${pathEmoji(profile.path)}</span> <span class="key-badge" aria-hidden="true">Enter</span>`;

        console.log(
            `[Startup] Profile: path=${profile.path} graphics=${profile.graphics} (${profileLoadHint(profile)})`
        );
    };

    const applyPath = (path: StartupPath) => {
        // Keep the in-memory session path even when URL would re-force it on load.
        profile = { ...profile, path };
        if (path === 'play' || path === 'explore') {
            setStartupPath(path);
        }
        (window as any).__startupProfile = profile;
        syncProfileUi();
    };

    if (fullWorldToggle) {
        fullWorldToggle.addEventListener('click', () => {
            const next = profile.path === 'explore' ? 'play' : 'explore';
            applyPath(next);
        });
        fullWorldToggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fullWorldToggle.click();
            }
        });
    }

    (window as any).__startupProfile = profile;
    syncProfileUi();

    if (ctx.mode === 'webgl' && isWebGLLiteMode()) {
        console.warn('[Startup] WebGL lite mode — Play path (spawn chunk) recommended');
    }

    let worldGenerated = false;
    let isGenerating = false;

    const getGenerationLabel = (path: StartupPath) => {
        if (path === 'core') return 'Generating core world...';
        if (path === 'explore') return 'Generating full world (nearby + streaming)...';
        return 'Generating spawn area...';
    };

    async function enterWorld() {
        if (isGenerating || !startButton || worldGenerated) return;

        profile = { ...profile, graphics: loadStartupProfile().graphics };
        syncProfileUi();

        isGenerating = true;
        ctx.worldGenerationActive = true;
        console.log('[Startup] Entering world...', profile);

        startButton.disabled = true;
        startButton.setAttribute('aria-busy', 'true');
        startButton.setAttribute('aria-disabled', 'true');
        startButton.setAttribute('title', 'Generating world...');
        startButton.innerHTML =
            '<span class="spinner" aria-hidden="true"></span>Generating... <span aria-hidden="true">🍭</span>';

        showReadinessGenerating(profileLoadHint(profile));

        await yieldFrame();
        const requestedMode: WorldMode = pathToWorldMode(profile.path);
                const bootPath = profile.path === 'explore' ? ('explore' as const) : ('play' as const);

        let activeWorldMode: WorldMode = requestedMode;

        const worldGenResult = await StageLoader.loadStage('worldGeneration', async () => {
            const previewMushroom = (window as any).previewMushroom;
            if (typeof previewMushroom !== 'undefined' && previewMushroom) {
                safeRemoveAndDispose(scene, previewMushroom);
                const idx = animatedFoliage.indexOf(previewMushroom);
                if (idx > -1) animatedFoliage.splice(idx, 1);
                const intIdx = interactiveObjects.indexOf(previewMushroom);
                if (intIdx > -1) interactiveObjects.splice(intIdx, 1);
            }

            console.log(
                `[Startup] Enter world: graphics=${profile.graphics} path=${profile.path} → ${requestedMode}` +
                    (profile.path !== 'core' ? ` (bootPath=${bootPath})` : '') +
                    ''
            );

            if (fullWorldToggle) fullWorldToggle.style.display = 'none';
            if (modeDescription) modeDescription.style.display = 'none';
            showModeBadge(requestedMode, profile);

            loadingScreen.show();
            loadingScreen.startPhase('map-generation');
            loadingScreen.updateProgress(0, getGenerationLabel(profile.path));
            resetSpawnTracker();

            let lastAnnounced = -1;
            startPhase('Map Generation');

            activeWorldMode = await populateWorld(
                scene,
                ctx.weatherSystem!,
                requestedMode,
                (current: number, total: number, label?: string, entityType?: string) => {
                    const percent = Math.floor((current / total) * 100);
                    const baseLabel = label ?? getGenerationLabel(profile.path);
                    const progressLabel = entityType ? `${baseLabel} · ${entityType}` : baseLabel;
                    loadingScreen.updateProgress(percent, progressLabel);
                    reportReadinessProgress(percent, progressLabel);

                    if (statusEl) {
                        statusEl.textContent = progressLabel;
                    }

                    const accent = profile.path === 'explore' ? '#A5D6A7' : '#FF9ECD';
                    const soft = profile.path === 'explore' ? '#C8E6C9' : '#FFD4E3';
                    startButton.style.background = `linear-gradient(90deg, ${accent} ${percent}%, ${soft} ${percent}%)`;

                    if (percent - lastAnnounced >= 10 || percent === 100) {
                        startButton.innerHTML = `<span class="spinner" aria-hidden="true"></span>Generating ${percent}%... <span aria-hidden="true">🍭</span>`;
                        lastAnnounced = percent;
                    }
                },
                requestedMode === 'FULL' ? { bootPath } : undefined
            );

            if (activeWorldMode !== requestedMode) {
                console.warn(
                    `[Startup] Map fallback: booted in ${activeWorldMode} instead of ${requestedMode}`
                );
                showModeBadge(activeWorldMode, profile);
            }

            endPhase('Map Generation');

            delete (window as any).__fastPopulationOverride;

            populatePhysicsGrids();

            initFaunaSystem();
            initFaunaDebug(scene);

            initCloudPlacer({ scene, camera, weatherSystem: ctx.weatherSystem ?? null });

            try {
                initSkyIslandDebug(scene);
                rebuildSkyIslandDebug();
            } catch (e) {
                console.warn('[Startup] Sky island debug init skipped:', e);
            }

            applyAwakenedPersistenceAfterWorldLoad();

            initPresenceFromOptIn(scene, camera, renderer);

            loadingScreen.updateProgress(100, 'World generation complete!');
            loadingScreen.completePhase('map-generation');
            loadingScreen.hide();

            if (statusEl) {
                statusEl.textContent = 'World generated. Welcome to Candy World.';
            }

            announce('World generated. Welcome to Candy World.', 'assertive');
        });

        if (!worldGenResult.success) {
            throw new Error(worldGenResult.error || 'World generation failed');
        }

        try {
            if (ctx.inputSystem && ctx.inputSystem.session && ctx.inputSystem.session.focus.releasePauseMenuFocus) {
                ctx.inputSystem.session.focus.releasePauseMenuFocus();
                ctx.inputSystem.session.focus.releasePauseMenuFocus = null;
            }

            const instructions = document.getElementById('instructions');
            if (instructions) {
                instructions.style.display = 'none';
                window.dispatchEvent(new CustomEvent('candy:start-screen-hidden'));
            }

            showToast('Click to explore! Press [ESC] for Controls', '🎮', 4000);

            markReadinessPlayable();

            showDeferredIndicator();
            setDeferredFailures(0);
            globalBackgroundProcessor.onProgress((completed, total) => {
                setDeferredProgress(completed, total);
                setDeferredFailures(spawnTracker.getReport().failCount);
            });
            globalBackgroundProcessor.resetCounters();
            showDeferredIndicator();

            globalBackgroundProcessor.onProgress((completed, total) => {
                const failedSoFar = globalBackgroundProcessor.getFailedCount();
                const etaMs = globalBackgroundProcessor.getEstimatedTimeRemainingMs();
                globalLoadingManager.reportDeferredProgress(completed, total, failedSoFar, etaMs);
            });

            globalBackgroundProcessor.onComplete((completed, total, bgFailed) => {
                hideDeferredIndicator();

                populatePhysicsGrids();
                finalizeStartupProfile();
                console.log('[Startup] All deferred background tasks completed.');
                markReadinessReady();

                try {
                    const r = getSpawnReport();
                    const report = { ...r, backgroundFailed: bgFailed };
                    (window as any).__worldPopulationReport = report;
                    if (r.failed > 0) {
                        console.warn(
                            `[Startup] Population complete with ${r.failed} spawn failures out of ${r.attempted}. See spawn tracker report.`
                        );
                        showToast(
                                `Some objects failed to load (${r.failed}). Click the ⚠ badge or check console.`,
                                '⚠️',
                                5000
                            );
                    } else if (r.attempted > 0) {
                        console.log(
                            `[Startup] Population complete: ${r.succeeded}/${r.attempted} objects spawned cleanly.`
                        );
                    }
                } catch {
                    void 0;
                }

                document.dispatchEvent(new CustomEvent('worldFullyPopulated'));

                try {
                    void import('../../world/world-health.ts').then(
                        ({ validateWorldPopulation }) => {
                            const health = validateWorldPopulation(activeWorldMode ?? 'UNKNOWN');
                            if (!health.healthy) {
                                const summary =
                                    health.warnings.length === 1
                                        ? health.warnings[0]
                                        : `${health.warnings.length} world health warnings — see console`;
                                showToast(summary, '⚠️', 7000);
                            }
                        }
                    );
                } catch (e) {
                    console.warn('[WorldHealth] Validation threw:', e);
                }
            });

            globalBackgroundProcessor.enqueue({
                id: 'deferred_visuals',
                priority: 100,
                execute: () => {
                    StageLoader.loadStage('deferredVisuals', () => {
                        console.log('[Deferred] Loading celestial bodies and aurora...');
                        startPhase('Deferred Visuals Init');
                        initDeferredVisuals();
                        endPhase('Deferred Visuals Init');
                    });
                },
            });

            globalBackgroundProcessor.enqueue({
                id: 'shader_warmup',
                priority: 90,
                execute: () => {
                    runDeferredWarmup(scene, camera, renderer);
                },
            });

            await globalBackgroundProcessor.start();

            worldGenerated = true;
            startButton.style.background = '';
            startButton.innerHTML = `${enterButtonLabel(profile.path, true)} <span aria-hidden="true">${pathEmoji(profile.path)}</span> <span class="key-badge" aria-hidden="true">Enter</span>`;
        } catch (err) {
            console.error('[Init] World generation failed:', err);
            loadingScreen.hide();
            startButton.style.background = '';
            startButton.innerHTML = 'Retry';
            if (fullWorldToggle) fullWorldToggle.style.display = '';
            if (modeDescription) modeDescription.style.display = '';
            announce('World generation failed. Please try again.', 'assertive');
        } finally {
            ctx.worldGenerationActive = false;
            isGenerating = false;
            startButton.disabled = false;
            startButton.setAttribute('aria-disabled', 'false');
            startButton.removeAttribute('aria-busy');
            startButton.removeAttribute('title');

            announce('World loaded. Press Enter to enter the world.', 'assertive');
        }
    }

    startButton.addEventListener('click', () => {
        if (!isGenerating) {
            void enterWorld();
        }
    });

    if (isBootInstant()) {
        try {
            (window as any).__bootInstant = true;
        } catch {
            /* ignore */
        }
        console.log('[Startup] ?boot=instant — auto-entering Play path after scene ready');
        void whenSceneReady().then(() => {
            if (!isGenerating && !worldGenerated) void enterWorld();
        });
    }
}
