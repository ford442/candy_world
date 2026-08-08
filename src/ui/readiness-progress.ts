/**
 * Readiness progress — mini bar under the start button showing progress toward
 * "fully ready" (playable + deferred horizon population).
 *
 * Driven by explicit reportReadinessProgress calls during map generation and by
 * globalLoadingManager deferred progress afterward.
 */

import { globalLoadingManager, type GlobalProgressState } from '../systems/loading-manager.ts';

export type ReadinessMilestone = 'idle' | 'generating' | 'playable' | 'populating' | 'ready';

let unsub: (() => void) | null = null;
let milestone: ReadinessMilestone = 'idle';
let fullyPopulatedHandler: (() => void) | null = null;

function els() {
    return {
        root: document.getElementById('readiness-progress'),
        fill: document.getElementById('readiness-progress-fill'),
        label: document.getElementById('readiness-progress-label'),
        eta: document.getElementById('readiness-progress-eta'),
    };
}

function formatEta(sec: number): string {
    if (sec < 0) return 'Calculating…';
    if (sec <= 2) return 'Almost there…';
    if (sec < 60) return `~${Math.ceil(sec)}s until fully ready`;
    const m = Math.floor(sec / 60);
    const s = Math.ceil(sec % 60);
    return s > 0 ? `~${m}m ${s}s until fully ready` : `~${m}m until fully ready`;
}

function setVisible(visible: boolean): void {
    const { root } = els();
    if (!root) return;
    root.hidden = !visible;
    root.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function render(percent: number, task: string, etaSec: number): void {
    const { root, fill, label, eta } = els();
    if (!root) return;

    const clamped = Math.max(0, Math.min(100, percent));
    if (fill) {
        fill.style.transform = `scaleX(${clamped / 100})`;
    }
    root.setAttribute('aria-valuenow', String(Math.round(clamped)));
    root.setAttribute('aria-valuetext', `${Math.round(clamped)}% — ${task}`);

    if (label) label.textContent = task;
    if (eta) eta.textContent = milestone === 'ready' ? 'Fully ready' : formatEta(etaSec);
}

/**
 * Direct progress feed during map generation (0–100 maps onto 0–70 overall).
 */
export function reportReadinessProgress(
    phasePercent: number,
    task: string,
    etaSec: number = -1
): void {
    if (milestone !== 'generating') return;
    const overall = Math.min(70, Math.max(2, (phasePercent / 100) * 70));
    render(overall, task, etaSec);
}

function handleManagerProgress(state: GlobalProgressState): void {
    if (milestone === 'idle' || milestone === 'ready' || milestone === 'generating') return;

    // playable / populating — use deferred horizon progress when available
    if (state.deferredTotal > 0) {
        const deferredPct = state.deferredPercent;
        const overall = 70 + deferredPct * 0.3;
        const etaSec =
            state.deferredEtaMs >= 0 ? state.deferredEtaMs / 1000 : state.estimatedTimeRemaining;
        const fail = state.deferredFailed > 0 ? ` (${state.deferredFailed} failed)` : '';
        render(
            overall,
            `Horizon loading ${state.deferredCompleted}/${state.deferredTotal}${fail}`,
            etaSec
        );
        return;
    }

    render(75, 'World playable — finishing scenery…', state.estimatedTimeRemaining);
}

export function showReadinessGenerating(hint?: string): void {
    milestone = 'generating';
    setVisible(true);
    render(2, hint || 'Generating world…', -1);
    ensureSubscribed();
}

export function markReadinessPlayable(): void {
    if (milestone === 'ready') return;
    milestone = 'populating';
    setVisible(true);
    render(70, 'Playable — loading horizon…', -1);
    ensureSubscribed();
}

export function markReadinessReady(): void {
    milestone = 'ready';
    render(100, 'Fully ready', 0);
    window.setTimeout(() => {
        if (milestone === 'ready') setVisible(false);
    }, 1800);
}

export function hideReadinessProgress(): void {
    milestone = 'idle';
    setVisible(false);
}

export function getReadinessMilestone(): ReadinessMilestone {
    return milestone;
}

function ensureSubscribed(): void {
    if (!unsub) {
        unsub = globalLoadingManager.onProgress((state) => {
            handleManagerProgress(state);
        });
    }

    if (!fullyPopulatedHandler) {
        fullyPopulatedHandler = () => {
            markReadinessReady();
        };
        document.addEventListener('worldFullyPopulated', fullyPopulatedHandler);
    }
}

/** Install once at start-screen setup. Safe to call repeatedly. */
export function installReadinessProgress(): void {
    ensureSubscribed();
    setVisible(false);
}
