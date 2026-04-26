/**
 * Loading Screen and Progress Tracking System for Candy World
 * 
 * Features:
 * - Visual progress bar with percentage
 * - Current task description
 * - Estimated time remaining
 * - Cancel/Skip button for non-critical deferred loads
 * - Fade-out transition when complete
 * - Integration with all loading phases
 * - Debug toggle
 */

import { trapFocusInside } from '../utils/interaction-utils';
import './loading-screen.css';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface LoadingPhase {
    id: string;
    name: string;
    weight: number; // Relative time cost (0-1)
    description: string;
    isDeferred?: boolean; // Can be skipped/cancelled
    onStart?: () => void;
    onComplete?: () => void;
}

export interface LoadingProgress {
    phase: string;
    phaseIndex: number;
    totalPhases: number;
    percent: number; // 0-100 within phase
    overallPercent: number; // 0-100 overall
    taskDescription: string;
    estimatedTimeRemaining: number; // in seconds
}

export interface LoadingScreenOptions {
    debug?: boolean;
    showEstimatedTime?: boolean;
    allowSkipDeferred?: boolean;
    fadeOutDuration?: number;
    theme?: 'candy' | 'dark' | 'minimal';
}

// =============================================================================
// DEFAULT LOADING PHASES
// =============================================================================

export const DEFAULT_LOADING_PHASES: LoadingPhase[] = [
    {
        id: 'core-scene',
        name: 'Scene Setup',
        weight: 0.10,
        description: 'Initializing 3D renderer and scene...',
        onStart: () => console.log('[Loading] Starting Core Scene Setup'),
        onComplete: () => console.log('[Loading] Core Scene Setup complete')
    },
    {
        id: 'audio-init',
        name: 'Audio System',
        weight: 0.10,
        description: 'Starting audio worklet and effects...',
        onStart: () => console.log('[Loading] Starting Audio System Init'),
        onComplete: () => console.log('[Loading] Audio System Init complete')
    },
    {
        id: 'world-generation',
        name: 'World Build',
        weight: 0.25,
        description: 'Growing procedural flora and terrain...',
        onStart: () => console.log('[Loading] Starting World Generation'),
        onComplete: () => console.log('[Loading] World Generation complete')
    },
    {
        id: 'wasm-init',
        name: 'Physics Engine',
        weight: 0.25,
        description: 'Loading physics engine and native modules...',
        onStart: () => console.log('[Loading] Starting WASM Initialization'),
        onComplete: () => console.log('[Loading] WASM Initialization complete')
    },
    {
        id: 'shader-warmup',
        name: 'Shader Warmup',
        weight: 0.15,
        description: 'Pre-compiling shaders for smooth gameplay...',
        onStart: () => console.log('[Loading] Starting Shader Warmup'),
        onComplete: () => console.log('[Loading] Shader Warmup complete')
    },
    {
        id: 'map-generation',
        name: 'Map Generation',
        weight: 0.15,
        description: 'Generating world map and placing entities...',
        onStart: () => console.log('[Loading] Starting Map Generation'),
        onComplete: () => console.log('[Loading] Map Generation complete')
    }
];

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
    private releaseFocusTrap: (() => void) | null = null;
    private lastFocusedElement: HTMLElement | null = null;
    private timeText: HTMLElement | null = null;
    private skipButton: HTMLButtonElement | null = null;
    private spinner: HTMLElement | null = null;
    
    private phases: LoadingPhase[] = [];
    private currentPhaseIndex = -1;
    private phaseProgress = 0;
    private targetOverallProgress = 0;
    private displayedOverallProgress = 0;
    private animationFrameId: number | null = null;
    private lastTime: number = 0;
    
    private isVisible = false;
    private isComplete = false;
    private skippedPhases: Set<string> = new Set();
    
    private options: Required<LoadingScreenOptions>;
    
    // Timing tracking
    private phaseStartTime = 0;
    private phaseDurations: Map<string, number> = new Map();
    private averagePhaseTime = 0;
    
    // Track hide version to cancel stale timeout callbacks
    private hideVersion = 0;
    
    // Callbacks
    private onSkipCallbacks: Set<(phaseId: string) => void> = new Set();
    private onCompleteCallbacks: Set<() => void> = new Set();
    private onProgressCallbacks: Set<(progress: LoadingProgress) => void> = new Set();

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
        
        if (this.options.debug) {
            console.log('[LoadingScreen] Initialized with options:', this.options);
        }
    }

    // =========================================================================
    // DOM CREATION
    // =========================================================================

    private createDOM(): void {
        if (typeof document === 'undefined') return;
        
        // Check if already exists
        if (document.getElementById('candy-loading-screen')) {
            this.container = document.getElementById('candy-loading-screen');
            return;
        }

        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.id = 'candy-loading-overlay';
        this.overlay.className = `loading-overlay theme-${this.options.theme}`;
        this.overlay.setAttribute('role', 'dialog');
        this.overlay.setAttribute('aria-modal', 'true');

        // Create main container
        this.container = document.createElement('div');
        this.container.id = 'candy-loading-screen';
        this.container.className = `loading-screen theme-${this.options.theme}`;
        this.container.setAttribute('role', 'progressbar');
        this.container.setAttribute('aria-valuemin', '0');
        this.container.setAttribute('aria-valuemax', '100');
        this.container.setAttribute('aria-valuenow', '0');
        this.container.setAttribute('aria-label', 'Game loading progress');

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
        this.progressFill.style.width = '0%';
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
        
        // Trigger reflow for animation
        requestAnimationFrame(() => {
            if (this.overlay) {
                this.overlay.classList.add('visible');
            }
            if (this.container) {
                this.container.classList.add('visible');
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
     * Hide the loading screen with fade-out animation
     */
    hide(): void {
        if (!this.isVisible || this.isComplete) return;
        
        this.isComplete = true;

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.container) {
            this.container.classList.add('complete');
            this.container.setAttribute('aria-valuenow', '100');
        }
        if (this.progressFill) {
            this.progressFill.style.width = '100%';
        }
        if (this.percentageText) {
            this.percentageText.textContent = '100%';
        }
        if (this.taskText) {
            this.taskText.textContent = 'Ready!';
        }

        const currentHideVersion = this.hideVersion;
        
        setTimeout(() => {
            // Guard: don't proceed if show() was called again (version changed)
            if (this.hideVersion !== currentHideVersion) return;
            
            if (this.overlay) {
                this.overlay.classList.remove('visible');
            }
            if (this.container) {
                this.container.classList.remove('visible');
            }

            setTimeout(() => {
                // Guard: don't destroy if show() was called again in the meantime
                if (this.hideVersion === currentHideVersion && this.isComplete) {
                    if (this.releaseFocusTrap) {
                        this.releaseFocusTrap();
                        this.releaseFocusTrap = null;
                    }
                    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
                        this.lastFocusedElement.focus();
                        this.lastFocusedElement = null;
                    }
                    this.destroy();
                    this.isVisible = false;
                    this.onCompleteCallbacks.forEach(cb => cb());
                }
            }, this.options.fadeOutDuration);
        }, 300);

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
        this.phaseStartTime = Date.now();

        const phase = this.phases[phaseIndex];
        
        // Call phase start callback
        phase.onStart?.();

        // Update UI
        this.updateUI(phase);
        this.updatePhaseIndicators();

        // Show skip button for deferred phases
        if (this.skipButton) {
            this.skipButton.style.display = phase.isDeferred ? 'block' : 'none';
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
        
        this.calculateOverallProgress();
        
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

        // If this was the last phase, auto-hide
        if (this.currentPhaseIndex >= this.phases.length - 1) {
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

        this.completePhase(currentPhase.id);
    }

    /**
     * Set loading status (legacy compatibility)
     */
    setStatus(text: string): void {
        if (this.taskText) {
            this.taskText.textContent = text;
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
        if (this.taskText && taskDescription) {
            this.taskText.textContent = taskDescription;
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
        if (!this.isVisible || this.isComplete) {
            this.animationFrameId = null;
            return;
        }

        const delta = Math.min((time - this.lastTime) / 1000, 0.1); // clamp delta
        this.lastTime = time;

        // Dampen the displayed progress towards the target
        const diff = this.targetOverallProgress - this.displayedOverallProgress;
        if (Math.abs(diff) > 0.1) {
            // Lerp factor
            this.displayedOverallProgress += diff * (1.0 - Math.exp(-5.0 * delta));

            // Re-render UI with new displayed progress
            this.updateUIVisuals();
        } else if (this.displayedOverallProgress !== this.targetOverallProgress) {
            this.displayedOverallProgress = this.targetOverallProgress;
            this.updateUIVisuals();
        }

        this.animationFrameId = requestAnimationFrame(this.animateProgress);
    }

    private updateUIVisuals(): void {
        if (!this.container) return;

        // Update progress bar
        if (this.progressFill) {
            this.progressFill.style.width = `${this.displayedOverallProgress}%`;
        }

        // Update percentage text
        if (this.percentageText) {
            this.percentageText.textContent = `${Math.round(this.displayedOverallProgress)}%`;
        }

        // Update ARIA
        this.container.setAttribute('aria-valuenow', Math.round(this.displayedOverallProgress).toString());
    }

    private calculateOverallProgress(): void {
        if (this.currentPhaseIndex < 0) {
            this.targetOverallProgress = 0;
            return;
        }

        // Calculate weighted progress
        let completedWeight = 0;
        for (let i = 0; i < this.currentPhaseIndex; i++) {
            const phaseId = this.phases[i]?.id;
            // Skipped phases count as half weight
            const weight = (phaseId && this.skippedPhases.has(phaseId)) 
                ? this.phases[i].weight * 0.5 
                : this.phases[i].weight;
            completedWeight += weight;
        }

        // Current phase progress
        const currentPhase = this.phases[this.currentPhaseIndex];
        if (currentPhase) {
            const currentWeight = currentPhase.weight * (this.phaseProgress / 100);
            completedWeight += currentWeight;
        }

        // Normalize to 0-100
        const totalWeight = this.phases.reduce((sum, p) => sum + p.weight, 0);
        this.targetOverallProgress = (completedWeight / totalWeight) * 100;
    }

    private calculateEstimatedTimeRemaining(): number {
        if (this.averagePhaseTime === 0 || this.currentPhaseIndex < 0) {
            return -1;
        }

        const remainingPhases = this.phases.slice(this.currentPhaseIndex + 1);
        let estimatedMs = 0;

        for (const phase of remainingPhases) {
            const historicalTime = this.phaseDurations.get(phase.id);
            const estimatedTime = historicalTime || this.averagePhaseTime * phase.weight;
            estimatedMs += estimatedTime;
        }

        // Add remaining time for current phase
        const currentPhaseTime = Date.now() - this.phaseStartTime;
        const currentPhaseHistorical = this.phaseDurations.get(this.phases[this.currentPhaseIndex]?.id || '');
        const currentPhaseExpected = currentPhaseHistorical || this.averagePhaseTime * (this.phases[this.currentPhaseIndex]?.weight || 0.1);
        estimatedMs += Math.max(0, currentPhaseExpected - currentPhaseTime);

        return Math.ceil(estimatedMs / 1000);
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

    private destroy(): void {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
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

// Default export
export default LoadingScreen;
