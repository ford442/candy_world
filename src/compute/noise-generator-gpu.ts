/**
 * @file noise-generator-gpu.ts
 * @description GPU-accelerated procedural noise generation using WebGPU compute shaders.
 *
 * Generates FBM noise textures on the GPU for terrain heightmaps and
 * candy swirl patterns. Falls back to ProceduralNoiseCompute on CPU.
 *
 * @example
 * ```ts
 * import { NoiseGeneratorGPU } from './noise-generator-gpu';
 *
 * const noise = new NoiseGeneratorGPU(512, 512, { scale: 2.0, octaves: 6 });
 * await noise.init();
 *
 * const texture = await noise.createTexture();
 * material.map = texture;
 * ```
 */

import * as THREE from 'three';
import { GPUComputeLibrary, getSharedGPUCompute } from './gpu-compute-library.ts';
import { ProceduralNoiseCompute, NoiseConfig } from './noise_generator.ts';
import { NOISE_FBM_WGSL, NOISE_HEIGHTMAP_WGSL } from './gpu-compute-shaders.ts';

// =============================================================================
// TYPES
// =============================================================================

export interface NoiseGeneratorGPUConfig extends NoiseConfig {
    /** Use GPU when available (default: true) */
    useGPU?: boolean;
}

// =============================================================================
// BIND GROUP LAYOUT
// =============================================================================

const NOISE_LAYOUT: GPUBindGroupLayoutEntry[] = [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
];

// =============================================================================
// GPU NOISE GENERATOR
// =============================================================================

export class NoiseGeneratorGPU {
    public readonly width: number;
    public readonly height: number;

    private gpuLib: GPUComputeLibrary;
    private cpuFallback: ProceduralNoiseCompute;
    private useGPU: boolean;

    // Configuration
    private scale: number;
    private octaves: number;
    private lacunarity: number;
    private persistence: number;

    // GPU resources
    private rgbaPipeline: GPUComputePipeline | null = null;
    private heightmapPipeline: GPUComputePipeline | null = null;
    private outputBuffer: GPUBuffer | null = null;
    private uniformBuffer: GPUBuffer | null = null;

    constructor(width = 256, height = 256, config: NoiseGeneratorGPUConfig = {}) {
        this.width = width;
        this.height = height;
        this.scale = config.scale ?? 1.0;
        this.octaves = config.octaves ?? 4;
        this.lacunarity = config.lacunarity ?? 2.0;
        this.persistence = config.persistence ?? 0.5;
        this.useGPU = config.useGPU ?? true;

        this.gpuLib = getSharedGPUCompute();
        this.cpuFallback = new ProceduralNoiseCompute(width, height, config);
    }

    /** Whether the GPU path is active */
    isReady(): boolean {
        return this.gpuLib.isReady() && this.rgbaPipeline !== null;
    }

    /**
     * Initialise GPU resources. Must be called before generate/createTexture.
     */
    async init(): Promise<void> {
        if (!this.useGPU) return;

        try {
            await this.gpuLib.initDevice();
        } catch {
            console.log('[GPU] NoiseGeneratorGPU: WebGPU unavailable, using CPU fallback');
            return;
        }

        try {
            this.rgbaPipeline = await this.gpuLib.createComputePipeline({
                shader: NOISE_FBM_WGSL,
                workgroupSize: 8,
                bindingLayout: NOISE_LAYOUT,
                label: 'noise-fbm-rgba',
            });

            this.heightmapPipeline = await this.gpuLib.createComputePipeline({
                shader: NOISE_HEIGHTMAP_WGSL,
                workgroupSize: 8,
                bindingLayout: NOISE_LAYOUT,
                label: 'noise-fbm-heightmap',
            });

            // Allocate output for RGBA (4 floats per pixel)
            const rgbaSize = this.width * this.height * 4 * 4; // 4 channels, 4 bytes each
            this.outputBuffer = this.gpuLib.createStorageBuffer(
                new Float32Array(this.width * this.height * 4),
                'noise-output'
            );

            // Uniform buffer: width(u32), height(u32), scale(f32), octaves(u32),
            //                  lacunarity(f32), persistence(f32), time(f32), pad(u32)
            const uniformView = new ArrayBuffer(32);
            const u32 = new Uint32Array(uniformView);
            const f32 = new Float32Array(uniformView);
            u32[0] = this.width;
            u32[1] = this.height;
            f32[2] = this.scale;
            u32[3] = this.octaves;
            f32[4] = this.lacunarity;
            f32[5] = this.persistence;
            f32[6] = 0; // time
            u32[7] = 0; // pad
            this.uniformBuffer = this.gpuLib.createUniformBuffer(
                new Float32Array(uniformView),
                'noise-uniforms'
            );

            console.log(`[GPU] NoiseGeneratorGPU initialised — ${this.width}×${this.height}`);
        } catch (e) {
            console.warn('[GPU] NoiseGeneratorGPU init failed:', e);
            this.rgbaPipeline = null;
        }
    }

    /** Set noise scale */
    setScale(scale: number): void {
        this.scale = scale;
        this.cpuFallback.setScale(scale);
    }

    /** Set number of FBM octaves */
    setOctaves(octaves: number): void {
        this.octaves = Math.max(1, Math.min(8, octaves));
        this.cpuFallback.setOctaves(this.octaves);
    }

    /**
     * Generate RGBA noise data on the GPU.
     * @param time - Optional time parameter for animated noise
     * @returns Float32Array of RGBA pixel data (width * height * 4)
     */
    async generate(time = 0): Promise<Float32Array> {
        if (!this.isReady()) {
            // CPU fallback
            this.cpuFallback.uTime.value = time;
            this.cpuFallback.generate();
            // Access internal data via createTexture and extract
            const tex = this.cpuFallback.createTexture();
            return tex.image.data as Float32Array;
        }

        this.writeUniforms(time);

        const bindGroup = this.gpuLib.createBindGroup(
            this.rgbaPipeline!,
            [this.outputBuffer!, this.uniformBuffer!],
            'noise-rgba-bind'
        );

        const wgX = Math.ceil(this.width / 8);
        const wgY = Math.ceil(this.height / 8);
        this.gpuLib.dispatchCompute(this.rgbaPipeline!, bindGroup, wgX, wgY);

        return this.gpuLib.readBuffer(this.outputBuffer!, this.width * this.height * 4 * 4);
    }

    /**
     * Generate a single-channel heightmap on the GPU.
     * @param time - Optional time parameter for animated noise
     * @returns Float32Array of height values (width * height)
     */
    async generateHeightmap(time = 0): Promise<Float32Array> {
        if (!this.isReady() || !this.heightmapPipeline) {
            // CPU fallback — generate and return single-channel
            const data = new Float32Array(this.width * this.height);
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const nx = (x / this.width) * this.scale;
                    const ny = (y / this.height) * this.scale;
                    data[y * this.width + x] = this.cpuFallback.fbm(nx, ny);
                }
            }
            return data;
        }

        // Re-create output for single-channel
        const singleBuffer = this.gpuLib.createStorageBuffer(
            new Float32Array(this.width * this.height),
            'noise-heightmap-output'
        );

        this.writeUniforms(time);

        const bindGroup = this.gpuLib.createBindGroup(
            this.heightmapPipeline,
            [singleBuffer, this.uniformBuffer!],
            'noise-heightmap-bind'
        );

        const wgX = Math.ceil(this.width / 8);
        const wgY = Math.ceil(this.height / 8);
        this.gpuLib.dispatchCompute(this.heightmapPipeline, bindGroup, wgX, wgY);

        const result = await this.gpuLib.readBuffer(singleBuffer, this.width * this.height * 4);
        singleBuffer.destroy();
        return result;
    }

    /**
     * Create a Three.js DataTexture from GPU-generated noise.
     * @param time - Optional time parameter for animated noise
     */
    async createTexture(time = 0): Promise<THREE.DataTexture> {
        const data = await this.generate(time);

        const texture = new THREE.DataTexture(
            data,
            this.width,
            this.height,
            THREE.RGBAFormat,
            THREE.FloatType
        );

        texture.needsUpdate = true;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;

        return texture;
    }

    /**
     * Get a single height value at world coordinates.
     * Delegates to CPU for single-point queries (GPU overhead too high).
     */
    getHeight(x: number, z: number, scale?: number): number {
        return this.cpuFallback.getHeight(x, z, scale);
    }

    /** Dispose of GPU and CPU resources */
    dispose(): void {
        this.outputBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.outputBuffer = null;
        this.uniformBuffer = null;
        this.rgbaPipeline = null;
        this.heightmapPipeline = null;
        this.cpuFallback.dispose();
    }

    // =========================================================================
    // Private
    // =========================================================================

    private writeUniforms(time: number): void {
        const uniformView = new ArrayBuffer(32);
        const u32 = new Uint32Array(uniformView);
        const f32 = new Float32Array(uniformView);
        u32[0] = this.width;
        u32[1] = this.height;
        f32[2] = this.scale;
        u32[3] = this.octaves;
        f32[4] = this.lacunarity;
        f32[5] = this.persistence;
        f32[6] = time;
        u32[7] = 0;
        this.gpuLib.writeUniformBuffer(this.uniformBuffer!, new Float32Array(uniformView));
    }
}

// =============================================================================
// CONVENIENCE FACTORY
// =============================================================================

/**
 * Create a candy swirl texture on the GPU.
 * @param width - Texture width
 * @param height - Texture height
 * @param scale - Noise scale
 */
export async function createGPUCandySwirlTexture(
    width = 256,
    height = 256,
    scale = 1.0
): Promise<THREE.DataTexture> {
    const gen = new NoiseGeneratorGPU(width, height, { scale });
    await gen.init();
    const texture = await gen.createTexture();
    gen.dispose();
    return texture;
}
