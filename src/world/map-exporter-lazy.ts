/**
 * Installs `window.exportCurrentWorldToMap` without loading the exporter:
 * `map-exporter.ts` (its own `map-export` chunk) loads on the first call.
 */
export function installWorldExportTools(): void {
    if (typeof window === 'undefined') return;
    const stub: NonNullable<Window['exportCurrentWorldToMap']> = async (options) => {
        const m = await import('./map-exporter.ts');
        m.installWorldExportTools();
        const real = window.exportCurrentWorldToMap;
        if (!real || real === stub) throw new Error('map exporter failed to install');
        return real(options);
    };
    window.exportCurrentWorldToMap = stub;
}
