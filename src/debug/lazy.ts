/**
 * Lazy debug panel loader — heavy panel UI only for ?debug=1 (#1361 follow-up).
 */
import type * as THREE from 'three';
import { DEBUG_CONFIG } from './stages.ts';

/** Load and mount the stage-toggle debug panel when ?debug=1 is present. */
export function initDebugPanelIfNeeded(): void {
    if (!DEBUG_CONFIG.enabled) return;
    void import('./panel.ts').then((m) => m.initDebugPanel());
}

/**
 * Install the `window.__particles` emitter-API console surface for ?debug=1.
 * core/main/scene-pipeline.ts calls this once the scene exists and passes it in;
 * importing core/main.ts from here closed an import cycle through the whole
 * bootstrap (#1827).
 */
export async function initParticleEmitterDebugIfNeeded(
    scene: THREE.Scene,
    getPlayerPosition: () => THREE.Vector3,
    getCamera: () => THREE.Camera | null
): Promise<void> {
    if (!DEBUG_CONFIG.enabled) return;
    const { initParticleEmitterDebug } = await import('./particle-emitter-debug.ts');
    initParticleEmitterDebug(scene, getPlayerPosition, getCamera);
}
