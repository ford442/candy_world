import {
    getLoadMemoryTier,
    shouldPreferLightWorldLoad,
} from '../config.ts';
import { isWebGLLiteMode } from '../../rendering/webgl-debug.ts';
import { populateWorld, WorldMode } from '../../world/generation.ts';
import { animatedFoliage, interactiveObjects } from '../../world/state.ts';
import { populatePhysicsGrids } from '../../systems/physics/index.ts';
import { initFaunaSystem } from '../../systems/fauna/index.ts';
import { initFaunaDebug } from '../../debug/fauna-debug.ts';
import { initCloudPlacer } from '../../world/cloud-placer.ts';
import { initPresenceFromOptIn } from '../../systems/net/index.ts';
import { safeRemoveAndDispose } from '../../utils/dispose-utils.ts';
import {
    applyAwakenedPersistenceAfterWorldLoad,
    initDeferredVisuals,
    runDeferredWarmup,
} from '../deferred-init.ts';
import { globalBackgroundProcessor } from '../../utils/background-processor.ts';
import {
    showDeferredIndicator,
    hideDeferredIndicator,
    setDeferredProgress,
    setDeferredFailures,
} from '../../ui/loading-screen.ts';
import { reset as resetSpawnTracker, getReport as getSpawnReport } from '../../world/spawn-tracker.ts';
import { globalLoadingManager } from '../../systems/loading-manager.ts';
import { validateWorldPopulation } from '../../world/world-health.ts';
import { showModeBadge } from '../../ui/mode-badge.ts';
import { finalizeStartupProfile, startPhase, endPhase } from '../../utils/startup-profiler.ts';
import { spawnTracker } from '../../world/spawn-tracker.ts';
import { StageLoader } from '../../debug/index.ts';
import { camera, renderer, scene } from './exports.ts';
import { WAIT_FULL_KEY } from './constants.ts';
import type { MainContext } from './context.ts';

export function setupStartScreen(ctx: MainContext): void {
    const { loadingScreen, mode } = ctx;
    let { waitForFullPopulation } = ctx;

    const startButton = document.getElementById('startButton') as HTMLButtonElement | null;
    const statusEl = document.getElementById('world-status');

    if (!startButton) return;

    startButton.disabled = false;
    startButton.setAttribute('aria-disabled', 'false');
    startButton.removeAttribute('aria-busy');
    startButton.removeAttribute('title');
    startButton.innerHTML =
        'Enter the Dream <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>';

    import('../../ui/announcer.ts')
        .then(({ announce }) => {
            announce('World loaded. Press Enter to enter the world.', 'assertive');
        })
        .catch((err) => console.warn('Failed to load announcer:', err));

    let coreOnlyMode = true;
    let fastFullMode = false;

    const btnCoreOnly = document.getElementById('btn-core-only') as HTMLButtonElement | null;
    const btnFullGame = document.getElementById('btn-full-game') as HTMLButtonElement | null;
    const btnFastFull = document.getElementById('btn-fast-full') as HTMLButtonElement | null;
    const modeSelect = document.getElementById('mode-select');
    const modeDescription = document.getElementById('mode-description');

    const updateStartupMode = (selectedMode: 'CORE' | 'FULL' | 'FAST_FULL') => {
        coreOnlyMode = selectedMode === 'CORE';
        fastFullMode = selectedMode === 'FAST_FULL';

        console.log(`[Startup] Mode selected: ${selectedMode}`);

        const isCore = selectedMode === 'CORE';
        const isFast = selectedMode === 'FAST_FULL';

        if (btnCoreOnly) {
            btnCoreOnly.setAttribute('aria-checked', String(isCore));
        }
        if (btnFullGame) {
            btnFullGame.setAttribute('aria-checked', String(selectedMode === 'FULL'));
        }
        if (btnFastFull) {
            btnFastFull.setAttribute('aria-checked', String(isFast));
        }

        if (modeDescription) {
            const memHint = shouldPreferLightWorldLoad()
                ? " (auto-throttled for this device's RAM)"
                : '';
            modeDescription.textContent = isCore
                ? 'Fast startup with classic candy terrain, trees, mushrooms, and clouds.'
                : isFast
                  ? `Full musical map with greatly reduced object count for much faster loading${memHint}.`
                  : shouldPreferLightWorldLoad()
                    ? 'Full musical map — population will be auto-reduced on this device to avoid load lockups.'
                    : 'Full game with the complete musical foliage map.';
        }

        startButton.innerHTML = isCore
            ? 'Enter the Dream <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>'
            : isFast
              ? 'Enter Fast Dream <span aria-hidden="true">🌿</span> <span class="key-badge" aria-hidden="true">Enter</span>'
              : 'Enter Full Dream <span aria-hidden="true">🌸</span> <span class="key-badge" aria-hidden="true">Enter</span>';
    };

    const getGenerationLabel = (worldMode: WorldMode) => {
        if (worldMode === 'CORE') return 'Generating core world...';
        return fastFullMode
            ? 'Generating light full world (reduced objects)...'
            : 'Generating world map...';
    };

    updateStartupMode('CORE');
    if (mode === 'webgl' && isWebGLLiteMode()) {
        console.warn('[Startup] WebGL lite mode — CORE world generation recommended');
    }

    let worldGenerated = false;
    let isGenerating = false;

    function yieldFrame(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (btnCoreOnly && btnFullGame && btnFastFull) {
        const modeButtons = [
            { btn: btnCoreOnly, mode: 'CORE' as const },
            { btn: btnFullGame, mode: 'FULL' as const },
            { btn: btnFastFull, mode: 'FAST_FULL' as const },
        ];

        const setupModeButton = (
            btn: HTMLButtonElement,
            selectedMode: 'CORE' | 'FULL' | 'FAST_FULL',
            index: number
        ) => {
            btn.addEventListener('click', async () => {
                btn.setAttribute('aria-busy', 'true');
                btn.setAttribute('aria-disabled', 'true');
                try {
                    updateStartupMode(selectedMode);
                    await yieldFrame();
                } finally {
                    btn.removeAttribute('aria-busy');
                    btn.removeAttribute('aria-disabled');
                }
            });

            btn.addEventListener('keydown', (e) => {
                let nextIndex = -1;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    nextIndex = (index + 1) % modeButtons.length;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    nextIndex = (index - 1 + modeButtons.length) % modeButtons.length;
                } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    btn.classList.add('keyboard-active');
                }

                if (nextIndex !== -1) {
                    e.preventDefault();
                    const nextBtn = modeButtons[nextIndex].btn;
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
                modeButtons.forEach((mb) => mb.btn.setAttribute('tabindex', '-1'));
                btn.setAttribute('tabindex', '0');
                if (btn.getAttribute('aria-checked') !== 'true') {
                    btn.click();
                }
            });
        };

        modeButtons.forEach((mb, index) => {
            mb.btn.setAttribute(
                'tabindex',
                mb.btn.getAttribute('aria-checked') === 'true' ? '0' : '-1'
            );
            setupModeButton(mb.btn, mb.mode, index);
        });
    }

    const waitFullCheckbox = document.getElementById(
        'wait-full-checkbox'
    ) as HTMLButtonElement | null;
    if (waitFullCheckbox) {
        waitFullCheckbox.setAttribute('aria-checked', String(waitForFullPopulation));
        waitFullCheckbox.addEventListener('click', (e) => {
            e.preventDefault();
            const isChecked = waitFullCheckbox.getAttribute('aria-checked') === 'true';
            const newCheckedState = !isChecked;
            waitFullCheckbox.setAttribute('aria-checked', String(newCheckedState));
            waitForFullPopulation = newCheckedState;
            ctx.waitForFullPopulation = newCheckedState;
            localStorage.setItem(WAIT_FULL_KEY, waitForFullPopulation ? '1' : '0');
        });

        waitFullCheckbox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (e.repeat) return;
                waitFullCheckbox.classList.add('keyboard-active');
                waitFullCheckbox.click();
            }
        });

        waitFullCheckbox.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                waitFullCheckbox.classList.remove('keyboard-active');
            }
        });

        waitFullCheckbox.addEventListener('blur', () => {
            waitFullCheckbox.classList.remove('keyboard-active');
        });
    }

    async function enterWorld() {
        if (isGenerating || !startButton || worldGenerated) return;

        isGenerating = true;
        ctx.worldGenerationActive = true;
        console.log('[Startup] Entering world...');

        startButton.disabled = true;
        startButton.setAttribute('aria-busy', 'true');
        startButton.setAttribute('aria-disabled', 'true');
        startButton.setAttribute('title', 'Generating world...');
        startButton.innerHTML =
            '<span class="spinner" aria-hidden="true"></span>Generating... <span aria-hidden="true">🍭</span>';

        await yieldFrame();
        const requestedMode: WorldMode = coreOnlyMode ? 'CORE' : 'FULL';
        const useFastPopulation = fastFullMode || (!coreOnlyMode && shouldPreferLightWorldLoad());
        if (useFastPopulation && !fastFullMode && shouldPreferLightWorldLoad()) {
            console.warn(
                `[Startup] Low/critical memory tier (${getLoadMemoryTier()}) — enabling reduced Full-mode population to avoid load lockups`
            );
        }
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

            console.log(`[Startup] Enter world requested in ${requestedMode} mode`);

            if (modeSelect) {
                modeSelect.style.display = 'none';
            }
            showModeBadge(requestedMode);

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

                    if (statusEl) {
                        statusEl.textContent = progressLabel;
                    }

                    startButton.style.background =
                        requestedMode === 'CORE'
                            ? `linear-gradient(90deg, #FF9ECD ${percent}%, #FFD4E3 ${percent}%)`
                            : `linear-gradient(90deg, #FF6B6B ${percent}%, #FFB6C1 ${percent}%)`;

                    if (percent - lastAnnounced >= 10 || percent === 100) {
                        startButton.innerHTML = `<span class="spinner" aria-hidden="true"></span>Generating ${percent}%... <span aria-hidden="true">${requestedMode === 'CORE' ? '🍭' : '🍭'}</span>`;
                        lastAnnounced = percent;
                    }
                },
                useFastPopulation ? { fastPopulation: true } : undefined
            );

            if (activeWorldMode !== requestedMode) {
                console.warn(
                    `[Startup] Full mode fallback engaged: booted in ${activeWorldMode} mode instead of ${requestedMode}`
                );
                showModeBadge(activeWorldMode);
            }

            endPhase('Map Generation');

            delete (window as any).__fastPopulationOverride;

            populatePhysicsGrids();

            initFaunaSystem();
            initFaunaDebug(scene);

            initCloudPlacer({ scene, camera, weatherSystem: ctx.weatherSystem ?? null });

            try {
                const { initSkyIslandDebug, rebuildSkyIslandDebug } =
                    await import('../../world/sky-island-graph.ts');
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

            import('../../ui/announcer.ts').then(({ announce }) => {
                announce('World generated. Welcome to Candy World.', 'assertive');
            });
        });

        if (!worldGenResult.success) {
            throw new Error(worldGenResult.error || 'World generation failed');
        }

        try {
            const instructions = document.getElementById('instructions');
            if (instructions) instructions.style.display = 'none';

            import('../../utils/toast.ts').then(({ showToast }) => {
                showToast('Click to explore! Press [ESC] for Controls', '🎮', 4000);
            });

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

                try {
                    const r = getSpawnReport();
                    const report = { ...r, backgroundFailed: bgFailed };
                    (window as any).__worldPopulationReport = report;
                    if (r.failed > 0) {
                        console.warn(
                            `[Startup] Population complete with ${r.failed} spawn failures out of ${r.attempted}. See spawn tracker report.`
                        );
                        if (!waitForFullPopulation) {
                            import('../../utils/toast.ts')
                                .then(({ showToast }) => {
                                    showToast(
                                        `Some objects failed to load (${r.failed}). Click the ⚠ badge or check console.`,
                                        '⚠️',
                                        5000
                                    );
                                })
                                .catch(() => {});
                        }
                    } else if (r.attempted > 0) {
                        console.log(
                            `[Startup] Population complete: ${r.succeeded}/${r.attempted} objects spawned cleanly.`
                        );
                    }
                } catch {}

                document.dispatchEvent(new CustomEvent('worldFullyPopulated'));

                try {
                    const health = validateWorldPopulation(activeWorldMode ?? 'UNKNOWN');
                    if (!health.healthy) {
                        import('../../utils/toast.ts')
                            .then(({ showToast }) => {
                                const summary =
                                    health.warnings.length === 1
                                        ? health.warnings[0]
                                        : `${health.warnings.length} world health warnings — see console`;
                                showToast(summary, '⚠️', 7000);
                            })
                            .catch(() => {});
                    }
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
            const wasFast = !!(window as any).__fastPopulationOverride || fastFullMode;
            if (activeWorldMode === 'CORE') {
                startButton.innerHTML =
                    'Regenerate Core Dream <span aria-hidden="true">🍭</span> <span class="key-badge" aria-hidden="true">Enter</span>';
            } else if (wasFast) {
                startButton.innerHTML =
                    'Regenerate Fast Dream <span aria-hidden="true">🌿</span> <span class="key-badge" aria-hidden="true">Enter</span>';
            } else {
                startButton.innerHTML =
                    'Regenerate Full Dream <span aria-hidden="true">🌸</span> <span class="key-badge" aria-hidden="true">Enter</span>';
            }
        } catch (err) {
            console.error('[Init] World generation failed:', err);
            loadingScreen.hide();
            startButton.style.background = '';
            startButton.innerHTML = 'Retry';
            import('../../ui/announcer.ts').then(({ announce }) => {
                announce('World generation failed. Please try again.', 'assertive');
            });
        } finally {
            ctx.worldGenerationActive = false;
            isGenerating = false;
            startButton.disabled = false;
            startButton.setAttribute('aria-disabled', 'false');
            startButton.removeAttribute('aria-busy');
            startButton.removeAttribute('title');

            import('../../ui/announcer.ts')
                .then(({ announce }) => {
                    announce('World loaded. Press Enter to enter the world.', 'assertive');
                })
                .catch((err) => console.warn('Failed to load announcer:', err));
        }
    }

    startButton.addEventListener('click', () => {
        if (!isGenerating) {
            void enterWorld();
        }
    });
}
