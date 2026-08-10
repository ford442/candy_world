/**
 * @file gpu-foliage-flag.ts
 * @brief Gate for GPU foliage instance animation (default ON when WebGPU is available).
 *
 * Opt-out: append `?gpuFoliage=0` or `?no_gpu_foliage` to the URL.
 * Requires the shared renderer-owned WebGPU device (#1448). WebGL, CI/headless,
 * `?no_gpu_compute`, and device-lost all fall back to CPU/WASM tiers.
 */

import { preferGpuCompute, isGpuComputeReady } from './compute-orchestrator.ts';

/** Returns false only when the user explicitly opts out via URL params. */
export function isGpuFoliageOptedOut(): boolean {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.has('no_gpu_foliage')) return true;
        if (params.has('gpuFoliage')) {
            const v = params.get('gpuFoliage');
            return v === '0' || v === 'false';
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * True when the GPU foliage default path is active (device available and not
 * opted out). Previously a pilot requiring `?gpuFoliage=1`; now ON by default.
 */
export function isGpuFoliageDefaultPath(): boolean {
    if (typeof window === 'undefined') return false;
    if (isGpuFoliageOptedOut()) return false;
    return preferGpuCompute() && isGpuComputeReady();
}

/** Exposed for devtools / smoke assertions. */
export function getGpuFoliageFlagState(): {
    optedOut: boolean;
    defaultPath: boolean;
    pilotActive: boolean;
    urlEnabled: boolean;
} {
    const optedOut = typeof window !== 'undefined' && isGpuFoliageOptedOut();
    const active = !optedOut && preferGpuCompute() && isGpuComputeReady();
    return {
        optedOut,
        defaultPath: active,
        pilotActive: active,
        // Legacy field kept for backwards-compat with older devtools snapshots.
        urlEnabled: !optedOut,
    };
}

if (typeof window !== 'undefined') {
    (window as unknown as { __gpuFoliageFlag?: () => ReturnType<typeof getGpuFoliageFlagState> }).__gpuFoliageFlag =
        getGpuFoliageFlagState;
}
