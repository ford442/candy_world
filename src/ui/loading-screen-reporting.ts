import { log } from '../utils/log.ts';
import { showToast } from '../utils/toast.ts';
import { getReport } from '../world/spawn-tracker.ts';

/**
 * Surface the spawn tracker's report: a toast with the per-type summary and a
 * console group with the most recent errors. Shared by the badge and the
 * end-of-population handler (the badge is gone once the indicator hides).
 */
export function showSpawnFailureReport(): void {
    try {
        const r = getReport();
        const summary = `Spawn failures: ${r.failed}/${r.attempted} (succeeded ${r.succeeded}). By type: ${
            Object.entries(r.failuresByType)
                .map(([k, v]) => k + ':' + v)
                .join(', ') || 'n/a'
        }`;
        console.group(`[SpawnTracker] ${r.failed} spawn failure(s)`);
        console.table(r.failuresByType);
        for (const e of r.lastErrors) console.warn(`${e.type}: ${e.message}`);
        console.groupEnd();
        showToast(summary + ' — see console for full list', '⚠️', 6000);
    } catch (e) {
        log.warn('Deferred', 'failed to show spawn report', e);
    }
}

/**
 * Wire the deferred indicator's spawn-failure badge once, then update its
 * visibility and count from the spawn tracker on subsequent calls.
 */
export function updateSpawnFailureBadge(indicator: HTMLElement): void {
    const failedCount = getReport().failed;
    const failEl = indicator.querySelector('.deferred-fail') as HTMLElement | null;
    const failCountEl = indicator.querySelector('.fail-count') as HTMLElement | null;
    if (!failEl || !failCountEl) return;

    if (failedCount > 0) {
        failCountEl.textContent = `${failedCount} failed`;
        failEl.style.display = 'inline';
        failEl.setAttribute('aria-hidden', 'false');
        failEl.setAttribute(
            'title',
            `${failedCount} object(s) failed to spawn — click for details`
        );

        if (!(failEl as any)._spawnClickWired) {
            (failEl as any)._spawnClickWired = true;
            const handleActivate = (ev: Event) => {
                ev.stopPropagation();
                showSpawnFailureReport();
            };
            failEl.addEventListener('click', handleActivate);
            failEl.addEventListener('keydown', (ev: KeyboardEvent) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    handleActivate(ev);
                }
            });
        }
    } else {
        failEl.style.display = 'none';
        failEl.setAttribute('aria-hidden', 'true');
    }
}
