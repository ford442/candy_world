export function isCIorHeadless(): boolean {
    return (
        (typeof navigator !== 'undefined' &&
            /headless|playwright|ci|test/i.test(navigator.userAgent || '')) ||
        (typeof window !== 'undefined' && (window as any).__IS_FULL_BOOT_TEST === true) ||
        (typeof localStorage !== 'undefined' &&
            localStorage.getItem('__IS_FULL_BOOT_TEST') === 'true') ||
        (typeof navigator !== 'undefined' && (navigator as any).webdriver === true)
    );
}

/**
 * Approximate device RAM in GB via `navigator.deviceMemory` (Chrome/Edge).
 * Returns `undefined` when the API is unavailable (Firefox, Safari, etc.).
 */
export function getDeviceMemoryGB(): number | undefined {
    if (typeof navigator === 'undefined') return undefined;
    const gb = (navigator as any).deviceMemory;
    return typeof gb === 'number' && gb > 0 ? gb : undefined;
}

/**
 * JS heap usage ratio when `performance.memory` is available (Chromium).
 * Returns 0 when unavailable so callers can treat it as "unknown / fine".
 */
export function getJsHeapUsageRatio(): number {
    try {
        if (typeof performance === 'undefined') return 0;
        const mem = (performance as any).memory;
        if (!mem || !mem.jsHeapSizeLimit) return 0;
        return mem.usedJSHeapSize / mem.jsHeapSizeLimit;
    } catch {
        return 0;
    }
}

export type LoadMemoryTier = 'critical' | 'low' | 'medium' | 'high';

/**
 * Coarse RAM tier used to scale world population and batcher caps on load.
 * Prefers `navigator.deviceMemory`; falls back to JS heap pressure when present.
 */
export function getLoadMemoryTier(): LoadMemoryTier {
    const gb = getDeviceMemoryGB();
    if (typeof gb === 'number') {
        if (gb <= 2) return 'critical';
        if (gb <= 4) return 'low';
        if (gb <= 8) return 'medium';
        return 'high';
    }
    const heapRatio = getJsHeapUsageRatio();
    if (heapRatio >= 0.75) return 'critical';
    if (heapRatio >= 0.55) return 'low';
    if (heapRatio >= 0.35) return 'medium';
    return 'high';
}

/**
 * Multiplier applied to spawn counts / batcher caps for the current device.
 * 1.0 = full fidelity; lower values reduce RAM spikes during load.
 */
export function getLoadMemoryScale(): number {
    const tier = getLoadMemoryTier();
    switch (tier) {
        case 'critical':
            return 0.35;
        case 'low':
            return 0.55;
        case 'medium':
            return 0.8;
        default:
            return 1.0;
    }
}

/** True when the device should prefer lighter world modes on first paint. */
export function shouldPreferLightWorldLoad(): boolean {
    const tier = getLoadMemoryTier();
    return tier === 'critical' || tier === 'low';
}

/**
 * Returns a CI/headless- or memory-adjusted count.
 * - CI/headless: aggressive reduction to prevent Playwright OOM.
 * - Consumer browsers: scales by `getLoadMemoryScale()` so low-RAM Windows
 *   machines do not lock up during Full-mode population.
 */
export function getCIAdjustedCount(fullCount: number, ciMultiplier = 0.15, minCount = 5): number {
    if (isCIorHeadless()) {
        const adjusted = Math.max(minCount, Math.floor(fullCount * ciMultiplier));
        console.log(`[CI Adjusted] ${fullCount} → ${adjusted} (multiplier: ${ciMultiplier})`);
        return adjusted;
    }
    const memScale = getLoadMemoryScale();
    if (memScale < 1) {
        const adjusted = Math.max(minCount, Math.floor(fullCount * memScale));
        if (adjusted !== fullCount) {
            console.log(
                `[Memory Adjusted] ${fullCount} → ${adjusted} (tier: ${getLoadMemoryTier()}, scale: ${memScale})`
            );
        }
        return adjusted;
    }
    return fullCount;
}
