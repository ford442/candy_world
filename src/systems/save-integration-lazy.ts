/**
 * Lazy save integration — wires gather hooks after boot without pulling save-system into app.
 */
export function initializeSaveSystemIntegration(): void {
    void import('./save-integration.ts').then((m) => m.initializeSaveSystemIntegration());
}
