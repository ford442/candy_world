/**
 * @file gpu-foliage-orchestrator.ts
 * @brief Lifecycle for GPU foliage pilot paths on the shared renderer-owned device.
 *
 * Owns `GPUFoliageAnimator` init/teardown and reacts to device loss without
 * taking down the render canvas (policy in `gpu-context.ts`).
 */

import { onGpuDeviceLost } from '../rendering/gpu-context.ts';
import { ensureGpuComputeReady, setLastFrameGpuFoliage } from './compute-orchestrator.ts';
import { disposeFoliageGpuBatch } from './foliage-gpu-batch.ts';
import { getSharedGPUCompute } from './gpu-compute-library.ts';
import {
    GPUFoliageAnimator,
    type FoliageAudioState,
    type FoliageInstanceData,
} from './gpu-foliage-animator.ts';
import { isGpuFoliageDefaultPath } from './gpu-foliage-flag.ts';
import { disposeGpuPlantPose } from './gpu-plant-pose.ts';

let _animator: GPUFoliageAnimator | null = null;
let _initPromise: Promise<GPUFoliageAnimator | null> | null = null;
let _deviceLostUnsub: (() => void) | null = null;
let _disabledByDeviceLoss = false;

function attachDeviceLostHandler(): void {
    if (_deviceLostUnsub) return;
    _deviceLostUnsub = onGpuDeviceLost(() => {
        _disabledByDeviceLoss = true;
        teardownGpuFoliageOrchestrator();
        console.warn('[GPUFoliage] Device lost — falling back to CPU/WASM foliage');
    });
}

/**
 * Initialise shared GPU foliage resources (default path when WebGPU is available).
 * Uses `awaitGpuDevice()` indirectly via `getSharedGPUCompute()` — never
 * calls `navigator.gpu.requestDevice()`. Opt-out via `?gpuFoliage=0`.
 */
export async function initGpuFoliageOrchestrator(): Promise<GPUFoliageAnimator | null> {
    if (_disabledByDeviceLoss || !isGpuFoliageDefaultPath()) return null;
    if (_animator?.isReady()) return _animator;
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        const gpuReady = await ensureGpuComputeReady();
        if (!gpuReady || !isGpuFoliageDefaultPath()) return null;

        const gpu = getSharedGPUCompute();
        if (!gpu.isReady()) {
            console.warn('[GPUFoliage] Shared WebGPU device unavailable — CPU/WASM fallback');
            return null;
        }

        attachDeviceLostHandler();

        const animator = new GPUFoliageAnimator(gpu);
        try {
            await animator.initialize();
        } catch (err) {
            console.warn('[GPUFoliage] Animator init failed — CPU/WASM fallback', err);
            return null;
        }

        _animator = animator;
        console.log('[GPUFoliage] Orchestrator ready — default GPU animation path (opt-out: ?gpuFoliage=0)');
        return animator;
    })();

    return _initPromise;
}

export function getGpuFoliageAnimator(): GPUFoliageAnimator | null {
    return _animator?.isReady() ? _animator : null;
}

export function updateGpuFoliageAnimator(time: number, audio: FoliageAudioState): void {
    if (!_animator?.isReady()) return;
    _animator.update(time, audio);
    setLastFrameGpuFoliage(true);
}

export function uploadGpuFoliageInstances(data: FoliageInstanceData): void {
    _animator?.uploadInstances(data);
}

export function teardownGpuFoliageOrchestrator(): void {
    _animator?.destroy();
    _animator = null;
    _initPromise = null;
    disposeGpuPlantPose();
    disposeFoliageGpuBatch();
}

export function isGpuFoliageOrchestratorActive(): boolean {
    return !_disabledByDeviceLoss && isGpuFoliageDefaultPath() && (_animator?.isReady() ?? false);
}

if (typeof window !== 'undefined') {
    const w = window as unknown as {
        __gpuFoliageOrchestrator?: () => {
            active: boolean;
            disabledByDeviceLoss: boolean;
            animatorReady: boolean;
        };
    };
    w.__gpuFoliageOrchestrator = () => ({
        active: isGpuFoliageOrchestratorActive(),
        disabledByDeviceLoss: _disabledByDeviceLoss,
        animatorReady: _animator?.isReady() ?? false,
    });
}
