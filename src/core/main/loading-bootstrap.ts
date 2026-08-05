import { initDebugPanelIfNeeded } from '../../debug/index.ts';
import { initializeSaveSystemIntegration } from '../../systems/save-integration-lazy.ts';
import { initAnalyticsDebugIfNeeded } from '../../ui/analytics-debug-lazy.ts';
import { initLoadingScreen, installLegacyAPI } from '../../ui/loading-screen.ts';
import { installPresenceStartScreenUI } from '../../ui/presence-lazy.ts';
import { installSaveMenuGlobals } from '../../ui/save-menu/lazy.ts';
import { enableStartupProfiler } from '../../utils/startup-profiler.ts';
import {
    isCIorHeadless,
    getDeviceMemoryGB,
    getLoadMemoryScale,
    getLoadMemoryTier,
    shouldPreferLightWorldLoad,
    CONFIG,
} from '../config.ts';
import { loadStartupProfile, mapSizeWaitsForFullPopulation } from '../startup-profile.ts';
import type { LoadingScreen } from './context.ts';

export interface LoadingBootstrapResult {
    loadingScreen: LoadingScreen;
    waitForFullPopulation: boolean;
}

export function runLoadingBootstrap(): LoadingBootstrapResult {
    if (CONFIG.safeMode || isCIorHeadless()) {
        console.warn('[Startup] safeMode active (?safe=1) — shader warmup and compute disabled');
        (window as any).__computeDisabled = true;
    }

    const profile = loadStartupProfile();
    (window as any).__startupProfile = profile;
    // Large map implies wait-for-full; URL ?waitForFull still forces it for smoke/debug.
    const waitForFullPopulation =
        new URLSearchParams(location.search).has('waitForFull') ||
        mapSizeWaitsForFullPopulation(profile.mapSize);

    const loadingScreen = initLoadingScreen({ theme: 'candy', showEstimatedTime: true });
    loadingScreen.show();
    installLegacyAPI();

    installPresenceStartScreenUI();

    window.addEventListener('unhandledrejection', (event) => {
        const err = event.reason;
        const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
        console.error('[Bootstrap] Unhandled rejection during startup:', err);
        try {
            loadingScreen.showFatalError(
                `Startup failed: ${msg}\n\nRefresh the page to try again.`
            );
        } catch (_) {
            const fallback =
                document.getElementById('loading-overlay') ??
                document.getElementById('loading-container');
            if (fallback) {
                const p = document.createElement('p');
                p.style.cssText = 'color:red;padding:1rem';
                p.textContent = `Error: ${msg}`;
                const btn = document.createElement('button');
                btn.textContent = 'Reload';
                btn.addEventListener('click', () => window.location.reload());
                p.appendChild(document.createElement('br'));
                p.appendChild(btn);
                fallback.appendChild(p);
            }
        }
    });

    enableStartupProfiler({
        slowPhaseThreshold: 100,
        enableOverlay: false,
        enableConsole: true,
        saveToFile: false,
    });

    {
        const tier = getLoadMemoryTier();
        const gb = getDeviceMemoryGB();
        console.log(
            `[Startup] Memory tier: ${tier}` +
                (typeof gb === 'number' ? ` (~${gb} GB deviceMemory)` : '') +
                ` · population scale=${getLoadMemoryScale().toFixed(2)}` +
                (shouldPreferLightWorldLoad() ? ' · preferring lighter Full-mode population' : '')
        );
        console.log(
            `[Startup] Profile: graphics=${profile.graphics} map=${profile.mapSize}` +
                (waitForFullPopulation ? ' · wait-for-full' : '')
        );
    }

    initDebugPanelIfNeeded();
    void import('../../foliage/batcher-telemetry.ts').then((m) => m.installBatcherTelemetry());
    installSaveMenuGlobals();
    void initAnalyticsDebugIfNeeded();
    initializeSaveSystemIntegration();

    return { loadingScreen, waitForFullPopulation };
}
