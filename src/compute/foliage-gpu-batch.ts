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
@group(0) @binding(4) var<storage, read_write> outScalars: array<f32>;

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
    readBufferA: GPUBuffer | null;
    readBufferB: GPUBuffer | null;
    currentReadBufferIndex: number;
    mapPromise: Promise<void> | null;
    prevCount: number;
    scalarStaging: Float32Array | null;
    pipeline: GPUComputePipeline | null;
    bindGroup: GPUBindGroup | null;
}

let _batch: BatchGpuState | null = null;
let _initPromise: Promise<boolean> | null = null;
/** Set when the pipeline cannot be built; the WASM path then serves every batch. */
let _batchDisabled = false;

async function ensureBatchGpu(maxCount: number): Promise<boolean> {
    if (_batchDisabled || !preferGpuCompute() || !isGpuComputeReady()) return false;
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
        if (_batch?.readBufferA?.mapState === 'mapped') _batch.readBufferA.unmap();
        if (_batch?.readBufferB?.mapState === 'mapped') _batch.readBufferB.unmap();
        _batch?.readBufferA?.destroy();
        _batch?.readBufferB?.destroy();

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


        const readBufferA = device.createBuffer({
            size: fBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const readBufferB = device.createBuffer({
            size: fBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        trackGpuBufferBytes(fBytes * 4 + 16 + fBytes * 2);

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
            readBufferA,
            readBufferB,
            currentReadBufferIndex: 0,
            mapPromise: null,
            prevCount: 0,
            scalarStaging: new Float32Array(cap),
        };
        return true;
    })().catch((err: unknown) => {
        // An optional accelerator: a pipeline error must not fail startup.
        _batchDisabled = true;
        _batch = null;
        console.warn('[FoliageGpuBatch] GPU batch disabled, using WASM:', err);
        return false;
    });

    return _initPromise;
}

/**
 * Run a scalar foliage batch on GPU. Returns output array or null to fall back to WASM.
 */
// ⚡ OPTIMIZATION: Hoisted uniform buffer to avoid GC allocations per frame
const _scalarUniformBuf = new ArrayBuffer(16);
const _scalarF32 = new Float32Array(_scalarUniformBuf);
const _scalarU32 = new Uint32Array(_scalarUniformBuf);

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
    // Two overlapping inits can settle out of order and leave the smaller one
    // installed; never dispatch past its buffers. The next call rebuilds it.
    if (!ready || !_batch || _batch.maxCount < count) return null;
    // The state can be rebuilt (a larger batch) or disposed (device loss) while
    // this call awaits the previous readback; hold on to the one we started with.
    const state = _batch;

    const gpu = getSharedGPUCompute();
    const device = gpu.getDevice()!;

    gpu.writeStorageBuffer(state.offsetBuffer!, offsets.subarray(0, count));
    gpu.writeStorageBuffer(state.intensityBuffer!, intensities.subarray(0, count));
    gpu.writeStorageBuffer(state.yBuffer!, originalYs.subarray(0, count));

    const f32 = _scalarF32;
    const u32 = _scalarU32;
    f32[0] = time;
    f32[1] = kick;
    u32[2] = count;
    u32[3] = MODE_ID[mode];
    gpu.writeUniformBuffer(state.uniformBuffer!, f32);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(state.pipeline!);
    pass.setBindGroup(0, state.bindGroup!);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();

    // ⚡ OPTIMIZATION: Pipelined readback using ping-pong persistent staging buffers
    const readBytes = count * 4;

    // Await the mapping from the *previous* frame
    if (state.mapPromise) {
        try {
            await state.mapPromise;
            // Replaced or disposed meanwhile: its buffers are destroyed, so do not
            // read them or submit work against them. The next call starts fresh.
            if (_batch !== state) return null;
            const prevBuffer = state.currentReadBufferIndex === 0 ? state.readBufferA! : state.readBufferB!;
            const mapped = new Float32Array(prevBuffer.getMappedRange());

            // Copy into our persistent CPU staging buffer
            const safeCount = Math.min(state.prevCount, state.maxCount);
            for (let i = 0; i < safeCount; i++) {
                state.scalarStaging![i] = mapped[i];
            }
            prevBuffer.unmap();
        } catch {
            const prevBuffer = state.currentReadBufferIndex === 0 ? state.readBufferA! : state.readBufferB!;
            if (prevBuffer.mapState === 'mapped') {
                prevBuffer.unmap();
            }
        }
    }

    // Swap buffers for current frame dispatch
    state.currentReadBufferIndex = 1 - state.currentReadBufferIndex;
    const currBuffer = state.currentReadBufferIndex === 0 ? state.readBufferA! : state.readBufferB!;
    if (currBuffer.mapState !== 'unmapped') {
        currBuffer.unmap();
    }

    encoder.copyBufferToBuffer(state.outBuffer!, 0, currBuffer, 0, readBytes);
    device.queue.submit([encoder.finish()]);

    // Start mapAsync for NEXT frame, do not await it here
    state.mapPromise = currBuffer.mapAsync(GPUMapMode.READ, 0, readBytes).catch(() => {});
    state.prevCount = count;

    setLastFrameGpuFoliage(true);
    return state.scalarStaging!.subarray(0, count);
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
    if (_batch?.readBufferA?.mapState === 'mapped') _batch.readBufferA.unmap();
    if (_batch?.readBufferB?.mapState === 'mapped') _batch.readBufferB.unmap();
    _batch?.readBufferA?.destroy();
    _batch?.readBufferB?.destroy();
    if (_batch) _batch.mapPromise = null;
    _batch = null;
    _initPromise = null;
}
