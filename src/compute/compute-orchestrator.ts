/**
 * @file compute-orchestrator.ts
 * @brief GPU-compute-first policy for particles, foliage batch animation, and batcher LOD.
 *
 * WASM / JS tiers remain the fallback and tier-parity reference (tests/tier-parity.mjs).
 * Disable GPU compute via `?no_gpu_compute` or `window.__computeDisabled`.
 */

import { isCIorHeadless, CONFIG } from '../core/config.ts';
import { getSharedGPUCompute } from './gpu-compute-library.ts';
import { initGPUCompute } from './compute-init.ts';

export interface ComputeOrchestratorStatus {
    preferGpu: boolean;
    gpuReady: boolean;
    gpuAvailable: boolean;
    disabledReason: string | null;
    vramEstimateBytes: number;
    lastFrameGpuLod: boolean;
    lastFrameGpuFoliage: boolean;
}

let _preferGpu = true;
let _gpuReady = false;
let _initStarted = false;
let _vramEstimateBytes = 0;
let _lastFrameGpuLod = false;
let _lastFrameGpuFoliage = false;

function readDisabledFromUrl(): boolean {
    try {
        return new URLSearchParams(window.location.search).has('no_gpu_compute');
    } catch {
        return false;
    }
}

function isExplicitlyDisabled(): boolean {
    if (typeof window === 'undefined') return true;
    if (readDisabledFromUrl()) return true;
    if ((window as any).__computeDisabled === true) return true;
    if (isCIorHeadless()) return true;
    return false;
}

/** True when GPU compute should be attempted before WASM/JS. */
export function preferGpuCompute(): boolean {
    if (CONFIG.compute?.preferGpu === false) return false;
    return _preferGpu && !isExplicitlyDisabled();
}

export function isGpuComputeReady(): boolean {
    return _gpuReady && getSharedGPUCompute().isReady();
}

export function getComputeOrchestratorStatus(): ComputeOrchestratorStatus {
    const lib = getSharedGPUCompute();
    return {
        preferGpu: preferGpuCompute(),
        gpuReady: isGpuComputeReady(),
        gpuAvailable: lib.hasWebGPU(),
        disabledReason: isExplicitlyDisabled()
            ? isCIorHeadless()
                ? 'ci/headless'
                : readDisabledFromUrl()
                  ? 'no_gpu_compute'
                  : '__computeDisabled'
            : null,
        vramEstimateBytes: _vramEstimateBytes,
        lastFrameGpuLod: _lastFrameGpuLod,
        lastFrameGpuFoliage: _lastFrameGpuFoliage,
    };
}

/** Track approximate GPU buffer bytes for VRAM audit (#1346). */
export function trackGpuBufferBytes(delta: number): void {
    _vramEstimateBytes = Math.max(0, _vramEstimateBytes + delta);
}

export function setLastFrameGpuLod(used: boolean): void {
    _lastFrameGpuLod = used;
}

export function setLastFrameGpuFoliage(used: boolean): void {
    _lastFrameGpuFoliage = used;
}

/**
 * Initialise shared GPU compute once (idempotent).
 * Resolves even when WebGPU is unavailable.
 */
export async function ensureGpuComputeReady(): Promise<boolean> {
    if (isExplicitlyDisabled()) {
        _preferGpu = false;
        return false;
    }
    if (_gpuReady) return true;

    if (!_initStarted) {
        _initStarted = true;
        await initGPUCompute();
    }

    const lib = getSharedGPUCompute();
    _gpuReady = lib.isReady();
    _preferGpu = _gpuReady;
    return _gpuReady;
}

/** Per-frame tick — keeps readiness state fresh after deferred init. */
export function tickComputeOrchestrator(): void {
    if (isExplicitlyDisabled()) {
        _preferGpu = false;
        _gpuReady = false;
        return;
    }
    _gpuReady = getSharedGPUCompute().isReady();
    _preferGpu = _gpuReady;
}

if (typeof window !== 'undefined') {
    const w = window as unknown as {
        __computeStatus?: () => ComputeOrchestratorStatus;
        __computeVramBytes?: () => number;
    };
    w.__computeStatus = getComputeOrchestratorStatus;
    w.__computeVramBytes = () => _vramEstimateBytes;
}
