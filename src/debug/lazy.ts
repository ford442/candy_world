/**
 * Lazy debug panel loader — heavy panel UI only for ?debug=1 (#1361 follow-up).
 */
import { DEBUG_CONFIG } from './stages.ts';

/** Load and mount the stage-toggle debug panel when ?debug=1 is present. */
export function initDebugPanelIfNeeded(): void {
    if (!DEBUG_CONFIG.enabled) return;
    void import('./panel.ts').then((m) => m.initDebugPanel());
    void initParticleEmitterDebugIfNeeded();
}

/** Install the `window.__particles` emitter-API console surface for ?debug=1. */
export async function initParticleEmitterDebugIfNeeded(): Promise<void> {
    if (!DEBUG_CONFIG.enabled) return;
    const [{ initParticleEmitterDebug }, main, physics] = await Promise.all([
        import('./particle-emitter-debug.ts'),
        import('../core/main.ts'),
        import('../systems/physics/index.ts'),
    ]);
    initParticleEmitterDebug(
        main.scene,
        () => physics.player.position,
        () => main.camera
    );
}
