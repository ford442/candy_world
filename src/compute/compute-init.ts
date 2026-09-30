/**
 * @file compute-init.ts
 * @brief One-shot GPU compute library initialisation for the live app.
 *
 * Calling `initGPUCompute()` from deferred-init.ts arms the shared
 * GPUComputeLibrary so the GPU foliage passes (`foliage-gpu-batch.ts`,
 * `gpu-plant-pose.ts`) receive an already-warmed device on first use.
 * On browsers without WebGPU the init silently resolves and the CPU / WASM
 * fallback paths remain the active route.
 *
 * The mesh-deformation, noise-generator, GPU-culling and GPU-LOD wrappers this
 * used to warm up were never wired into the app and were deleted in #1827.
 */
import { log } from "../utils/log.ts";
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
            log.debug('[Compute] GPU compute library ready');
        } catch {
            // WebGPU unavailable — CPU/WASM fallback will be used transparently
            log.debug('[Compute] WebGPU unavailable — GPU compute disabled, CPU fallback active');
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
