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
import { finalizeStartupProfile, startPhase, endPhase } from '../../utils/startup-profiler.ts';
import { showToast } from '../../utils/toast.ts';
import { initCloudPlacer } from '../../world/cloud-placer-lazy.ts';
import { populateWorld, WorldMode } from '../../world/generation.ts';
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
    saveStartupProfile,
    setGraphicsLevel,
    setMapSize,
    mapSizeToWorldMode,
    mapSizeUsesFastPopulation,
    mapSizeWaitsForFullPopulation,
    profileDescription,
    enterButtonLabel,
    profileLoadHint,
    type GraphicsLevel,
    type MapSize,
    type StartupProfile,
} from '../startup-profile.ts';
import type { MainContext } from './context.ts';
import { camera, renderer, scene } from './exports.ts';

function yieldFrame(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
}

function setupRadiogroup<T extends string>(
    buttons: Array<{ btn: HTMLButtonElement; value: T }>,
    getSelected: () => T,
    onSelect: (value: T) => void
): void {
    const setupButton = (btn: HTMLButtonElement, value: T, index: number) => {
        btn.addEventListener('click', async () => {
            btn.setAttribute('aria-busy', 'true');
            btn.setAttribute('aria-disabled', 'true');
            try {
                onSelect(value);
                await yieldFrame();
            } finally {
                btn.removeAttribute('aria-busy');
                btn.removeAttribute('aria-disabled');
            }
        });

        btn.addEventListener('keydown', (e) => {
            let nextIndex = -1;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                nextIndex = (index + 1) % buttons.length;
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                nextIndex = (index - 1 + buttons.length) % buttons.length;
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                btn.classList.add('keyboard-active');
            }

            if (nextIndex !== -1) {
                e.preventDefault();
                const nextBtn = buttons[nextIndex].btn;
                nextBtn.focus();
                nextBtn.click();
            }
        });

        btn.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                btn.classList.remove('keyboard-active');
            }
        });

        btn.addEventListener('blur', () => {
            btn.classList.remove('keyboard-active');
        });

        btn.addEventListener('focus', () => {
            buttons.forEach((mb) => mb.btn.setAttribute('tabindex', '-1'));
            btn.setAttribute('tabindex', '0');
            if (btn.getAttribute('aria-checked') !== 'true') {
                btn.click();
            }
        });
    };

    buttons.forEach((mb, index) => {
        mb.btn.setAttribute('tabindex', getSelected() === mb.value ? '0' : '-1');
        setupButton(mb.btn, mb.value, index);
    });
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

    announce('World loaded. Press Enter to enter the world.', 'assertive');

    let profile: StartupProfile = loadStartupProfile();
    ctx.waitForFullPopulation = mapSizeWaitsForFullPopulation(profile.mapSize);

    const modeSelect = document.getElementById('mode-select');
    const modeDescription = document.getElementById('mode-description');

    const gfxButtons: Array<{ btn: HTMLButtonElement; value: GraphicsLevel }> = [
        { btn: document.getElementById('btn-gfx-low') as HTMLButtonElement, value: 'low' as GraphicsLevel },
        { btn: document.getElementById('btn-gfx-medium') as HTMLButtonElement, value: 'medium' as GraphicsLevel },
        { btn: document.getElementById('btn-gfx-high') as HTMLButtonElement, value: 'high' as GraphicsLevel },
    ].filter((b) => b.btn);

    const mapButtons: Array<{ btn: HTMLButtonElement; value: MapSize }> = [
        { btn: document.getElementById('btn-map-small') as HTMLButtonElement, value: 'small' as MapSize },
        { btn: document.getElementById('btn-map-medium') as HTMLButtonElement, value: 'medium' as MapSize },
        { btn: document.getElementById('btn-map-large') as HTMLButtonElement, value: 'large' as MapSize },
    ].filter((b) => b.btn);

    const syncProfileUi = () => {
        for (const { btn, value } of gfxButtons) {
            const checked = value === profile.graphics;
            btn.setAttribute('aria-checked', String(checked));
            btn.setAttribute('tabindex', checked ? '0' : '-1');
        }
        for (const { btn, value } of mapButtons) {
            const checked = value === profile.mapSize;
            btn.setAttribute('aria-checked', String(checked));
            btn.setAttribute('tabindex', checked ? '0' : '-1');
        }

        ctx.waitForFullPopulation = mapSizeWaitsForFullPopulation(profile.mapSize);

        if (modeDescription) {
            modeDescription.textContent = profileDescription(profile);
        }

        const emoji =
            profile.mapSize === 'small' ? '🍭' : profile.mapSize === 'medium' ? '🌿' : '🌸';
        startButton.innerHTML = `${enterButtonLabel(profile.mapSize)} <span aria-hidden="true">${emoji}</span> <span class="key-badge" aria-hidden="true">Enter</span>`;

        console.log(
            `[Startup] Profile: graphics=${profile.graphics} map=${profile.mapSize} (${profileLoadHint(profile)})`
        );
    };

    const applyGraphics = (graphics: GraphicsLevel) => {
        profile = setGraphicsLevel(graphics);
        // Expose for Phase 3 (shader/ambient gating) and debug
        (window as any).__startupProfile = profile;
        syncProfileUi();
    };

    const applyMapSize = (mapSize: MapSize) => {
        profile = setMapSize(mapSize);
        (window as any).__startupProfile = profile;
        syncProfileUi();
    };

    if (gfxButtons.length === 3) {
        setupRadiogroup(gfxButtons, () => profile.graphics, applyGraphics);
    }
    if (mapButtons.length === 3) {
        setupRadiogroup(mapButtons, () => profile.mapSize, applyMapSize);
    }

    saveStartupProfile(profile);
    (window as any).__startupProfile = profile;
    syncProfileUi();

    if (ctx.mode === 'webgl' && isWebGLLiteMode()) {
        console.warn('[Startup] WebGL lite mode — Small map recommended');
    }

    let worldGenerated = false;
    let isGenerating = false;

    const getGenerationLabel = (worldMode: WorldMode) => {
        if (worldMode === 'CORE') return 'Generating small world...';
        if (profile.mapSize === 'medium') return 'Generating medium map (nearby + streaming)...';
        return 'Generating large map...';
    };

    async function enterWorld() {
        if (isGenerating || !startButton || worldGenerated) return;

        // Re-read in case URL/storage changed
        profile = loadStartupProfile();
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
        const requestedMode: WorldMode = mapSizeToWorldMode(profile.mapSize);
        const useFastPopulation = mapSizeUsesFastPopulation(profile.mapSize);
        const waitForFullPopulation = mapSizeWaitsForFullPopulation(profile.mapSize);
        ctx.waitForFullPopulation = waitForFullPopulation;

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
                `[Startup] Enter world: graphics=${profile.graphics} map=${profile.mapSize} → ${requestedMode}` +
                    (useFastPopulation ? ' (fast population)' : '') +
                    (waitForFullPopulation ? ' (wait for full)' : '')
            );

            if (modeSelect) {
                modeSelect.querySelectorAll('.profile-row').forEach((el) => {
                    (el as HTMLElement).style.display = 'none';
                });
                if (modeDescription) modeDescription.style.display = 'none';
            }
            showModeBadge(requestedMode, profile);

            loadingScreen.show();
            loadingScreen.startPhase('map-generation');
            loadingScreen.updateProgress(0, getGenerationLabel(requestedMode));
            resetSpawnTracker();

            let lastAnnounced = -1;
            startPhase('Map Generation');

            activeWorldMode = await populateWorld(
                scene,
                ctx.weatherSystem!,
                requestedMode,
                (current: number, total: number, label?: string, entityType?: string) => {
                    const percent = Math.floor((current / total) * 100);
                    const baseLabel = label ?? getGenerationLabel(requestedMode);
                    const progressLabel = entityType ? `${baseLabel} · ${entityType}` : baseLabel;
                    loadingScreen.updateProgress(percent, progressLabel);
                    reportReadinessProgress(percent, progressLabel);

                    if (statusEl) {
                        statusEl.textContent = progressLabel;
                    }

                    const accent =
                        profile.mapSize === 'small'
                            ? '#FF9ECD'
                            : profile.mapSize === 'medium'
                              ? '#A5D6A7'
                              : '#FF6B6B';
                    const soft =
                        profile.mapSize === 'small'
                            ? '#FFD4E3'
                            : profile.mapSize === 'medium'
                              ? '#C8E6C9'
                              : '#FFB6C1';
                    startButton.style.background = `linear-gradient(90deg, ${accent} ${percent}%, ${soft} ${percent}%)`;

                    if (percent - lastAnnounced >= 10 || percent === 100) {
                        startButton.innerHTML = `<span class="spinner" aria-hidden="true"></span>Generating ${percent}%... <span aria-hidden="true">🍭</span>`;
                        lastAnnounced = percent;
                    }
                },
                useFastPopulation || profile.mapSize !== 'large'
                    ? {
                          fastPopulation: useFastPopulation,
                          chunkStreaming: profile.mapSize !== 'large',
                      }
                    : undefined
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
            const instructions = document.getElementById('instructions');
            if (instructions) instructions.style.display = 'none';

            showToast('Click to explore! Press [ESC] for Controls', '🎮', 4000);

            // Playable milestone — horizon may still be streaming
            markReadinessPlayable();

            showDeferredIndicator();
            setDeferredFailures(0);
            globalBackgroundProcessor.onProgress((completed, total) => {
                setDeferredProgress(completed, total);
                setDeferredFailures(spawnTracker.getReport().failCount);
            });
            globalBackgroundProcessor.resetCounters();

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
                markReadinessReady();

                try {
                    const r = getSpawnReport();
                    const report = { ...r, backgroundFailed: bgFailed };
                    (window as any).__worldPopulationReport = report;
                    if (r.failed > 0) {
                        console.warn(
                            `[Startup] Population complete with ${r.failed} spawn failures out of ${r.attempted}. See spawn tracker report.`
                        );
                        if (!waitForFullPopulation) {
                            showToast(
                                `Some objects failed to load (${r.failed}). Click the ⚠ badge or check console.`,
                                '⚠️',
                                5000
                            );
                        }
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
            const emoji =
                profile.mapSize === 'small' ? '🍭' : profile.mapSize === 'medium' ? '🌿' : '🌸';
            startButton.innerHTML = `${enterButtonLabel(profile.mapSize, true)} <span aria-hidden="true">${emoji}</span> <span class="key-badge" aria-hidden="true">Enter</span>`;
        } catch (err) {
            console.error('[Init] World generation failed:', err);
            loadingScreen.hide();
            startButton.style.background = '';
            startButton.innerHTML = 'Retry';
            if (modeSelect) {
                modeSelect.querySelectorAll('.profile-row').forEach((el) => {
                    (el as HTMLElement).style.display = '';
                });
                if (modeDescription) modeDescription.style.display = '';
            }
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
}
