import { trapFocusInside } from '../utils/interaction-utils';
import { globalLoadingManager, GlobalProgressState, TaskState } from '../systems/loading-manager';
import { LoadingPhase, LoadingProgress, LoadingScreenOptions, DEFAULT_LOADING_PHASES } from './loading-screen-types';
import { getReport } from '../world/spawn-tracker.ts';
import './loading-screen.css';

// =============================================================================
// LOADING SCREEN CLASS
// =============================================================================

export class LoadingScreen {
    private container: HTMLElement | null = null;
    private overlay: HTMLElement | null = null;
    private progressBar: HTMLElement | null = null;
    private progressFill: HTMLElement | null = null;
    private percentageText: HTMLElement | null = null;
    private taskText: HTMLElement | null = null;
    private timeText: HTMLElement | null = null;
    private skipButton: HTMLButtonElement | null = null;
    private spinner: HTMLElement | null = null;

    // Deferred HUD Indicator
    private deferredIndicator: HTMLElement | null = null;
    private isDeferredVisible = false;

    private phases: LoadingPhase[] = [];
    private currentPhaseIndex = -1;
    private phaseProgress = 0;

    private targetOverallProgress = 0;
    private displayedOverallProgress = 0;
    private displayedPhaseProgress = 0;
    private animationFrameId: number | null = null;
    private lastTime: number = 0;

    private isVisible = false;
    private isComplete = false;
    private hasFatalError = false;
    private skippedPhases: Set<string> = new Set();

    private options: Required<LoadingScreenOptions>;

    // Timing tracking
    private phaseStartTime = 0;
    private phaseDurations: Map<string, number> = new Map();
    private averagePhaseTime = 0;

    // Task text crossfade tracking
    private currentTaskDescription = '';
    private taskChangeTimeout: number | null = null;

    // Track hide version to cancel stale timeout callbacks
    private hideVersion = 0;

    // Callbacks
    private onSkipCallbacks: Set<(phaseId: string) => void> = new Set();
    private onCompleteCallbacks: Set<() => void> = new Set();
    private onProgressCallbacks: Set<(progress: LoadingProgress) => void> = new Set();

    private releaseFocusTrap: (() => void) | null = null;
    private lastFocusedElement: HTMLElement | null = null;

    private unsubscribeProgress: (() => void) | null = null;

    constructor(options: LoadingScreenOptions = {}) {
        this.options = {
            debug: false,
            showEstimatedTime: true,
            allowSkipDeferred: true,
            fadeOutDuration: 500,
            theme: 'candy',
            ...options
        };

        this.phases = [...DEFAULT_LOADING_PHASES];

        // Register default phases to the manager if they aren't already
        this.phases.forEach(p => {
            if (!globalLoadingManager.getTask(p.id)) {
                globalLoadingManager.registerTask({
                    id: p.id,
                    name: p.name,
                    weight: p.weight,
                    description: p.description,
                    isDeferred: p.isDeferred
                });
            }
        });

        // Subscribe to LoadingManager
        this.unsubscribeProgress = globalLoadingManager.onProgress((state, tasks) => {
            this.handleManagerProgress(state, tasks);
        });

        if (this.options.debug) {
            console.log('[LoadingScreen] Initialized with options:', this.options);
        }
    }

    // =========================================================================
    // DOM CREATION
    // =========================================================================

    private createDOM(): void {
        if (typeof document === 'undefined') return;

        // Try to find the existing Deferred HUD Indicator from index.html
        this.deferredIndicator = document.getElementById('candy-deferred-indicator');
        if (!this.deferredIndicator) {
            this.deferredIndicator = document.createElement('div');
            this.deferredIndicator.id = 'candy-deferred-indicator';
            this.deferredIndicator.className = 'deferred-indicator';
            this.deferredIndicator.setAttribute('aria-hidden', 'true');
            this.deferredIndicator.innerHTML = '<span class="deferred-spinner"></span><span class="deferred-text">Populating...</span><span class="deferred-count" aria-hidden="true"></span><span class="deferred-eta" aria-hidden="true"></span><span class="deferred-fail" aria-hidden="true" role="button" tabindex="0" style="display:none;color:#ff6b6b;font-weight:600;margin-left:6px;cursor:pointer;">⚠ <span class="fail-count">0</span></span><span class="deferred-bar"><span class="deferred-bar-fill"></span></span>';
            document.body.appendChild(this.deferredIndicator);
        }

        // Check if loading screen already exists in index.html (FCP Optimization)
        this.container = document.getElementById('candy-loading-screen');
        this.overlay = document.getElementById('candy-loading-overlay');

        if (!this.container || !this.overlay) {
            // Fallback: Create overlay
            this.overlay = document.createElement('div');
            this.overlay.id = 'candy-loading-overlay';
            this.overlay.className = `loading-overlay theme-${this.options.theme}`;
            this.overlay.setAttribute('role', 'dialog');
            this.overlay.setAttribute('aria-modal', 'true');

            // Fallback: Create main container
            this.container = document.createElement('div');
            this.container.id = 'candy-loading-screen';
            this.container.className = `loading-screen theme-${this.options.theme}`;
            this.container.setAttribute('role', 'progressbar');
            this.container.setAttribute('aria-valuemin', '0');
            this.container.setAttribute('aria-valuemax', '100');
            this.container.setAttribute('aria-valuenow', '0');
            this.container.setAttribute('aria-label', 'Game loading progress');
            this.container.setAttribute('aria-live', 'polite');
            this.container.setAttribute('aria-atomic', 'true');

            // Create content wrapper
            const content = document.createElement('div');
            content.className = 'loading-content';

            // Title
            const title = document.createElement('h1');
            title.className = 'loading-title';
            title.innerHTML = '🍭 Candy World <span class="loading-dots">...</span>';
            content.appendChild(title);

            // Spinner
            this.spinner = document.createElement('div');
            this.spinner.className = 'loading-spinner';
            this.spinner.setAttribute('aria-hidden', 'true');
            content.appendChild(this.spinner);

            // Progress section
            const progressSection = document.createElement('div');
            progressSection.className = 'progress-section';

            // Progress bar container
            this.progressBar = document.createElement('div');
            this.progressBar.className = 'progress-bar';

            // Progress fill
            this.progressFill = document.createElement('div');
            this.progressFill.className = 'progress-fill';
            this.progressFill.style.transform = 'scaleX(0)';
            this.progressFill.style.transformOrigin = 'left';
            this.progressBar.appendChild(this.progressFill);

            // Progress details
            const progressDetails = document.createElement('div');
            progressDetails.className = 'progress-details';

            // Percentage text
            this.percentageText = document.createElement('span');
            this.percentageText.className = 'progress-percentage';
            this.percentageText.textContent = '0%';

            // Task description
            this.taskText = document.createElement('span');
            this.taskText.className = 'progress-task';
            this.taskText.textContent = 'Initializing...';

            progressDetails.appendChild(this.percentageText);
            progressDetails.appendChild(this.taskText);

            progressSection.appendChild(this.progressBar);
            progressSection.appendChild(progressDetails);
            content.appendChild(progressSection);

            // Time remaining
            if (this.options.showEstimatedTime) {
                this.timeText = document.createElement('div');
                this.timeText.className = 'time-remaining';
                this.timeText.textContent = 'Calculating time...';
                content.appendChild(this.timeText);
            }

            // Skip button (for deferred phases)
            if (this.options.allowSkipDeferred) {
                this.skipButton = document.createElement('button');
                this.skipButton.className = 'skip-button';
                this.skipButton.innerHTML = '<span aria-hidden="true">⏭️ </span>Skip Optional Content';
                this.skipButton.style.display = 'none';
                this.skipButton.addEventListener('click', () => this.skipCurrentPhase());
                this.skipButton.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        this.skipButton!.classList.add('keyboard-active');
                        setTimeout(() => this.skipButton!.classList.remove('keyboard-active'), 150);
                    }
                });
                content.appendChild(this.skipButton);
            }

            // Status indicators
            const statusIndicators = document.createElement('div');
            statusIndicators.className = 'status-indicators';

            this.phases.forEach((phase, index) => {
                const indicator = document.createElement('div');
                indicator.className = 'phase-indicator';
                indicator.dataset.phaseId = phase.id;
                indicator.dataset.phaseIndex = index.toString();

                const dot = document.createElement('span');
                dot.className = 'phase-dot';

                const label = document.createElement('span');
                label.className = 'phase-label';
                label.textContent = phase.name;

                indicator.appendChild(dot);
                indicator.appendChild(label);
                statusIndicators.appendChild(indicator);
            });

            content.appendChild(statusIndicators);

            this.container.appendChild(content);
            this.overlay.appendChild(this.container);
            document.body.appendChild(this.overlay);
        } else {
            // FCP Element wiring: Grab references to existing HTML components
            this.spinner = this.container.querySelector('.loading-spinner') as HTMLElement;
            this.progressBar = this.container.querySelector('.progress-bar') as HTMLElement;
            this.progressFill = this.container.querySelector('.progress-fill') as HTMLElement;
            this.percentageText = this.container.querySelector('.progress-percentage') as HTMLElement;
            this.taskText = this.container.querySelector('.progress-task') as HTMLElement;
            this.timeText = this.container.querySelector('.time-remaining') as HTMLElement;
            this.skipButton = this.container.querySelector('.skip-button') as HTMLButtonElement;

            if (this.skipButton) {
                this.skipButton.addEventListener('click', () => this.skipCurrentPhase());
                this.skipButton.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        this.skipButton!.classList.add('keyboard-active');
                        setTimeout(() => this.skipButton!.classList.remove('keyboard-active'), 150);
                    }
                });
            }
        }

        if (this.options.debug) {
            console.log('[LoadingScreen] DOM created');
        }
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Show the loading screen
     */
    show(): void {
        this.lastFocusedElement = document.activeElement as HTMLElement;
        // If hide() is in progress (isComplete but not yet destroyed), cancel it
        if (this.isComplete) {
            this.isComplete = false;
            this.hideVersion++; // Invalidate any pending hide timeouts
        }

        if (this.isVisible && this.overlay && this.container) {
            // Already shown - just re-add visible classes in case hide was animating
            requestAnimationFrame(() => {
                if (this.overlay) this.overlay.classList.add('visible');
                if (this.container) {
                    this.container.classList.remove('complete');
                    this.container.classList.add('visible');
                }
            });
            return;
        }

        this.createDOM();
        this.isVisible = true;
        this.isComplete = false;

        // Set aria-busy on the document body to indicate loading is in progress
        document.body.setAttribute('aria-busy', 'true');

        this.lastFocusedElement = document.activeElement as HTMLElement;

        if (this.releaseFocusTrap) {
            this.releaseFocusTrap();
            this.releaseFocusTrap = null;
        }

        if (this.container) {
            this.container.setAttribute('tabindex', '-1');
            this.container.setAttribute('aria-modal', 'true');
        }

        // Trigger reflow for animation
        if (this.overlay) {
            this.overlay.style.display = 'flex';
            void this.overlay.offsetWidth;
            this.overlay.classList.add('visible');
        }
        if (this.container) {
            this.container.style.display = 'flex';
            void this.container.offsetWidth;
            this.container.classList.add('visible');
        }

        setTimeout(() => {
            if (this.container && this.isVisible) {
                this.releaseFocusTrap = trapFocusInside(this.container);
            }
        }, 300);

        this.lastTime = performance.now();
        if (this.animationFrameId === null) {
            this.animationFrameId = requestAnimationFrame(this.animateProgress);
        }

        if (this.options.debug) {
            console.log('[LoadingScreen] Shown');
        }
    }

    /**
     * Show the subtle deferred loading indicator in the HUD
     */
    showDeferredIndicator(): void {
        if (!this.deferredIndicator) return;
        this.isDeferredVisible = true;
        this.deferredIndicator.classList.add('visible');
        this.deferredIndicator.setAttribute('aria-hidden', 'false');
        if (this.options.debug) console.log('[LoadingScreen] Deferred indicator shown');
    }

    /**
     * Update the deferred indicator's progress bar and count
     */
    /**
     * @param failedHint  Optional pre-computed failed count from LoadingManager state;
     *                    falls back to SpawnTracker.getReport() when omitted.
     * @param etaMs       Estimated milliseconds remaining (-1 = unknown).
     */
    setDeferredProgress(completed: number, total: number, failedHint?: number, etaMs: number = -1): void {
        if (!this.deferredIndicator) return;
        const pct = total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0;
        const fill = this.deferredIndicator.querySelector('.deferred-bar-fill') as HTMLElement | null;
        if (fill) { fill.style.transform = `scaleX(${pct / 100})`; fill.style.transformOrigin = 'left'; }
        const count = this.deferredIndicator.querySelector('.deferred-count') as HTMLElement | null;
        if (count) count.textContent = `${completed} / ${total}`;
        this.deferredIndicator.setAttribute('aria-valuenow', String(Math.round(pct)));

        // ETA display
        const etaEl = this.deferredIndicator.querySelector('.deferred-eta') as HTMLElement | null;
        if (etaEl) {
            if (etaMs > 0) {
                const secs = Math.ceil(etaMs / 1000);
                etaEl.textContent = secs < 60 ? `~${secs}s` : `~${Math.ceil(secs / 60)}m`;
            } else {
                etaEl.textContent = '';
            }
        }

        // Spawn failure badge — use hint from manager when available, else query tracker.
        try {
            const failedCount = failedHint !== undefined ? failedHint : (getReport ? getReport().failed : 0);
            const failEl = this.deferredIndicator.querySelector('.deferred-fail') as HTMLElement | null;
            const failCountEl = this.deferredIndicator.querySelector('.fail-count') as HTMLElement | null;
            if (failEl && failCountEl) {
                if (failedCount > 0) {
                    failCountEl.textContent = String(failedCount);
                    failEl.style.display = 'inline';
                    failEl.setAttribute('aria-hidden', 'false');
                    failEl.setAttribute('title', `${failedCount} object(s) failed to spawn — click for details`);
                    if (!(failEl as any)._spawnClickWired) {
                        (failEl as any)._spawnClickWired = true;
                        const handleActivate = (ev: Event) => {
                            ev.stopPropagation();
                            try {
                                const r = getReport();
                                const summary = `Spawn failures: ${r.failed}/${r.attempted} (succeeded ${r.succeeded}). By type: ${Object.entries(r.failuresByType).map(([k,v])=>k+':'+v).join(', ') || 'n/a'}`;
                                console.group('[SpawnTracker] Failures during population');
                                console.table(r.failuresByType);
                                console.log('Last errors:', r.lastErrors);
                                console.groupEnd();
                                import('../utils/toast.ts').then(({ showToast }) => {
                                    showToast(summary + ' — see console for full list', '⚠️', 6000);
                                }).catch(() => {
                                    const t = document.createElement('div');
                                    t.textContent = summary;
                                    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#3a2a2a;color:#ffdddd;padding:6px 10px;border-radius:4px;z-index:99999;font-size:12px';
                                    document.body.appendChild(t);
                                    setTimeout(() => t.remove(), 5000);
                                });
                            } catch (e) { console.warn('[Deferred] failed to show spawn report', e); }
                        };
                        failEl.addEventListener('click', handleActivate);
                        failEl.addEventListener('keydown', (ev: KeyboardEvent) => {
                            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleActivate(ev); }
                        });
                    }
                } else {
                    failEl.style.display = 'none';
                    failEl.setAttribute('aria-hidden', 'true');
                }
            }
        } catch {
            // tracker not ready — silent
        }
    }

    /**
     * Hide the deferred loading indicator
     */
    hideDeferredIndicator(): void {
        if (!this.deferredIndicator || !this.isDeferredVisible) return;
        this.isDeferredVisible = false;
        this.deferredIndicator.classList.remove('visible');
        this.deferredIndicator.setAttribute('aria-hidden', 'true');
        if (this.options.debug) console.log('[LoadingScreen] Deferred indicator hidden');
    }

    hide(): void {
        if (!this.isVisible || this.isComplete) return;

        this.isComplete = true;

        if (this.releaseFocusTrap) {
            this.releaseFocusTrap();
            this.releaseFocusTrap = null;
        }

        if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
            this.lastFocusedElement.focus({ preventScroll: true });
            this.lastFocusedElement = null;
        }

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.container) {
            this.container.classList.add('complete');
            this.container.setAttribute('aria-valuenow', '100');
        }
        if (this.progressFill) {
            this.progressFill.style.transform = 'scaleX(1)';
        }
        if (this.percentageText) {
            this.percentageText.textContent = '100%';
        }
        if (this.taskText) {
            this.taskText.textContent = 'Ready!';
        }

        const currentHideVersion = this.hideVersion;

        setTimeout(() => {
            if (this.overlay) {
                this.overlay.classList.remove('visible');
                this.overlay.classList.add('loaded'); // VRT helper
                this.overlay.style.display = 'none'; // Force hide for tests
            }
            if (this.container) {
                this.container.style.display = 'none';
            }
            if (this.container) {
                this.container.classList.remove('visible');
            }

            setTimeout(() => {
                // Guard: don't destroy if show() was called again in the meantime
                if (this.hideVersion === currentHideVersion && this.isComplete) {
                    if (this.overlay) {
                        this.overlay.style.display = 'none';
                    }
                    if (this.container) {
                        this.container.style.display = 'none';
                    }
                    this.destroy();
                    this.isVisible = false;
                    this.onCompleteCallbacks.forEach(cb => cb());
                }
            }, this.options.fadeOutDuration);
        }, 10);

        if (this.options.debug) {
            console.log('[LoadingScreen] Hiding...');
        }
    }

    /**
     * Set custom loading phases
     */
    setPhases(phases: LoadingPhase[]): void {
        this.phases = phases;

        // Recreate DOM if visible
        if (this.isVisible) {
            this.destroy();
            this.createDOM();
        }
    }

    /**
     * Mark a phase as non-skippable so the skip button won't appear when it is active.
     * Call before startPhase when the caller wants to enforce completion (e.g. waitForFull mode).
     */
    markPhaseNonSkippable(phaseId: string): void {
        const phase = this.phases.find(p => p.id === phaseId);
        if (phase) phase.nonSkippable = true;
    }

    /**
     * Start a specific loading phase
     */
    startPhase(phaseId: string): void {
        const phaseIndex = this.phases.findIndex(p => p.id === phaseId);
        if (phaseIndex === -1) {
            console.warn(`[LoadingScreen] Unknown phase: ${phaseId}`);
            return;
        }

        this.currentPhaseIndex = phaseIndex;
        this.phaseProgress = 0;
        this.displayedPhaseProgress = 0;
        this.phaseStartTime = Date.now();

        const phase = this.phases[phaseIndex];

        // Call phase start callback
        phase.onStart?.();

        // Update UI
        this.updateUI(phase);
        this.updatePhaseIndicators();

        // Show skip button for deferred phases that haven't been marked non-skippable
        if (this.skipButton) {
            const showSkip = phase.isDeferred && !phase.nonSkippable && this.options.allowSkipDeferred;
            this.skipButton.style.display = showSkip ? 'block' : 'none';
        }

        if (this.options.debug) {
            console.log(`[LoadingScreen] Phase started: ${phase.name}`);
        }
    }

    /**
     * Update progress within the current phase
     */
    updateProgress(percent: number, taskDescription?: string): void {
        this.phaseProgress = Math.max(0, Math.min(100, percent));

        const currentPhase = this.phases[this.currentPhaseIndex];
        const description = taskDescription || currentPhase?.description || 'Loading...';

        this.updateUI(currentPhase, description);

        // Notify progress callbacks
        const progress: LoadingProgress = {
            phase: currentPhase?.id || 'unknown',
            phaseIndex: this.currentPhaseIndex,
            totalPhases: this.phases.length,
            percent: this.phaseProgress,
            overallPercent: this.targetOverallProgress,
            taskDescription: description,
            estimatedTimeRemaining: this.calculateEstimatedTimeRemaining()
        };

        this.onProgressCallbacks.forEach(cb => cb(progress));
    }

    /**
     * Complete the current phase
     */
    completePhase(phaseId?: string): void {
        const targetPhaseId = phaseId || this.phases[this.currentPhaseIndex]?.id;
        if (!targetPhaseId) return;

        const phase = this.phases.find(p => p.id === targetPhaseId);
        if (phase) {
            // Record phase duration
            const duration = Date.now() - this.phaseStartTime;
            this.phaseDurations.set(phase.id, duration);
            this.updateAveragePhaseTime();

            phase.onComplete?.();

            if (this.options.debug) {
                console.log(`[LoadingScreen] Phase completed: ${phase.name} (${duration}ms)`);
            }
        }

        // Forward to Manager
        globalLoadingManager.completeTask(targetPhaseId);

        // Hide when all non-deferred phases are done (last phase in list, or overall ≥99%).
        // The deferred-population phase is isDeferred:true, so skipping it also hides.
        const isLastPhase = this.currentPhaseIndex >= this.phases.length - 1;
        const currentPhaseIsDeferred = this.phases[this.currentPhaseIndex]?.isDeferred;
        if (globalLoadingManager.getOverallProgress() >= 99 || isLastPhase || currentPhaseIsDeferred) {
            this.hide();
        }
    }

    /**
     * Skip the current phase (if deferred)
     */
    skipCurrentPhase(): void {
        const currentPhase = this.phases[this.currentPhaseIndex];
        if (!currentPhase?.isDeferred) {
            console.warn('[LoadingScreen] Cannot skip non-deferred phase');
            return;
        }

        this.skippedPhases.add(currentPhase.id);
        this.onSkipCallbacks.forEach(cb => cb(currentPhase.id));

        if (this.options.debug) {
            console.log(`[LoadingScreen] Skipped phase: ${currentPhase.name}`);
        }

        globalLoadingManager.skipTask(currentPhase.id);
        this.completePhase(currentPhase.id);
    }

    /**
     * Set loading status (legacy compatibility)
     */
    setStatus(text: string): void {
        this.setTaskText(text);
    }

    private setTaskText(text: string): void {
        if (!this.taskText) return;
        if (text === this.currentTaskDescription) return;

        this.currentTaskDescription = text;

        if (this.taskChangeTimeout !== null) {
            clearTimeout(this.taskChangeTimeout);
        }

        this.taskText.classList.add('changing');
        this.taskChangeTimeout = window.setTimeout(() => {
            if (this.taskText) {
                this.taskText.textContent = text;
                this.taskText.classList.remove('changing');
            }
            this.taskChangeTimeout = null;
        }, 150);
    }

    /**
     * Register callback for skip events
     */
    onSkip(callback: (phaseId: string) => void): () => void {
        this.onSkipCallbacks.add(callback);
        return () => this.onSkipCallbacks.delete(callback);
    }

    /**
     * Register callback for completion
     */
    onComplete(callback: () => void): () => void {
        this.onCompleteCallbacks.add(callback);
        return () => this.onCompleteCallbacks.delete(callback);
    }

    /**
     * Register callback for progress updates
     */
    onProgress(callback: (progress: LoadingProgress) => void): () => void {
        this.onProgressCallbacks.add(callback);
        return () => this.onProgressCallbacks.delete(callback);
    }

    /**
     * Check if loading screen is visible
     */
    getVisible(): boolean {
        return this.isVisible;
    }

    /**
     * Get current progress information
     */
    getProgress(): LoadingProgress {
        const currentPhase = this.phases[this.currentPhaseIndex];
        return {
            phase: currentPhase?.id || 'unknown',
            phaseIndex: this.currentPhaseIndex,
            totalPhases: this.phases.length,
            percent: this.phaseProgress,
            overallPercent: this.targetOverallProgress,
            taskDescription: currentPhase?.description || 'Loading...',
            estimatedTimeRemaining: this.calculateEstimatedTimeRemaining()
        };
    }

    /**
     * Get timing statistics
     */
    getTimingStats(): { phaseDurations: Map<string, number>; averagePhaseTime: number } {
        return {
            phaseDurations: new Map(this.phaseDurations),
            averagePhaseTime: this.averagePhaseTime
        };
    }

    // =========================================================================
    // PRIVATE METHODS
    // =========================================================================

    private updateUI(phase?: LoadingPhase, taskDescription?: string): void {
        if (!this.container) return;

        // Note: progressFill, percentageText, and aria-valuenow are now updated in updateUIVisuals via animateProgress.

        // Update task text
        if (taskDescription) {
            this.setTaskText(taskDescription);
        }

        // Update time remaining
        if (this.timeText && this.options.showEstimatedTime) {
            const remaining = this.calculateEstimatedTimeRemaining();
            if (remaining > 0) {
                this.timeText.textContent = `About ${Math.ceil(remaining)}s remaining`;
            } else {
                this.timeText.textContent = 'Almost there...';
            }
        }
    }

    private updatePhaseIndicators(): void {
        const indicators = document.querySelectorAll('.phase-indicator');
        indicators.forEach((indicator, index) => {
            indicator.classList.remove('active', 'complete', 'skipped');

            if (index < this.currentPhaseIndex) {
                const phaseId = this.phases[index]?.id;
                if (phaseId && this.skippedPhases.has(phaseId)) {
                    indicator.classList.add('skipped');
                } else {
                    indicator.classList.add('complete');
                }
            } else if (index === this.currentPhaseIndex) {
                indicator.classList.add('active');
            }
        });
    }

    private animateProgress = (time: number): void => {
        if (!this.isVisible || this.isComplete || this.hasFatalError) {
            this.animationFrameId = null;
            return;
        }

        const delta = Math.min((time - this.lastTime) / 1000, 0.1); // clamp delta
        this.lastTime = time;

        let needsVisualUpdate = false;

        // Dampen the displayed phase progress towards target
        const phaseDiff = this.phaseProgress - this.displayedPhaseProgress;
        if (Math.abs(phaseDiff) > 0.1) {
            this.displayedPhaseProgress += phaseDiff * (1.0 - Math.exp(-5.0 * delta));
            needsVisualUpdate = true;
        } else if (this.displayedPhaseProgress !== this.phaseProgress) {
            this.displayedPhaseProgress = this.phaseProgress;
            needsVisualUpdate = true;
        }

        // Dampen the displayed overall progress towards the target
        const diff = this.targetOverallProgress - this.displayedOverallProgress;
        if (Math.abs(diff) > 0.1) {
            // Lerp factor
            this.displayedOverallProgress += diff * (1.0 - Math.exp(-5.0 * delta));
            needsVisualUpdate = true;
        } else if (this.displayedOverallProgress !== this.targetOverallProgress) {
            this.displayedOverallProgress = this.targetOverallProgress;
            needsVisualUpdate = true;
        }

        if (needsVisualUpdate) {
            this.updateUIVisuals();
        }

        this.animationFrameId = requestAnimationFrame(this.animateProgress);
    }

    private updateUIVisuals(): void {
        if (!this.container) return;

        // Update progress bar
        if (this.progressFill) {
            this.progressFill.style.transform = `scaleX(${this.displayedOverallProgress / 100})`;
            this.progressFill.style.transformOrigin = 'left';
        }

        // Update percentage text
        if (this.percentageText) {
            const isLerping = Math.abs(this.targetOverallProgress - this.displayedOverallProgress) > 0.5;
            if (isLerping) {
                this.percentageText.textContent = `${this.displayedOverallProgress.toFixed(1)}%`;
            } else {
                this.percentageText.textContent = `${Math.round(this.displayedOverallProgress)}%`;
            }
        }

        // Update ARIA
        this.container.setAttribute('aria-valuenow', Math.round(this.displayedOverallProgress).toString());

        // Update active phase indicator progress
        const activeIndicator = this.container.querySelector('.phase-indicator.active') as HTMLElement;
        if (activeIndicator) {
            activeIndicator.style.setProperty('--phase-progress', `${this.displayedPhaseProgress}%`);
        }
    }

    private handleManagerProgress(state: GlobalProgressState, tasks: Map<string, TaskState>): void {
        if (this.hasFatalError) return;

        // Always update the deferred indicator from manager state, even after loading screen hides.
        if (state.deferredTotal > 0) {
            this.setDeferredProgress(
                state.deferredCompleted, state.deferredTotal,
                state.deferredFailed, state.deferredEtaMs
            );
        }

        if (!this.isVisible) return;

        this.targetOverallProgress = state.overallPercent;

        if (state.activeTaskId) {
            const activeTask = tasks.get(state.activeTaskId);
            if (activeTask) {
                this.phaseProgress = activeTask.percentComplete;
                if (state.activeTaskDescription) {
                    this.setTaskText(state.activeTaskDescription);
                }
            }
        }
    }

    private calculateEstimatedTimeRemaining(): number {
        return globalLoadingManager.getEstimatedTimeRemaining();
    }

    private updateAveragePhaseTime(): void {
        if (this.phaseDurations.size === 0) return;

        let totalTime = 0;
        let totalWeight = 0;

        for (const [phaseId, duration] of this.phaseDurations) {
            const phase = this.phases.find(p => p.id === phaseId);
            if (phase) {
                totalTime += duration / phase.weight;
                totalWeight += 1;
            }
        }

        this.averagePhaseTime = totalWeight > 0 ? totalTime / totalWeight : 0;
    }

    /**
     * Display a fatal error state on the loading screen.
     * Stops the spinner, turns the progress bar red, and shows the error message.
     * @param message Human-readable error description shown to the user.
     */
    showFatalError(message: string): void {
        // Stop the animation loop so the spinner and lerp no longer run
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Use a dedicated flag so hide() and animateProgress() don't misinterpret
        // this as a successful completion.
        this.hasFatalError = true;

        if (this.container) {
            this.container.classList.add('fatal-error');
            this.container.setAttribute('aria-valuenow', '0');
            this.container.setAttribute('aria-label', 'Game initialization failed');
        }

        // Turn progress bar red
        if (this.progressFill) {
            this.progressFill.style.transform = 'scaleX(1)';
            this.progressFill.classList.add('fatal-error');
        }

        if (this.percentageText) {
            this.percentageText.textContent = 'Error';
        }

        // Show error message
        if (this.taskText) {
            this.taskText.textContent = message;
            this.taskText.classList.add('fatal-error');
        }

        // Stop the "Calculating time…" ticker
        if (this.timeText) {
            this.timeText.textContent = '';
        }

        // Hide skip button
        if (this.skipButton) {
            this.skipButton.style.display = 'none';
        }

        // Stop spinner
        if (this.spinner) {
            this.spinner.classList.add('stopped');
        }

        // Add a reload button so the user has a clear recovery path
        if (this.container) {
            const existing = this.container.querySelector('.fatal-error-reload');
            if (!existing) {
                const reloadBtn = document.createElement('button');
                reloadBtn.className = 'fatal-error-reload skip-button';
                reloadBtn.setAttribute('aria-label', 'Reload page to try again');
                reloadBtn.innerHTML = '<span aria-hidden="true">🔄</span> Reload Page';
                reloadBtn.addEventListener('click', () => window.location.reload());
                reloadBtn.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        reloadBtn.classList.add('keyboard-active');
                        setTimeout(() => reloadBtn.classList.remove('keyboard-active'), 150);
                    }
                });
                this.container.querySelector('.loading-content')?.appendChild(reloadBtn);
            }
        }

        console.error('[LoadingScreen] Fatal error displayed:', message);
    }

    private destroy(): void {
        if (this.releaseFocusTrap) {
            this.releaseFocusTrap();
            this.releaseFocusTrap = null;
        }
        if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
            this.lastFocusedElement.focus({ preventScroll: true });
            this.lastFocusedElement = null;
        }

        if (this.unsubscribeProgress) {
            this.unsubscribeProgress();
            this.unsubscribeProgress = null;
        }

        if (this.overlay && this.overlay.parentNode) {
            this.overlay.style.display = 'none';
            this.overlay.parentNode.removeChild(this.overlay);
        }
        if (this.container) {
            this.container.style.display = 'none';
        }
        this.container = null;
        this.overlay = null;
        this.progressBar = null;
        this.progressFill = null;
        this.percentageText = null;
        this.taskText = null;
        this.timeText = null;
        this.skipButton = null;
        this.spinner = null;

        // Clear aria-busy once loading is complete
        document.body.setAttribute('aria-busy', 'false');
    }
}
