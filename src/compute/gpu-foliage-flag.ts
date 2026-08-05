/**
 * @file gpu-foliage-flag.ts
 * @brief A/B gate for GPU foliage pilot paths (`?gpuFoliage=1`, default OFF).
 *
 * Requires the shared renderer-owned WebGPU device (#1448). WebGL, CI/headless,
 * `?no_gpu_compute`, and device-lost all fall back to CPU/WASM tiers.
 */

import { preferGpuCompute, isGpuComputeReady } from './compute-orchestrator.ts';

function readGpuFoliageFromUrl(): boolean {
    try {
        const params = new URLSearchParams(window.location.search);
        if (!params.has('gpuFoliage')) return false;
        const v = params.get('gpuFoliage');
        return v === null || v === '' || v === '1' || v === 'true';
    } catch {
        return false;
    }
}

/** True when the GPU foliage pilot is explicitly enabled and compute is ready. */
export function isGpuFoliagePilotEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    if (!readGpuFoliageFromUrl()) return false;
    return preferGpuCompute() && isGpuComputeReady();
}

/** Exposed for devtools / smoke assertions. */
export function getGpuFoliageFlagState(): { urlEnabled: boolean; pilotActive: boolean } {
    const urlEnabled = typeof window !== 'undefined' && readGpuFoliageFromUrl();
    return {
        urlEnabled,
        pilotActive: urlEnabled && preferGpuCompute() && isGpuComputeReady(),
    };
}

if (typeof window !== 'undefined') {
    (window as unknown as { __gpuFoliageFlag?: () => ReturnType<typeof getGpuFoliageFlagState> }).__gpuFoliageFlag =
        getGpuFoliageFlagState;
}
