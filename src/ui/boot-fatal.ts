/**
 * @file boot-fatal.ts
 * @description Shared "boot has failed" state, so only one fatal message is shown.
 *
 * Several paths can report the same startup failure: the scene pipeline, the
 * top-level bootstrap catch and the `unhandledrejection` safety net. The first
 * one to report it marks boot as fatal. The others only log.
 */

let bootFatal = false;

/** True once any fatal startup error has been shown to the user. */
export function isBootFatal(): boolean {
    return bootFatal;
}

/**
 * Mark boot as failed and take down the loading UI that would otherwise keep
 * spinning behind the error ("Loading World...", "Populating...").
 *
 * @returns true for the first caller, false if boot was already marked fatal.
 */
export function markBootFatal(): boolean {
    if (bootFatal) return false;
    bootFatal = true;
    hideBootLoadingUI();
    return true;
}

/** Hide the start-button spinner, readiness bar and deferred "Populating..." pill. */
export function hideBootLoadingUI(): void {
    if (typeof document === 'undefined') return;

    const start = document.getElementById('startButton') as HTMLButtonElement | null;
    if (start) {
        start.disabled = true;
        start.removeAttribute('aria-busy');
        start.textContent = 'Unavailable';
        start.title = 'Candy World could not start on this browser/device';
    }

    document.getElementById('readiness-progress')?.setAttribute('hidden', '');

    const deferred = document.getElementById('candy-deferred-indicator');
    if (deferred) deferred.style.display = 'none';
}
