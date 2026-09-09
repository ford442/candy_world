/**
 * @file gpu-chores.ts
 * @brief Shared GPU "chores" (Tier 4a) — generic compute primitives that any
 *        subsystem can reuse: prefix sum, stream compaction, and `reduce_f32`.
 *
 * **Device ownership**: chores never request a `GPUDevice`. Callers hand in the
 * device they already borrowed from `GPUComputeLibrary.initDevice()`, which in
 * turn borrows the single renderer-owned device from `gpu-context.ts`. If that
 * device is unavailable the caller stays on its CPU/WASM tier — a chore is never
 * a reason to spin a second device or a WebGL context.
 *
 * **Scope**: domain simulation (particle collide/update/spawn, foliage pose and
 * wind) stays app-local in Tier 4b. Only reusable primitives belong here.
 *
 * Usage is a two-step job API: build a job once (bind groups + params buffer),
 * then encode it into a caller-owned `GPUCommandEncoder` each frame.
 *
 * ```ts
 * const chores = new GPUChoresLibrary(device);
 * await chores.initialize();
 * const scan = chores.createPrefixSumJob(flagsBuf, offsetsBuf, blockSumsBuf);
 * const compact = chores.createCompactJob({ ... });
 * // per frame:
 * chores.encodePrefixSum(encoder, scan, liveCount);
 * chores.encodeCompact(encoder, compact, liveCount);
 * ```
 *
 * A job's element count is published through its own uniform buffer at encode
 * time, so encode each job at most once per submitted command buffer.
 *
 * @see docs/COMPUTE_GPU_DEFAULT.md — Tier 4a vs 4b
 */

import { setLastFrameGpuChores, trackGpuBufferBytes } from '../compute-orchestrator.ts';
import {
    CHORE_PARAMS_BYTES,
    COMPACT_WGSL,
    PREFIX_SUM_ADD_WGSL,
    PREFIX_SUM_BLOCK_SCAN_WGSL,
    PREFIX_SUM_WGSL,
    REDUCE_F32_FINAL_WGSL,
    REDUCE_F32_WGSL,
    WORKGROUP_SIZE,
} from './gpu-chores-wgsl.ts';

/** Number of 256-element blocks a chore pass needs for `count` elements. */
export function choreBlockCount(count: number): number {
    return Math.ceil(count / WORKGROUP_SIZE);
}

/** Bytes a caller must allocate for the block-sums buffer of a prefix sum. */
export function prefixSumBlockSumsBytes(capacity: number): number {
    return Math.max(4, choreBlockCount(capacity) * 4);
}

/** Handle for a prefix-sum job bound to a fixed set of buffers. */
export interface PrefixSumJob {
    readonly scanBg: GPUBindGroup;
    readonly blockScanBg: GPUBindGroup;
    readonly addBg: GPUBindGroup;
    readonly elementParams: GPUBuffer;
    readonly blockParams: GPUBuffer;
}

/** Handle for a stream-compaction job bound to a fixed set of buffers. */
export interface CompactJob {
    readonly bg: GPUBindGroup;
    readonly params: GPUBuffer;
}

/** Handle for a `reduce_f32` job bound to a fixed set of buffers. */
export interface ReduceF32Job {
    readonly blocksBg: GPUBindGroup;
    readonly finalBg: GPUBindGroup;
    readonly elementParams: GPUBuffer;
    readonly blockParams: GPUBuffer;
}

/** Buffers consumed by a compaction job. */
export interface CompactJobBuffers {
    /** Per-element 0/1 visibility flags. */
    inputFlags: GPUBuffer;
    /** Per-element payload written alongside the surviving index. */
    inputLods: GPUBuffer;
    /** Inclusive prefix sum of `inputFlags` (output of `encodePrefixSum`). */
    offsets: GPUBuffer;
    /** Dense output: source index of each survivor. */
    outIndices: GPUBuffer;
    /** Dense output: payload of each survivor. */
    outLods: GPUBuffer;
    /** Single u32 receiving the survivor count. */
    outCount: GPUBuffer;
    /** Indirect draw args; word 1 (`instanceCount`) receives the survivor count. */
    indirectArgs: GPUBuffer;
}

export class GPUChoresLibrary {
    private device: GPUDevice;

    // Prefix sum pipelines
    private scanPipeline: GPUComputePipeline | null = null;
    private blockScanPipeline: GPUComputePipeline | null = null;
    private addPipeline: GPUComputePipeline | null = null;

    // Compact pipeline
    private compactPipeline: GPUComputePipeline | null = null;

    // reduce_f32 pipelines
    private reducePipeline: GPUComputePipeline | null = null;
    private reduceFinalPipeline: GPUComputePipeline | null = null;

    /** Params buffers this library owns, so `destroy()` can free and untrack them. */
    private ownedBuffers: GPUBuffer[] = [];
    private trackedBytes = 0;

    /** Scratch for uniform writes — avoids a per-frame allocation. */
    private readonly paramScratch = new Uint32Array(CHORE_PARAMS_BYTES / 4);

    constructor(device: GPUDevice) {
        this.device = device;
    }

    /** Compile every chore pipeline. Safe to call once per device. */
    public async initialize(): Promise<void> {
        if (!this.device) return;

        const build = async (code: string, entryPoint: string, label: string) =>
            this.device.createComputePipelineAsync({
                layout: 'auto',
                compute: {
                    module: this.device.createShaderModule({ code, label: `${label}-shader` }),
                    entryPoint,
                },
                label: `${label}-pipeline`,
            });

        const [scan, blockScan, add, compact, reduce, reduceFinal] = await Promise.all([
            build(PREFIX_SUM_WGSL, 'scanBlocks', 'chore-scan-blocks'),
            build(PREFIX_SUM_BLOCK_SCAN_WGSL, 'scanBlockSums', 'chore-scan-block-sums'),
            build(PREFIX_SUM_ADD_WGSL, 'addBlockSums', 'chore-add-block-sums'),
            build(COMPACT_WGSL, 'compact', 'chore-compact'),
            build(REDUCE_F32_WGSL, 'reduceBlocks', 'chore-reduce-f32'),
            build(REDUCE_F32_FINAL_WGSL, 'reduceFinal', 'chore-reduce-f32-final'),
        ]);

        this.scanPipeline = scan;
        this.blockScanPipeline = blockScan;
        this.addPipeline = add;
        this.compactPipeline = compact;
        this.reducePipeline = reduce;
        this.reduceFinalPipeline = reduceFinal;
    }

    /** True once `initialize()` has compiled the pipelines. */
    public isReady(): boolean {
        return this.scanPipeline !== null && this.compactPipeline !== null;
    }

    /** Approximate VRAM held by library-owned params buffers. */
    public getTrackedBytes(): number {
        return this.trackedBytes;
    }

    // =========================================================================
    // Job construction
    // =========================================================================

    /**
     * Build a prefix-sum job.
     *
     * @param inputBuffer - u32 values to scan (read-only storage).
     * @param outputBuffer - receives the inclusive scan (storage).
     * @param blockSumsBuffer - scratch of at least `prefixSumBlockSumsBytes(capacity)`.
     */
    public createPrefixSumJob(
        inputBuffer: GPUBuffer,
        outputBuffer: GPUBuffer,
        blockSumsBuffer: GPUBuffer
    ): PrefixSumJob {
        const elementParams = this.createParamsBuffer('chore-prefix-sum-elements');
        const blockParams = this.createParamsBuffer('chore-prefix-sum-blocks');

        const scanBg = this.device.createBindGroup({
            layout: this.scanPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: inputBuffer } },
                { binding: 1, resource: { buffer: outputBuffer } },
                { binding: 2, resource: { buffer: blockSumsBuffer } },
                { binding: 3, resource: { buffer: elementParams } },
            ],
            label: 'chore-prefix-sum-scan-bg',
        });

        const blockScanBg = this.device.createBindGroup({
            layout: this.blockScanPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: blockSumsBuffer } },
                { binding: 1, resource: { buffer: blockParams } },
            ],
            label: 'chore-prefix-sum-block-scan-bg',
        });

        const addBg = this.device.createBindGroup({
            layout: this.addPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBuffer } },
                { binding: 1, resource: { buffer: blockSumsBuffer } },
                { binding: 2, resource: { buffer: elementParams } },
            ],
            label: 'chore-prefix-sum-add-bg',
        });

        return { scanBg, blockScanBg, addBg, elementParams, blockParams };
    }

    /** Build a compaction job over a fixed set of buffers. */
    public createCompactJob(buffers: CompactJobBuffers): CompactJob {
        const params = this.createParamsBuffer('chore-compact-params');
        const bg = this.device.createBindGroup({
            layout: this.compactPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: buffers.inputFlags } },
                { binding: 1, resource: { buffer: buffers.inputLods } },
                { binding: 2, resource: { buffer: buffers.offsets } },
                { binding: 3, resource: { buffer: buffers.outIndices } },
                { binding: 4, resource: { buffer: buffers.outLods } },
                { binding: 5, resource: { buffer: buffers.outCount } },
                { binding: 6, resource: { buffer: buffers.indirectArgs } },
                { binding: 7, resource: { buffer: params } },
            ],
            label: 'chore-compact-bg',
        });
        return { bg, params };
    }

    /**
     * Build a `reduce_f32` job.
     *
     * @param inputBuffer - f32 values to sum (read-only storage).
     * @param partialsBuffer - scratch of at least `prefixSumBlockSumsBytes(capacity)`.
     * @param resultBuffer - at least 4 bytes; `result[0]` receives the total.
     */
    public createReduceF32Job(
        inputBuffer: GPUBuffer,
        partialsBuffer: GPUBuffer,
        resultBuffer: GPUBuffer
    ): ReduceF32Job {
        const elementParams = this.createParamsBuffer('chore-reduce-elements');
        const blockParams = this.createParamsBuffer('chore-reduce-blocks');

        const blocksBg = this.device.createBindGroup({
            layout: this.reducePipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: inputBuffer } },
                { binding: 1, resource: { buffer: partialsBuffer } },
                { binding: 2, resource: { buffer: elementParams } },
            ],
            label: 'chore-reduce-blocks-bg',
        });

        const finalBg = this.device.createBindGroup({
            layout: this.reduceFinalPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: partialsBuffer } },
                { binding: 1, resource: { buffer: resultBuffer } },
                { binding: 2, resource: { buffer: blockParams } },
            ],
            label: 'chore-reduce-final-bg',
        });

        return { blocksBg, finalBg, elementParams, blockParams };
    }

    // =========================================================================
    // Encoding
    // =========================================================================

    /**
     * Encode an inclusive prefix sum over the first `elementCount` elements.
     * Three passes: per-block scan → exclusive scan of block totals → add back.
     */
    public encodePrefixSum(
        encoder: GPUCommandEncoder,
        job: PrefixSumJob,
        elementCount: number
    ): void {
        if (elementCount <= 0 || !this.scanPipeline) return;

        const blocks = choreBlockCount(elementCount);
        this.writeCount(job.elementParams, elementCount);
        this.writeCount(job.blockParams, blocks);

        const scanPass = encoder.beginComputePass({ label: 'chore-prefix-sum-scan-pass' });
        scanPass.setPipeline(this.scanPipeline);
        scanPass.setBindGroup(0, job.scanBg);
        scanPass.dispatchWorkgroups(blocks);
        scanPass.end();

        if (blocks > 1) {
            // Turn per-block totals into exclusive per-block offsets, then fold
            // them back in. Single workgroup — it walks the block totals itself.
            const blockScanPass = encoder.beginComputePass({
                label: 'chore-prefix-sum-block-scan-pass',
            });
            blockScanPass.setPipeline(this.blockScanPipeline!);
            blockScanPass.setBindGroup(0, job.blockScanBg);
            blockScanPass.dispatchWorkgroups(1);
            blockScanPass.end();

            const addPass = encoder.beginComputePass({ label: 'chore-prefix-sum-add-pass' });
            addPass.setPipeline(this.addPipeline!);
            addPass.setBindGroup(0, job.addBg);
            addPass.dispatchWorkgroups(blocks);
            addPass.end();
        }

        setLastFrameGpuChores(true);
    }

    /**
     * Encode a stream compaction over the first `elementCount` elements.
     * Requires `encodePrefixSum` on the same flags earlier in the encoder.
     */
    public encodeCompact(encoder: GPUCommandEncoder, job: CompactJob, elementCount: number): void {
        if (elementCount <= 0 || !this.compactPipeline) return;

        this.writeCount(job.params, elementCount);

        const pass = encoder.beginComputePass({ label: 'chore-compact-pass' });
        pass.setPipeline(this.compactPipeline);
        pass.setBindGroup(0, job.bg);
        pass.dispatchWorkgroups(choreBlockCount(elementCount));
        pass.end();

        setLastFrameGpuChores(true);
    }

    /** Encode a sum over the first `elementCount` f32 elements into `result[0]`. */
    public encodeReduceF32(
        encoder: GPUCommandEncoder,
        job: ReduceF32Job,
        elementCount: number
    ): void {
        if (elementCount <= 0 || !this.reducePipeline) return;

        const blocks = choreBlockCount(elementCount);
        this.writeCount(job.elementParams, elementCount);
        this.writeCount(job.blockParams, blocks);

        const blocksPass = encoder.beginComputePass({ label: 'chore-reduce-blocks-pass' });
        blocksPass.setPipeline(this.reducePipeline);
        blocksPass.setBindGroup(0, job.blocksBg);
        blocksPass.dispatchWorkgroups(blocks);
        blocksPass.end();

        const finalPass = encoder.beginComputePass({ label: 'chore-reduce-final-pass' });
        finalPass.setPipeline(this.reduceFinalPipeline!);
        finalPass.setBindGroup(0, job.finalBg);
        finalPass.dispatchWorkgroups(1);
        finalPass.end();

        setLastFrameGpuChores(true);
    }

    /** Destroy library-owned params buffers and drop them from the VRAM audit. */
    public destroy(): void {
        for (const buffer of this.ownedBuffers) buffer.destroy();
        this.ownedBuffers.length = 0;
        if (this.trackedBytes > 0) {
            trackGpuBufferBytes(-this.trackedBytes);
            this.trackedBytes = 0;
        }
    }

    // =========================================================================
    // Internals
    // =========================================================================

    private createParamsBuffer(label: string): GPUBuffer {
        const buffer = this.device.createBuffer({
            size: CHORE_PARAMS_BYTES,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label,
        });
        this.ownedBuffers.push(buffer);
        this.trackedBytes += CHORE_PARAMS_BYTES;
        trackGpuBufferBytes(CHORE_PARAMS_BYTES);
        return buffer;
    }

    /**
     * Publish the live element count for a pass. `queue.writeBuffer` is ordered
     * ahead of command buffers submitted after it, so writing at encode time is
     * observed by the dispatch it belongs to.
     */
    private writeCount(buffer: GPUBuffer, count: number): void {
        this.paramScratch[0] = count;
        this.device.queue.writeBuffer(buffer, 0, this.paramScratch);
    }
}
