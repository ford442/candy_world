/**
 * @file foliage-gpu-batch.ts
 * @brief GPU compute replacement for foliage-batcher WASM scalar batches (sway, bounce, hop).
 *
 * Matches assembly/foliage.ts computeSway / computeBounce / computeHop math for tier-parity alignment.
 */

import { CONFIG } from '../core/config.ts';
import {
    preferGpuCompute,
    isGpuComputeReady,
    setLastFrameGpuFoliage,
    trackGpuBufferBytes,
} from './compute-orchestrator.ts';
import { getSharedGPUCompute } from './gpu-compute-library.ts';
import { isGpuFoliageOptedOut } from './gpu-foliage-flag.ts';

const BATCH_SCALAR_WGSL = /* wgsl */ `
struct Uniforms {
    time: f32,
    kick: f32,
    count: u32,
    mode: u32, // 0=sway, 1=gentleSway, 2=bounce, 3=hop
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> offsets: array<f32>;
@group(0) @binding(2) var<storage, read> intensities: array<f32>;
@group(0) @binding(3) var<storage, read> originalYs: array<f32>;
@group(0) @binding(4) var<storage, write> outScalars: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u.count) { return; }

    let offset = offsets[i];
    let intensity = intensities[i];
    var val: f32;

    if (u.mode == 0u) {
        val = sin(u.time + offset) * 0.11 * intensity;
    } else if (u.mode == 1u) {
        val = sin(u.time * 0.5 + offset) * 0.05 * intensity;
    } else if (u.mode == 2u) {
        let y0 = originalYs[i];
        var kickAmt: f32 = 0.0;
        if (u.kick > 0.12) { kickAmt = u.kick * 0.21; }
        val = y0 + sin(u.time * 3.0 + offset) * 0.12 * intensity + kickAmt;
    } else {
        let y0 = originalYs[i];
        var kickAmt: f32 = 0.0;
        if (u.kick > 0.1) { kickAmt = u.kick * 0.15; }
        val = y0 + max(0.0, sin(u.time * 4.0 + offset)) * 0.3 * intensity + kickAmt;
    }

    outScalars[i] = val;
}
`;

export type FoliageGpuBatchMode = 'sway' | 'gentleSway' | 'bounce' | 'hop';

const MODE_ID: Record<FoliageGpuBatchMode, number> = {
    sway: 0,
    gentleSway: 1,
    bounce: 2,
    hop: 3,
};

interface BatchGpuState {
    maxCount: number;
    offsetBuffer: GPUBuffer | null;
    intensityBuffer: GPUBuffer | null;
    yBuffer: GPUBuffer | null;
    outBuffer: GPUBuffer | null;
    uniformBuffer: GPUBuffer | null;
    pipeline: GPUComputePipeline | null;
    bindGroup: GPUBindGroup | null;
    readbackStagings: [GPUBuffer, GPUBuffer] | null;
    readbackIndex: number;
    readbackPending: [boolean, boolean];
    readbackCounts: [number, number];
    readbackPromises: [Promise<void> | null, Promise<void> | null];
    poseStaging: Float32Array | null;
}

let _batch: BatchGpuState | null = null;
let _initPromise: Promise<boolean> | null = null;

async function ensureBatchGpu(maxCount: number): Promise<boolean> {
    if (!preferGpuCompute() || !isGpuComputeReady()) return false;
    if (_initPromise && _batch && _batch.maxCount >= maxCount) return _initPromise;

    _initPromise = (async () => {
        const gpu = getSharedGPUCompute();
        const device = gpu.getDevice();
        if (!device) return false;

        const cap = Math.max(maxCount, 512);
        const fBytes = cap * 4;

        _batch?.offsetBuffer?.destroy();
        _batch?.intensityBuffer?.destroy();
        _batch?.yBuffer?.destroy();
        _batch?.outBuffer?.destroy();
        _batch?.uniformBuffer?.destroy();
        if (_batch?.readbackStagings) {
            _batch.readbackStagings[0].destroy();
            _batch.readbackStagings[1].destroy();
        }

        const offsetBuffer = device.createBuffer({
            size: fBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const intensityBuffer = device.createBuffer({
            size: fBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const yBuffer = device.createBuffer({
            size: fBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const outBuffer = device.createBuffer({
            size: fBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const uniformBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const staging0 = device.createBuffer({
            size: fBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const staging1 = device.createBuffer({
            size: fBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        trackGpuBufferBytes(fBytes * 6 + 16);

        const layout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });

        const pipeline = await device.createComputePipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
            compute: {
                module: device.createShaderModule({ code: BATCH_SCALAR_WGSL }),
                entryPoint: 'main',
            },
        });

        const bindGroup = device.createBindGroup({
            layout,
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: { buffer: offsetBuffer } },
                { binding: 2, resource: { buffer: intensityBuffer } },
                { binding: 3, resource: { buffer: yBuffer } },
                { binding: 4, resource: { buffer: outBuffer } },
            ],
        });

        _batch = {
            maxCount: cap,
            offsetBuffer,
            intensityBuffer,
            yBuffer,
            outBuffer,
            uniformBuffer,
            pipeline,
            bindGroup,
            readbackStagings: [staging0, staging1],
            readbackIndex: 0,
            readbackPending: [false, false],
            readbackCounts: [0, 0],
            readbackPromises: [null, null],
            poseStaging: new Float32Array(cap),
        };
        return true;
    })();

    return _initPromise;
}

/**
 * Run a scalar foliage batch on GPU. Returns output array or null to fall back to WASM.
 */
export async function runFoliageGpuScalarBatch(
    mode: FoliageGpuBatchMode,
    count: number,
    time: number,
    kick: number,
    offsets: Float32Array,
    intensities: Float32Array,
    originalYs: Float32Array
): Promise<Float32Array | null> {
    if (count === 0) return new Float32Array(0);
    const ready = await ensureBatchGpu(count);
    if (!ready || !_batch) return null;

    const gpu = getSharedGPUCompute();
    const device = gpu.getDevice()!;

    gpu.writeStorageBuffer(_batch.offsetBuffer!, offsets.subarray(0, count));
    gpu.writeStorageBuffer(_batch.intensityBuffer!, intensities.subarray(0, count));
    gpu.writeStorageBuffer(_batch.yBuffer!, originalYs.subarray(0, count));

    const uniformBuf = new ArrayBuffer(16);
    const f32 = new Float32Array(uniformBuf);
    const u32 = new Uint32Array(uniformBuf);
    f32[0] = time;
    f32[1] = kick;
    u32[2] = count;
    u32[3] = MODE_ID[mode];
    gpu.writeUniformBuffer(_batch.uniformBuffer!, new Float32Array(uniformBuf));

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(_batch.pipeline!);
    pass.setBindGroup(0, _batch.bindGroup!);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();

    const readBytes = count * 4;
    const curIndex = _batch.readbackIndex;
    const prevIndex = (curIndex + 1) % 2;
    const curStaging = _batch.readbackStagings![curIndex];
    const prevStaging = _batch.readbackStagings![prevIndex];
    const prevPending = _batch.readbackPending[prevIndex];

    encoder.copyBufferToBuffer(_batch.outBuffer!, 0, curStaging, 0, readBytes);
    device.queue.submit([encoder.finish()]);

    _batch.readbackPending[curIndex] = true;
    _batch.readbackCounts[curIndex] = count;
    _batch.readbackPromises[curIndex] = curStaging.mapAsync(GPUMapMode.READ);
    _batch.readbackIndex = prevIndex;

    if (prevPending) {
        const promise = _batch.readbackPromises[prevIndex];
        if (promise) {
            await promise;
        }
        const mapped = new Float32Array(prevStaging.getMappedRange());
        const prevCount = _batch.readbackCounts[prevIndex];
        if (!_batch.poseStaging || _batch.poseStaging.length < prevCount) {
            _batch.poseStaging = new Float32Array(prevCount);
        }
        _batch.poseStaging.set(mapped.subarray(0, prevCount));
        prevStaging.unmap();
        _batch.readbackPending[prevIndex] = false;
        setLastFrameGpuFoliage(true);
        return _batch.poseStaging.subarray(0, prevCount);
    } else {
        setLastFrameGpuFoliage(false);
        return null;
    }
}

const _pendingBatches = new Map<string, Promise<Float32Array | null>>();
const _resolvedBatches = new Map<string, Float32Array>();

/** Submit GPU work for *next* frame consumption. */
export function submitFoliageGpuScalarBatch(
    batchKey: string,
    mode: FoliageGpuBatchMode,
    count: number,
    time: number,
    kick: number,
    offsets: Float32Array,
    intensities: Float32Array,
    originalYs: Float32Array
): void {
    if (!shouldUseFoliageGpuBatch(count)) return;
    const promise = runFoliageGpuScalarBatch(
        mode,
        count,
        time,
        kick,
        offsets,
        intensities,
        originalYs
    );
    _pendingBatches.set(
        batchKey,
        promise.then((r) => {
            if (r) _resolvedBatches.set(batchKey, r);
            _pendingBatches.delete(batchKey);
            return r;
        })
    );
}

/** Returns GPU results from a prior frame's submit, or null to use WASM this frame. */
export function takeFoliageGpuScalarResult(batchKey: string): Float32Array | null {
    const resolved = _resolvedBatches.get(batchKey);
    if (!resolved) return null;
    _resolvedBatches.delete(batchKey);
    return resolved;
}

/** Sync gate for foliage-batcher: pilot flag + ready + min batch size. */
export function shouldUseFoliageGpuBatch(count: number): boolean {
    return (
        !isGpuFoliageOptedOut() &&
        preferGpuCompute() &&
        isGpuComputeReady() &&
        count >= (CONFIG.compute?.foliageGpuBatchMin ?? 8)
    );
}

export function disposeFoliageGpuBatch(): void {
    _batch?.offsetBuffer?.destroy();
    _batch?.intensityBuffer?.destroy();
    _batch?.yBuffer?.destroy();
    _batch?.outBuffer?.destroy();
    _batch?.uniformBuffer?.destroy();
    if (_batch?.readbackStagings) {
        _batch.readbackStagings[0].destroy();
        _batch.readbackStagings[1].destroy();
    }
    _batch = null;
    _initPromise = null;
}
