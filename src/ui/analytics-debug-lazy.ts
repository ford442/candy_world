/**
 * Lazy analytics-debug entry — only loaded for `?debug=1` / `/stats` (#1361).
 */
export async function loadAnalyticsDebug(): Promise<typeof import('./analytics-debug.ts')> {
    return import('./analytics-debug.ts');
}

/** Prefetch + register `/stats` when debug mode is on. */
export async function initAnalyticsDebugIfNeeded(): Promise<void> {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const debugOn = params.get('debug') === '1' || params.get('debug') === 'true';
    if (!debugOn) {
        // Still expose a console stub that loads on demand
        (window as any).toggleAnalyticsDebug = async () => {
            const m = await loadAnalyticsDebug();
            m.toggleAnalyticsDebug();
        };
        return;
    }
    const m = await loadAnalyticsDebug();
    m.registerStatsCommand();
}
