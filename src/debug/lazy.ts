/**
 * Lazy debug panel loader — heavy panel UI only for ?debug=1 (#1361 follow-up).
 */
import { DEBUG_CONFIG } from './stages.ts';

/** Load and mount the stage-toggle debug panel when ?debug=1 is present. */
export function initDebugPanelIfNeeded(): void {
    if (!DEBUG_CONFIG.enabled) return;
    void import('./panel.ts').then((m) => m.initDebugPanel());
}
