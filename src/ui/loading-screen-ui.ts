import { trapFocusInside } from '../utils/interaction-utils.ts';
import { yieldToPaint } from '../utils/yield-to-paint.ts';
import { globalLoadingManager, GlobalProgressState, TaskState } from '../systems/loading-manager.ts';
import { LoadingPhase, LoadingScreenOptions } from './loading-screen-types.ts';
import { LoadingScreenProgress, setLoadingScreenClass } from './loading-screen-progress.ts';
import { createDeferredIndicator, createLoadingScreenDOM, addFatalErrorReloadButton, wireSkipButton } from './loading-screen-dom.ts';
import { updateSpawnFailureBadge } from './loading-screen-reporting.ts';
import './loading-screen.css';

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

    private animationFrameId: number | null = null;
    private lastTime: number = 0;

    private isVisible = false;
    private isComplete = false;
    private hasFatalError = false;

    private options: Required<LoadingScreenOptions>;
    private progress: LoadingScreenProgress;

    // Task text crossfade tracking
    private currentTaskDescription = '';
    private taskChangeTimeout: number | null = null;

    // Track hide version to cancel stale timeout callbacks
    private hideVersion = 0;

    // Callbacks
    private onSkipCallbacks: Set<(phaseId: string) => void> = new Set();
    private onCompleteCallbacks: Set<() => void> = new Set();

    private releaseFocusTrap: (() => void) | null = null;
    private lastFocusedElement: HTMLElement | null = null;

    private isFCP = false;
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

        this.progress = new LoadingScreenProgress({ debug: this.options.debug });

        // Subscribe to LoadingManager
        this.unsubscribeProgress = globalLoadingManager.onProgress((state, tasks) => {
            this.handleManagerProgress(state, tasks);
        });

        if (this.options.debug) {
            console.log('[LoadingScreen] Initialized with options:', this.options);
        }
    }

    // =========================================================================
    private createDOM(): void {
        if (typeof document === 'undefined') return;

        // Try to find the existing Deferred HUD Indicator from index.html
        this.deferredIndicator = document.getElementById('candy-deferred-indicator');
        if (!this.deferredIndicator) {
            this.deferredIndicator = createDeferredIndicator();
        }

        // Check if loading screen already exists in index.html (FCP Optimization)
        this.container = document.getElementById('candy-loading-screen');
        this.overlay = document.getElementById('candy-loading-overlay');

        if (!this.container || !this.overlay) {
            this.isFCP = false;
            const elements = createLoadingScreenDOM(
                {
                    theme: this.options.theme,
                    showEstimatedTime: this.options.showEstimatedTime,
                    allowSkipDeferred: this.options.allowSkipDeferred
                },
                this.progress.getPhases(),
                () => this.skipCurrentPhase()
            );
            this.container = elements.container;
            this.overlay = elements.overlay;
            this.spinner = elements.spinner;
            this.progressBar = elements.progressBar;
            this.progressFill = elements.progressFill;
            this.percentageText = elements.percentageText;
            this.taskText = elements.taskText;
            this.timeText = elements.timeText;
            this.skipButton = elements.skipButton;
        } else {
            this.isFCP = true;
            // FCP Element wiring: Grab references to existing HTML components
            this.spinner = this.container.querySelector('.loading-spinner') as HTMLElement;
            this.progressBar = this.container.querySelector('.progress-bar') as HTMLElement;
            this.progressFill = this.container.querySelector('.progress-fill') as HTMLElement;
            this.percentageText = this.container.querySelector('.progress-percentage') as HTMLElement;
            this.taskText = this.container.querySelector('.progress-task') as HTMLElement;
            this.timeText = this.container.querySelector('.time-remaining') as HTMLElement;
            this.skipButton = this.container.querySelector('.skip-button') as HTMLButtonElement;

            if (this.skipButton) {
                wireSkipButton(this.skipButton, () => this.skipCurrentPhase());
            }
        }

        if (this.options.debug) {
            console.log('[LoadingScreen] DOM created');
        }
    }

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

        yieldToPaint(50).then(() => {
            if (this.container && this.isVisible) {
                this.releaseFocusTrap = trapFocusInside(this.container);
            }
        });

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
            updateSpawnFailureBadge(this.deferredIndicator, failedHint);
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
        this.progress.setPhases(phases);

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
        this.progress.markPhaseNonSkippable(phaseId);
    }

    /**
     * Start a specific loading phase
     */
    startPhase(phaseId: string): void {
        const phase = this.progress.startPhase(phaseId);
        if (!phase) return;

        // Update UI
        this.updateUI(phase);
        this.updatePhaseIndicators();

        // Show skip button for deferred phases that haven't been marked non-skippable
        if (this.skipButton) {
            const showSkip = phase.isDeferred && !phase.nonSkippable && this.options.allowSkipDeferred;
            this.skipButton.style.display = showSkip ? 'block' : 'none';
        }
    }

    /**
     * Update progress within the current phase
     */
    updateProgress(percent: number, taskDescription?: string): void {
        const progress = this.progress.updateProgress(percent, taskDescription);
        const currentPhase = this.progress.getCurrentPhase();

        this.updateUI(currentPhase, progress.taskDescription);
    }

    /**
     * Complete the current phase
     */
    completePhase(phaseId?: string): void {
        const result = this.progress.completePhase(phaseId);
        if (result.shouldHide) {
            this.hide();
        }
    }

    /**
     * Skip the current phase (if deferred)
     */
    skipCurrentPhase(): void {
        const currentPhase = this.progress.getCurrentPhase();
        if (!currentPhase) return;

        const result = this.progress.skipPhase(currentPhase.id);
        if (!result.success) {
            console.warn('[LoadingScreen] Cannot skip non-deferred phase');
            return;
        }

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

        if (this.container) {
            this.container.setAttribute('aria-valuetext', text);
        }
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
    onProgress(callback: (progress: import('./loading-screen-types.ts').LoadingProgress) => void): () => void {
        return this.progress.onProgress(callback);
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
    getProgress(): import('./loading-screen-types.ts').LoadingProgress {
        return this.progress.getProgress();
    }

    /**
     * Get timing statistics
     */
    getTimingStats(): { phaseDurations: Map<string, number>; averagePhaseTime: number } {
        return this.progress.getTimingStats();
    }

    // =========================================================================
    private updateUI(phase?: LoadingPhase, taskDescription?: string): void {
        if (!this.container) return;

        // Update task text
        if (taskDescription) {
            this.setTaskText(taskDescription);
        }

        // Update time remaining
        if (this.timeText && this.options.showEstimatedTime) {
            const remaining = this.progress.calculateEstimatedTimeRemaining();
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

            if (index < this.progress.getCurrentPhaseIndex()) {
                const phaseId = this.progress.getPhases()[index]?.id;
                if (phaseId && this.progress.getSkippedPhases().has(phaseId)) {
                    indicator.classList.add('skipped');
                } else {
                    indicator.classList.add('complete');
                }
            } else if (index === this.progress.getCurrentPhaseIndex()) {
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

        if (this.progress.tick(delta)) {
            this.updateUIVisuals();
        }

        this.animationFrameId = requestAnimationFrame(this.animateProgress);
    }

    private updateUIVisuals(): void {
        if (!this.container) return;

        const displayedOverallProgress = this.progress.getDisplayedOverallProgress();
        const displayedPhaseProgress = this.progress.getDisplayedPhaseProgress();
        const targetOverallProgress = this.progress.getTargetOverallProgress();

        // Update progress bar
        if (this.progressFill) {
            this.progressFill.style.transform = `scaleX(${displayedOverallProgress / 100})`;
            this.progressFill.style.transformOrigin = 'left';
        }

        // Update percentage text
        if (this.percentageText) {
            const isLerping = Math.abs(targetOverallProgress - displayedOverallProgress) > 0.5;
            if (isLerping) {
                this.percentageText.textContent = `${displayedOverallProgress.toFixed(1)}%`;
            } else {
                this.percentageText.textContent = `${Math.round(displayedOverallProgress)}%`;
            }
        }

        // Update ARIA
        this.container.setAttribute('aria-valuenow', Math.round(displayedOverallProgress).toString());

        // Update active phase indicator progress
        const activeIndicator = this.container.querySelector('.phase-indicator.active') as HTMLElement;
        if (activeIndicator) {
            activeIndicator.style.setProperty('--phase-progress', `${displayedPhaseProgress}%`);
        }
    }

    private handleManagerProgress(state: GlobalProgressState, tasks: Map<string, TaskState>): void {
        // Always update the deferred indicator from manager state, even after loading screen hides.
        if (state.deferredTotal > 0) {
            this.setDeferredProgress(
                state.deferredCompleted, state.deferredTotal,
                state.deferredFailed, state.deferredEtaMs
            );
        }

        if (!this.isVisible) return;

        const result = this.progress.handleManagerProgress(state, tasks);
        if (result.taskDescription) {
            this.setTaskText(result.taskDescription);
        }
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
            addFatalErrorReloadButton(this.container);
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
            if (!this.isFCP) {
                this.overlay.parentNode.removeChild(this.overlay);
            }
        }
        if (this.container) {
            this.container.style.display = 'none';
        }

        if (!this.isFCP) {
            this.container = null;
            this.overlay = null;
        }
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

setLoadingScreenClass(LoadingScreen);
