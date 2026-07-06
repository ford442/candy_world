import type { LoadingScreen } from './loading-screen-ui.ts';
import { LoadingPhase, LoadingProgress, LoadingScreenOptions, DEFAULT_LOADING_PHASES } from './loading-screen-types.ts';
import { globalLoadingManager, GlobalProgressState, TaskState } from '../systems/loading-manager.ts';

let LoadingScreenCtor: typeof LoadingScreen | null = null;

/**
 * Register the concrete LoadingScreen class so the singleton API below can
 * instantiate it. This avoids a circular runtime dependency between the UI
 * class and the progress/state module.
 */
export function setLoadingScreenClass(ctor: typeof LoadingScreen): void {
    LoadingScreenCtor = ctor;
}

/**
 * Progress/state manager for the loading screen. Holds phase list, progress
 * interpolation, skip tracking, and LoadingManager integration so the UI class
 * can focus on DOM rendering.
 */
export class LoadingScreenProgress {
    private phases: LoadingPhase[] = [];
    private currentPhaseIndex = -1;
    private phaseProgress = 0;
    private targetOverallProgress = 0;
    private displayedOverallProgress = 0;
    private displayedPhaseProgress = 0;
    private skippedPhases: Set<string> = new Set();
    private phaseStartTime = 0;
    private phaseDurations: Map<string, number> = new Map();
    private averagePhaseTime = 0;
    private onProgressCallbacks: Set<(progress: LoadingProgress) => void> = new Set();

    constructor(private options: Pick<LoadingScreenOptions, 'debug'> = {}) {
        this.setPhases([...DEFAULT_LOADING_PHASES]);
    }

    getPhases(): LoadingPhase[] { return this.phases; }
    getCurrentPhaseIndex(): number { return this.currentPhaseIndex; }
    getCurrentPhase(): LoadingPhase | undefined { return this.phases[this.currentPhaseIndex]; }
    getPhaseProgress(): number { return this.phaseProgress; }
    getTargetOverallProgress(): number { return this.targetOverallProgress; }
    getDisplayedOverallProgress(): number { return this.displayedOverallProgress; }
    getDisplayedPhaseProgress(): number { return this.displayedPhaseProgress; }
    getSkippedPhases(): Set<string> { return this.skippedPhases; }

    setPhases(phases: LoadingPhase[]): void {
        this.phases = [...phases];
        this.currentPhaseIndex = -1;

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

        if (this.options.debug) {
            console.log('[LoadingScreen] Phases registered:', this.phases.map(p => p.id));
        }
    }

    markPhaseNonSkippable(phaseId: string): void {
        const phase = this.phases.find(p => p.id === phaseId);
        if (phase) phase.nonSkippable = true;
    }

    startPhase(phaseId: string): LoadingPhase | undefined {
        const phaseIndex = this.phases.findIndex(p => p.id === phaseId);
        if (phaseIndex === -1) {
            console.warn(`[LoadingScreen] Unknown phase: ${phaseId}`);
            return undefined;
        }

        this.currentPhaseIndex = phaseIndex;
        this.phaseProgress = 0;
        this.displayedPhaseProgress = 0;
        this.phaseStartTime = Date.now();

        const phase = this.phases[phaseIndex];
        phase.onStart?.();

        if (this.options.debug) {
            console.log(`[LoadingScreen] Phase started: ${phase.name}`);
        }

        return phase;
    }

    updateProgress(percent: number, taskDescription?: string): LoadingProgress {
        this.phaseProgress = Math.max(0, Math.min(100, percent));

        const currentPhase = this.phases[this.currentPhaseIndex];
        const description = taskDescription || currentPhase?.description || 'Loading...';

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
        return progress;
    }

    completePhase(phaseId?: string): { phase?: LoadingPhase; shouldHide: boolean; duration?: number } {
        const targetPhaseId = phaseId || this.phases[this.currentPhaseIndex]?.id;
        if (!targetPhaseId) return { shouldHide: false };

        const phase = this.phases.find(p => p.id === targetPhaseId);
        let duration: number | undefined;
        if (phase) {
            // Record phase duration
            duration = Date.now() - this.phaseStartTime;
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
        const shouldHide = globalLoadingManager.getOverallProgress() >= 99 || isLastPhase || !!currentPhaseIsDeferred;

        return { phase, shouldHide, duration };
    }

    skipPhase(phaseId: string): { success: boolean; phase?: LoadingPhase } {
        const phase = this.phases.find(p => p.id === phaseId);
        if (!phase?.isDeferred) {
            return { success: false };
        }

        this.skippedPhases.add(phaseId);
        return { success: true, phase };
    }

    onProgress(callback: (progress: LoadingProgress) => void): () => void {
        this.onProgressCallbacks.add(callback);
        return () => this.onProgressCallbacks.delete(callback);
    }

    handleManagerProgress(state: GlobalProgressState, tasks: Map<string, TaskState>): { taskDescription?: string } {
        this.targetOverallProgress = state.overallPercent;

        let taskDescription: string | undefined;
        if (state.activeTaskId) {
            const activeTask = tasks.get(state.activeTaskId);
            if (activeTask) {
                this.phaseProgress = activeTask.percentComplete;
                if (state.activeTaskDescription) {
                    taskDescription = state.activeTaskDescription;
                }
            }
        }

        return { taskDescription };
    }

    /**
     * Advance the interpolated progress values toward their targets.
     * @returns true when the visual layer should repaint.
     */
    tick(deltaSeconds: number): boolean {
        let needsVisualUpdate = false;

        // Dampen the displayed phase progress towards target
        const phaseDiff = this.phaseProgress - this.displayedPhaseProgress;
        if (Math.abs(phaseDiff) > 0.1) {
            this.displayedPhaseProgress += phaseDiff * (1.0 - Math.exp(-5.0 * deltaSeconds));
            needsVisualUpdate = true;
        } else if (this.displayedPhaseProgress !== this.phaseProgress) {
            this.displayedPhaseProgress = this.phaseProgress;
            needsVisualUpdate = true;
        }

        // Dampen the displayed overall progress towards the target
        const diff = this.targetOverallProgress - this.displayedOverallProgress;
        if (Math.abs(diff) > 0.1) {
            this.displayedOverallProgress += diff * (1.0 - Math.exp(-5.0 * deltaSeconds));
            needsVisualUpdate = true;
        } else if (this.displayedOverallProgress !== this.targetOverallProgress) {
            this.displayedOverallProgress = this.targetOverallProgress;
            needsVisualUpdate = true;
        }

        return needsVisualUpdate;
    }

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

    getTimingStats(): { phaseDurations: Map<string, number>; averagePhaseTime: number } {
        return {
            phaseDurations: new Map(this.phaseDurations),
            averagePhaseTime: this.averagePhaseTime
        };
    }

    calculateEstimatedTimeRemaining(): number {
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
}

// =============================================================================
// SINGLETON INSTANCE & GLOBAL API
// =============================================================================

let globalLoadingScreen: LoadingScreen | null = null;
let debugEnabled = false;

/**
 * Initialize the global loading screen
 */
export function initLoadingScreen(options?: LoadingScreenOptions): LoadingScreen {
    if (options?.debug !== undefined) {
        debugEnabled = options.debug;
    }

    if (!LoadingScreenCtor) {
        throw new Error('[LoadingScreen] LoadingScreen class has not been registered. Ensure loading-screen-ui.ts is imported before calling initLoadingScreen().');
    }

    if (!globalLoadingScreen) {
        globalLoadingScreen = new LoadingScreenCtor(options);
    }
    return globalLoadingScreen;
}

/**
 * Get the global loading screen instance
 */
export function getLoadingScreen(): LoadingScreen | null {
    return globalLoadingScreen;
}

/**
 * Show the loading screen
 */
export function showLoadingScreen(): void {
    if (!LoadingScreenCtor) {
        throw new Error('[LoadingScreen] LoadingScreen class has not been registered.');
    }

    if (!globalLoadingScreen) {
        globalLoadingScreen = new LoadingScreenCtor({ debug: debugEnabled });
    }
    globalLoadingScreen.show();
}

/**
 * Show the deferred indicator
 */
export function showDeferredIndicator(): void {
    globalLoadingScreen?.showDeferredIndicator();
}

/**
 * Hide the deferred indicator
 */
export function hideDeferredIndicator(): void {
    globalLoadingScreen?.hideDeferredIndicator();
}

/**
 * Set progress on the deferred indicator
 */
export function setDeferredProgress(completed: number, total: number, failed?: number, etaMs?: number): void {
    globalLoadingScreen?.setDeferredProgress(completed, total, failed, etaMs);
}

/**
 * Hide the loading screen
 */
export function hideLoadingScreen(): void {
    globalLoadingScreen?.hide();
}

/**
 * Update progress for a specific phase
 */
export function updateProgress(phaseId: string, percent: number, taskDescription?: string): void {
    if (!globalLoadingScreen) {
        globalLoadingScreen = initLoadingScreen({ debug: debugEnabled });
    }

    // Auto-start phase if different from current
    const currentPhase = globalLoadingScreen.getProgress().phase;
    if (currentPhase !== phaseId) {
        globalLoadingScreen.startPhase(phaseId);
    }

    globalLoadingScreen.updateProgress(percent, taskDescription);
}

/**
 * Set loading status text (legacy compatibility)
 */
export function setLoadingStatus(text: string): void {
    if (!globalLoadingScreen) {
        globalLoadingScreen = initLoadingScreen({ debug: debugEnabled });
        globalLoadingScreen.show();
    }
    globalLoadingScreen.setStatus(text);
}

/**
 * Complete the current phase
 */
export function completePhase(phaseId?: string): void {
    globalLoadingScreen?.completePhase(phaseId);
}

/**
 * Enable/disable debug mode
 */
export function setLoadingDebug(enabled: boolean): void {
    debugEnabled = enabled;
    if (globalLoadingScreen) {
        // @ts-ignore - accessing private for debug
        globalLoadingScreen.options.debug = enabled;
    }
}

/**
 * Display a WASM loading phase message on the loading screen.
 * Automatically activates the 'wasm-init' phase if it is not already active.
 * @param label Human-readable status (e.g. "Booting Physics Engine… (Attempt 1/3)")
 * @param progress Optional progress value 0–100 within the phase
 */
export function setWasmPhase(label: string, progress?: number): void {
    if (!globalLoadingScreen) return;
    const current = globalLoadingScreen.getProgress();
    if (current.phase !== 'wasm-init') {
        globalLoadingScreen.startPhase('wasm-init');
    }
    globalLoadingScreen.updateProgress(progress ?? 0, label);
}

/**
 * Display a fatal WASM error on the loading screen.
 * Stops the spinner, turns the progress bar red, and shows a user-visible error
 * with a reload button so the player has a clear recovery path.
 * @param message Human-readable error description shown to the user
 */
export function setWasmError(message: string): void {
    if (!globalLoadingScreen) return;
    globalLoadingScreen.showFatalError(message);
}

// =============================================================================
// LEGACY WINDOW API COMPATIBILITY
// =============================================================================

/**
 * Install legacy window API for backwards compatibility
 */
export function installLegacyAPI(): void {
    if (typeof window === 'undefined') return;

    window.setLoadingStatus = setLoadingStatus;
    window.hideLoadingScreen = hideLoadingScreen;
    window.showLoadingScreen = showLoadingScreen;
    window.updateLoadingProgress = updateProgress;

    // Also update the initial HTML progress bar for smooth pre-JS feedback
    const origSetLoadingProgress = window.setLoadingProgress;
    window.setLoadingProgress = (percent: number) => {
        // Forward to the HTML progress bar if it still exists
        if (origSetLoadingProgress) origSetLoadingProgress(percent);
        // Also update the LoadingScreen's own progress
        if (globalLoadingScreen) {
            globalLoadingScreen.updateProgress(percent);
        }
    };

    if (debugEnabled) {
        console.log('[LoadingScreen] Legacy window API installed');
    }
}
