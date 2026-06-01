/**
 * @file compute-init.ts
 * @brief One-shot GPU compute library initialisation for the live app.
 *
 * Calling `initGPUCompute()` from deferred-init.ts arms the shared
 * GPUComputeLibrary so that `MeshDeformationGPU`, `NoiseGeneratorGPU`, and
 * `GPUCullingSystem` all receive an already-warmed device on first use.
 * On browsers without WebGPU the init silently resolves and the CPU / WASM
 * fallback paths remain the active route.
 *
 * Audit note (2026-06):
 *   Code search found ZERO direct `new MeshDeformationCompute(...)` or
 *   `new ProceduralNoiseCompute(...)` outside src/compute/.  The CPU classes
 *   are not called from hot paths — the app uses TSL vertex shaders for visual
 *   deformation and WASM for heightmap/physics instead.  The GPU wrapper
 *   classes are correctly built but were never wired into the live app.
 *
 *   This module is the wiring point.  Any future caller that imports from
 *   src/compute/ (e.g. createGPUWaveDeformation, NoiseGeneratorGPU) will find
 *   the device already initialised because deferred-init.ts calls
 *   initGPUCompute() early in the post-boot phase.
 */

import { getSharedGPUCompute, type ComputeMetrics } from './gpu-compute-library.ts';

let _initPromise: Promise<void> | null = null;

/**
 * Initialise the shared GPU compute device once.
 * Safe to call multiple times — only the first call does real work.
 * Resolves even when WebGPU is unavailable (CPU fallback active).
 */
export async function initGPUCompute(): Promise<void> {
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        const lib = getSharedGPUCompute();
        if (lib.isReady()) return;

        try {
            await lib.initDevice();
            console.log('[Compute] GPU compute library ready');
        } catch {
            // WebGPU unavailable — CPU/WASM fallback will be used transparently
            console.log('[Compute] WebGPU unavailable — GPU compute disabled, CPU fallback active');
        }
    })();

    return _initPromise;
}

/**
 * Snapshot of GPU compute metrics for the debug panel.
 * Returns null when the GPU library has not been initialised yet.
 */
export function getGPUComputeStatus(): {
    available: boolean;
    ready: boolean;
    metrics: ComputeMetrics;
} {
    const lib = getSharedGPUCompute();
    return {
        available: lib.hasWebGPU(),
        ready: lib.isReady(),
        metrics: lib.getMetrics(),
    };
}
