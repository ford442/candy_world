import { LoadingScreen } from './loading-screen-ui';
import { LoadingScreenOptions } from './loading-screen-types';

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

    if (!globalLoadingScreen) {
        globalLoadingScreen = new LoadingScreen(options);
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
    if (!globalLoadingScreen) {
        globalLoadingScreen = new LoadingScreen({ debug: debugEnabled });
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
export function setDeferredProgress(completed: number, total: number): void {
    globalLoadingScreen?.setDeferredProgress(completed, total);
}

/**
 * Set deferred spawn failure count badge
 */
export function setDeferredFailures(failed: number): void {
    globalLoadingScreen?.setDeferredFailures(failed);
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
        globalLoadingScreen = new LoadingScreen({ debug: debugEnabled });
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
        globalLoadingScreen = new LoadingScreen({ debug: debugEnabled });
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

// Auto-install on import if in browser
if (typeof window !== 'undefined') {
    installLegacyAPI();
}
