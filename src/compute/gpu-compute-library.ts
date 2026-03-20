/**
 * @file gpu-compute-library.ts
 * @description Unified WebGPU compute library for Candy World.
 *
 * Provides device management, buffer creation, pipeline caching, and
 * dispatch helpers used by MeshDeformationGPU, NoiseGeneratorGPU,
 * and CullingSystemGPU.
 *
 * @example
 * ```ts
 * const lib = new GPUComputeLibrary();
 * await lib.initDevice();
 * if (lib.isReady()) { ... }
 * ```
 */

// =============================================================================
// TYPES
// =============================================================================

export interface PipelineConfig {
    /** WGSL shader source code */
    shader: string;
    /** Workgroup size declared in the shader (used for dispatch calculation) */
    workgroupSize: number;
    /** Bind group layout entries */
    bindingLayout: GPUBindGroupLayoutEntry[];
    /** Optional label for debugging */
    label?: string;
}

export interface ComputeMetrics {
    [key: string]: number;
}

// =============================================================================
// GPU COMPUTE LIBRARY
// =============================================================================

/**
 * Reusable foundation for GPU compute operations.
 * Manages device lifecycle, pipelines, buffers, and performance tracking.
 */
export class GPUComputeLibrary {
    protected device: GPUDevice | null = null;
    private adapter: GPUAdapter | null = null;
    private pipelineCache: Map<string, GPUComputePipeline> = new Map();
    private layoutCache: Map<string, GPUBindGroupLayout> = new Map();
    private metrics: ComputeMetrics = {};
    private _ready = false;

    // =========================================================================
    // Device Management
    // =========================================================================

    /** Check if the browser supports WebGPU */
    hasWebGPU(): boolean {
        return typeof navigator !== 'undefined' && 'gpu' in navigator;
    }

    /** True when the device has been successfully initialised */
    isReady(): boolean {
        return this._ready && this.device !== null;
    }

    /** Get the raw GPUDevice (null if not initialised) */
    getDevice(): GPUDevice | null {
        return this.device;
    }

    /**
     * Initialise the WebGPU device. Rejects if WebGPU is unavailable.
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    async initDevice(): Promise<void> {
        if (this._ready) return;
        if (!this.hasWebGPU()) {
            throw new Error('[GPU] WebGPU is not supported in this browser');
        }

        const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
            Promise.race([
                p,
                new Promise<T>((_, reject) =>
                    setTimeout(() => reject(new Error(`[GPU] ${label} timed out after ${ms}ms`)), ms)
                ),
            ]);

        this.adapter = await withTimeout(
            navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }),
            5000,
            'requestAdapter'
        );
        if (!this.adapter) {
            throw new Error('[GPU] No WebGPU adapter found');
        }

        this.device = await withTimeout(
            this.adapter.requestDevice({
                requiredLimits: {
                    maxStorageBufferBindingSize: 134217728, // 128 MB
                    maxComputeWorkgroupSizeX: 256,
                },
            }),
            5000,
            'requestDevice'
        );

        this.device.lost.then((info) => {
            console.error(`[GPU] Device lost: ${info.message}`);
            this._ready = false;
            this.device = null;
        });

        this._ready = true;
        console.log('[GPU] Device initialised');
    }

    // =========================================================================
    // Pipeline Creation
    // =========================================================================

    /**
     * Create (or retrieve from cache) a compute pipeline.
     * The cache key is derived from the shader source.
     */
    async createComputePipeline(config: PipelineConfig): Promise<GPUComputePipeline> {
        if (!this.device) throw new Error('[GPU] Device not initialised');

        const cacheKey = config.label ?? config.shader;
        const cached = this.pipelineCache.get(cacheKey);
        if (cached) return cached;

        const shaderModule = this.device.createShaderModule({
            code: config.shader,
            label: config.label ?? 'compute-shader',
        });

        const layoutKey = JSON.stringify(config.bindingLayout);
        let bindGroupLayout = this.layoutCache.get(layoutKey);
        if (!bindGroupLayout) {
            bindGroupLayout = this.device.createBindGroupLayout({
                entries: config.bindingLayout,
                label: `${config.label ?? 'compute'}-layout`,
            });
            this.layoutCache.set(layoutKey, bindGroupLayout);
        }

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
            label: `${config.label ?? 'compute'}-pipeline-layout`,
        });

        const pipeline = this.device.createComputePipeline({
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: 'main' },
            label: config.label ?? 'compute-pipeline',
        });

        this.pipelineCache.set(cacheKey, pipeline);
        return pipeline;
    }

    // =========================================================================
    // Buffer Management
    // =========================================================================

    /** Create a GPU storage buffer, optionally initialised with data */
    createStorageBuffer(data: ArrayBufferView, label?: string, readOnly = false): GPUBuffer {
        if (!this.device) throw new Error('[GPU] Device not initialised');

        const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
        const buffer = this.device.createBuffer({
            size: Math.max(data.byteLength, 4), // WebGPU requires size > 0
            usage,
            label: label ?? 'storage-buffer',
            mappedAtCreation: true,
        });

        new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        buffer.unmap();
        return buffer;
    }

    /** Create a GPU uniform buffer, optionally initialised with data */
    createUniformBuffer(data: ArrayBufferView, label?: string): GPUBuffer {
        if (!this.device) throw new Error('[GPU] Device not initialised');

        // Align to 16 bytes (std140)
        const alignedSize = Math.ceil(data.byteLength / 16) * 16;
        const buffer = this.device.createBuffer({
            size: Math.max(alignedSize, 16),
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: label ?? 'uniform-buffer',
        });

        this.device.queue.writeBuffer(buffer, 0, data);
        return buffer;
    }

    /** Write new data into an existing uniform buffer */
    writeUniformBuffer(buffer: GPUBuffer, data: ArrayBufferView): void {
        if (!this.device) return;
        this.device.queue.writeBuffer(buffer, 0, data);
    }

    /** Write new data into an existing storage buffer */
    writeStorageBuffer(buffer: GPUBuffer, data: ArrayBufferView): void {
        if (!this.device) return;
        this.device.queue.writeBuffer(buffer, 0, data);
    }

    /**
     * Read data back from a GPU buffer (async — causes a pipeline stall).
     * Prefer deferring reads to the next frame where possible.
     */
    async readBuffer(gpuBuffer: GPUBuffer, byteLength?: number): Promise<Float32Array> {
        if (!this.device) throw new Error('[GPU] Device not initialised');

        const size = byteLength ?? gpuBuffer.size;
        const staging = this.device.createBuffer({
            size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            label: 'read-staging',
        });

        const encoder = this.device.createCommandEncoder({ label: 'read-encoder' });
        encoder.copyBufferToBuffer(gpuBuffer, 0, staging, 0, size);
        this.device.queue.submit([encoder.finish()]);

        await staging.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(staging.getMappedRange().slice(0));
        staging.unmap();
        staging.destroy();
        return result;
    }

    /**
     * Read data back as Uint32Array
     */
    async readBufferU32(gpuBuffer: GPUBuffer, byteLength?: number): Promise<Uint32Array> {
        if (!this.device) throw new Error('[GPU] Device not initialised');

        const size = byteLength ?? gpuBuffer.size;
        const staging = this.device.createBuffer({
            size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            label: 'read-staging-u32',
        });

        const encoder = this.device.createCommandEncoder({ label: 'read-encoder-u32' });
        encoder.copyBufferToBuffer(gpuBuffer, 0, staging, 0, size);
        this.device.queue.submit([encoder.finish()]);

        await staging.mapAsync(GPUMapMode.READ);
        const result = new Uint32Array(staging.getMappedRange().slice(0));
        staging.unmap();
        staging.destroy();
        return result;
    }

    // =========================================================================
    // Bind Group Helpers
    // =========================================================================

    /** Create a bind group from a pipeline and a set of buffers */
    createBindGroup(
        pipeline: GPUComputePipeline,
        buffers: GPUBuffer[],
        label?: string
    ): GPUBindGroup {
        if (!this.device) throw new Error('[GPU] Device not initialised');

        return this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: buffers.map((buffer, i) => ({
                binding: i,
                resource: { buffer },
            })),
            label: label ?? 'bind-group',
        });
    }

    // =========================================================================
    // Dispatch
    // =========================================================================

    /**
     * Encode and submit a compute dispatch.
     * Returns after the command buffer is submitted (GPU may still be working).
     */
    dispatchCompute(
        pipeline: GPUComputePipeline,
        bindGroup: GPUBindGroup,
        workgroupCountX: number,
        workgroupCountY = 1,
        workgroupCountZ = 1
    ): void {
        if (!this.device) return;

        const encoder = this.device.createCommandEncoder({ label: 'dispatch-encoder' });
        const pass = encoder.beginComputePass({ label: 'dispatch-pass' });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupCountX, workgroupCountY, workgroupCountZ);
        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }

    // =========================================================================
    // Error Handling
    // =========================================================================

    /**
     * Execute a GPU operation with automatic CPU fallback on failure.
     */
    async withFallback<T>(gpuFn: () => Promise<T>, cpuFn: () => T, label = 'compute'): Promise<T> {
        if (!this.isReady()) {
            return cpuFn();
        }
        try {
            return await gpuFn();
        } catch (error) {
            console.error(`[GPU] ${label} failed, falling back to CPU:`, error);
            return cpuFn();
        }
    }

    // =========================================================================
    // Performance Monitoring
    // =========================================================================

    /** Measure wall-clock time of an async operation */
    async measureTime(label: string, fn: () => Promise<void>): Promise<number> {
        const start = performance.now();
        await fn();
        const elapsed = performance.now() - start;
        this.metrics[label] = elapsed;
        return elapsed;
    }

    /** Get all recorded metrics */
    getMetrics(): ComputeMetrics {
        return { ...this.metrics };
    }

    /** Log a benchmark comparison to console */
    logBenchmark(label: string, gpuMs: number, cpuMs: number): void {
        const speedup = cpuMs / Math.max(gpuMs, 0.001);
        console.log(
            `[GPU Benchmark] ${label}: GPU ${gpuMs.toFixed(2)}ms vs CPU ${cpuMs.toFixed(2)}ms ` +
            `(${speedup.toFixed(1)}x ${speedup > 1 ? 'faster' : 'slower'})`
        );
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    /** Destroy the device and release all resources */
    dispose(): void {
        this.pipelineCache.clear();
        this.layoutCache.clear();
        this.metrics = {};
        if (this.device) {
            this.device.destroy();
            this.device = null;
        }
        this._ready = false;
        console.log('[GPU] Compute library disposed');
    }
}

// Singleton instance for shared use across the app
let sharedInstance: GPUComputeLibrary | null = null;

/** Get (or create) the shared GPUComputeLibrary instance */
export function getSharedGPUCompute(): GPUComputeLibrary {
    if (!sharedInstance) {
        sharedInstance = new GPUComputeLibrary();
    }
    return sharedInstance;
}
