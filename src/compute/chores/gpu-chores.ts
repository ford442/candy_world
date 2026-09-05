import { PREFIX_SUM_WGSL, PREFIX_SUM_ADD_WGSL, COMPACT_WGSL } from './gpu-chores-wgsl.ts';

export class GPUChoresLibrary {
    private device: GPUDevice;

    // Prefix sum pipelines
    private scanPipeline: GPUComputePipeline | null = null;
    private addPipeline: GPUComputePipeline | null = null;

    // Compact pipeline
    private compactPipeline: GPUComputePipeline | null = null;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    public async initialize(): Promise<void> {
        if (!this.device) return;

        // Prefix sum (Scan Blocks)
        this.scanPipeline = await this.device.createComputePipelineAsync({
            layout: 'auto',
            compute: {
                module: this.device.createShaderModule({
                    code: PREFIX_SUM_WGSL,
                    label: 'scan-blocks-shader'
                }),
                entryPoint: 'scanBlocks'
            },
            label: 'scan-blocks-pipeline'
        });

        // Prefix sum (Add Block Sums)
        this.addPipeline = await this.device.createComputePipelineAsync({
            layout: 'auto',
            compute: {
                module: this.device.createShaderModule({
                    code: PREFIX_SUM_ADD_WGSL,
                    label: 'add-block-sums-shader'
                }),
                entryPoint: 'addBlockSums'
            },
            label: 'add-block-sums-pipeline'
        });

        // Compact
        this.compactPipeline = await this.device.createComputePipelineAsync({
            layout: 'auto',
            compute: {
                module: this.device.createShaderModule({
                    code: COMPACT_WGSL,
                    label: 'compact-shader'
                }),
                entryPoint: 'compact'
            },
            label: 'compact-pipeline'
        });
    }

    public createPrefixSumBindGroup(
        inputBuffer: GPUBuffer,
        outputBuffer: GPUBuffer,
        blockSumsBuffer: GPUBuffer
    ): GPUBindGroup {
        return this.device.createBindGroup({
            layout: this.scanPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: inputBuffer } },
                { binding: 1, resource: { buffer: outputBuffer } },
                { binding: 2, resource: { buffer: blockSumsBuffer } }
            ],
            label: 'prefix-sum-scan-bg'
        });
    }

    public createPrefixSumAddBindGroup(
        outputBuffer: GPUBuffer,
        blockSumsBuffer: GPUBuffer
    ): GPUBindGroup {
        return this.device.createBindGroup({
            layout: this.addPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBuffer } },
                { binding: 1, resource: { buffer: blockSumsBuffer } }
            ],
            label: 'prefix-sum-add-bg'
        });
    }

    public createCompactBindGroup(
        inputFlagsBuffer: GPUBuffer,
        inputLodsBuffer: GPUBuffer,
        offsetsBuffer: GPUBuffer,
        outIndicesBuffer: GPUBuffer,
        outLodsBuffer: GPUBuffer,
        outCountBuffer: GPUBuffer,
        indirectArgsBuffer: GPUBuffer
    ): GPUBindGroup {
        return this.device.createBindGroup({
            layout: this.compactPipeline!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: inputFlagsBuffer } },
                { binding: 1, resource: { buffer: inputLodsBuffer } },
                { binding: 2, resource: { buffer: offsetsBuffer } },
                { binding: 3, resource: { buffer: outIndicesBuffer } },
                { binding: 4, resource: { buffer: outLodsBuffer } },
                { binding: 5, resource: { buffer: outCountBuffer } },
                { binding: 6, resource: { buffer: indirectArgsBuffer } }
            ],
            label: 'compact-bg'
        });
    }

    public encodePrefixSum(
        encoder: GPUCommandEncoder,
        scanBg: GPUBindGroup,
        addBg: GPUBindGroup,
        elementCount: number
    ): void {
        if (elementCount === 0) return;

        const workgroups = Math.ceil(elementCount / 256);

        const scanPass = encoder.beginComputePass({ label: 'prefix-sum-scan-pass' });
        scanPass.setPipeline(this.scanPipeline!);
        scanPass.setBindGroup(0, scanBg);
        scanPass.dispatchWorkgroups(workgroups);
        scanPass.end();

        if (workgroups > 1) {
            const addPass = encoder.beginComputePass({ label: 'prefix-sum-add-pass' });
            addPass.setPipeline(this.addPipeline!);
            addPass.setBindGroup(0, addBg);
            addPass.dispatchWorkgroups(workgroups);
            addPass.end();
        }
    }

    public encodeCompact(
        encoder: GPUCommandEncoder,
        compactBg: GPUBindGroup,
        elementCount: number
    ): void {
        if (elementCount === 0) return;

        const workgroups = Math.ceil(elementCount / 256);

        const pass = encoder.beginComputePass({ label: 'compact-pass' });
        pass.setPipeline(this.compactPipeline!);
        pass.setBindGroup(0, compactBg);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
    }
}
