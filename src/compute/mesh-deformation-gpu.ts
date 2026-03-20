/**
 * @file mesh-deformation-gpu.ts
 * @description GPU-accelerated mesh deformation using WebGPU compute shaders.
 *
 * Provides wave, jiggle, and wobble deformations on the GPU with automatic
 * CPU fallback via MeshDeformationCompute.
 *
 * @example
 * ```ts
 * import { MeshDeformationGPU } from './mesh-deformation-gpu';
 * import { MeshDeformationCompute } from './mesh_deformation';
 *
 * const cpuFallback = new MeshDeformationCompute(geometry, 'wave');
 * const gpuDeformer = new MeshDeformationGPU(cpuFallback);
 * await gpuDeformer.init();
 *
 * // In animation loop:
 * await gpuDeformer.update(elapsedTime, { kick: audioState.kickTrigger });
 * ```
 */

import * as THREE from 'three';
import { GPUComputeLibrary, getSharedGPUCompute } from './gpu-compute-library.ts';
import {
    MeshDeformationCompute,
    DeformationType,
    DeformationTypeValue,
    DeformationAudioState,
} from './mesh_deformation.ts';
import {
    MESH_DEFORM_WAVE_WGSL,
    MESH_DEFORM_JIGGLE_WGSL,
    MESH_DEFORM_WOBBLE_WGSL,
    NORMAL_RECOMPUTE_WGSL,
    NORMAL_NORMALIZE_WGSL,
} from './gpu-compute-shaders.ts';

// =============================================================================
// TYPES
// =============================================================================

export interface MeshDeformationGPUConfig {
    /** Use GPU when available (default: true) */
    useGPU?: boolean;
    /** Recompute normals on GPU (default: true) */
    recomputeNormals?: boolean;
}

// =============================================================================
// SHADER SELECTION
// =============================================================================

function getShaderForType(type: DeformationTypeValue): string {
    switch (type) {
        case DeformationType.WAVE: return MESH_DEFORM_WAVE_WGSL;
        case DeformationType.JIGGLE: return MESH_DEFORM_JIGGLE_WGSL;
        case DeformationType.WOBBLE: return MESH_DEFORM_WOBBLE_WGSL;
        default: return MESH_DEFORM_WAVE_WGSL;
    }
}

// =============================================================================
// BIND GROUP LAYOUT (shared across all deformation types)
// =============================================================================

const DEFORM_LAYOUT: GPUBindGroupLayoutEntry[] = [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
];

// =============================================================================
// GPU MESH DEFORMATION
// =============================================================================

export class MeshDeformationGPU {
    private gpuLib: GPUComputeLibrary;
    private cpuFallback: MeshDeformationCompute;
    private config: Required<MeshDeformationGPUConfig>;

    // GPU resources
    private pipeline: GPUComputePipeline | null = null;
    private originalBuffer: GPUBuffer | null = null;
    private deformedBuffer: GPUBuffer | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private bindGroup: GPUBindGroup | null = null;

    // Cached data
    private vertexCount = 0;
    private originalPositions: Float32Array;

    // Uniform data: time, strength, frequency, audioPulse, vertexCount, pad×3
    private uniformData = new Float32Array(8);

    constructor(cpuFallback: MeshDeformationCompute, config: MeshDeformationGPUConfig = {}) {
        this.cpuFallback = cpuFallback;
        this.config = {
            useGPU: config.useGPU ?? true,
            recomputeNormals: config.recomputeNormals ?? true,
        };
        this.gpuLib = getSharedGPUCompute();

        const posAttr = cpuFallback.geometry.attributes.position;
        this.originalPositions = (posAttr.array as Float32Array).slice();
        this.vertexCount = posAttr.count;
    }

    /** The geometry being deformed */
    get geometry(): THREE.BufferGeometry {
        return this.cpuFallback.geometry;
    }

    /** The deformation type */
    get type(): DeformationTypeValue {
        return this.cpuFallback.type;
    }

    /** Whether the GPU path is active */
    isReady(): boolean {
        return this.gpuLib.isReady() && this.pipeline !== null;
    }

    /**
     * Initialise GPU resources. Must be called before update().
     * Falls back silently if WebGPU is unavailable.
     */
    async init(): Promise<void> {
        if (!this.config.useGPU) return;

        try {
            await this.gpuLib.initDevice();
        } catch {
            console.log('[GPU] MeshDeformationGPU: WebGPU unavailable, using CPU fallback');
            return;
        }

        try {
            const shader = getShaderForType(this.cpuFallback.type);
            this.pipeline = await this.gpuLib.createComputePipeline({
                shader,
                workgroupSize: 64,
                bindingLayout: DEFORM_LAYOUT,
                label: `mesh-deform-${this.cpuFallback.type}`,
            });

            this.originalBuffer = this.gpuLib.createStorageBuffer(
                this.originalPositions,
                'original-positions'
            );
            this.deformedBuffer = this.gpuLib.createStorageBuffer(
                new Float32Array(this.vertexCount * 3),
                'deformed-positions'
            );

            // Uniform: 8 floats (32 bytes), but vertexCount is at index 4 as uint
            this.uniformData[4] = this.vertexCount; // f32 bit-pattern will be reinterpreted
            const uniformView = new ArrayBuffer(32);
            const f32 = new Float32Array(uniformView);
            const u32 = new Uint32Array(uniformView);
            f32[0] = 0; f32[1] = 1; f32[2] = 1; f32[3] = 0;
            u32[4] = this.vertexCount;
            u32[5] = 0; u32[6] = 0; u32[7] = 0;
            this.uniformBuffer = this.gpuLib.createUniformBuffer(
                new Float32Array(uniformView),
                'deform-uniforms'
            );

            this.bindGroup = this.gpuLib.createBindGroup(
                this.pipeline,
                [this.originalBuffer, this.deformedBuffer, this.uniformBuffer],
                `mesh-deform-${this.cpuFallback.type}-bind`
            );

            console.log(`[GPU] MeshDeformationGPU (${this.cpuFallback.type}) initialised — ${this.vertexCount} vertices`);
        } catch (e) {
            console.warn('[GPU] MeshDeformationGPU init failed:', e);
            this.pipeline = null;
        }
    }

    /**
     * Set the deformation strength.
     */
    setStrength(strength: number): void {
        this.cpuFallback.setStrength(strength);
    }

    /**
     * Set the deformation frequency.
     */
    setFrequency(frequency: number): void {
        this.cpuFallback.setFrequency(frequency);
    }

    /**
     * Update deformation. Uses GPU when available, CPU otherwise.
     */
    async update(time: number, audioState: DeformationAudioState = {}): Promise<void> {
        if (!this.isReady()) {
            this.cpuFallback.update(time, audioState);
            return;
        }

        const audioPulse = audioState.kick ?? 0;
        const strength = this.cpuFallback.uStrength.value;
        const frequency = this.cpuFallback.uFrequency.value;

        // Write uniforms
        const uniformView = new ArrayBuffer(32);
        const f32 = new Float32Array(uniformView);
        const u32 = new Uint32Array(uniformView);
        f32[0] = time;
        f32[1] = strength;
        f32[2] = frequency;
        f32[3] = audioPulse;
        u32[4] = this.vertexCount;

        this.gpuLib.writeUniformBuffer(this.uniformBuffer!, new Float32Array(uniformView));

        // Dispatch
        const workgroups = Math.ceil(this.vertexCount / 64);
        this.gpuLib.dispatchCompute(this.pipeline!, this.bindGroup!, workgroups);

        // Read back deformed positions
        const result = await this.gpuLib.readBuffer(
            this.deformedBuffer!,
            this.vertexCount * 3 * 4
        );

        const positions = this.cpuFallback.geometry.attributes.position.array as Float32Array;
        positions.set(result);
        this.cpuFallback.geometry.attributes.position.needsUpdate = true;

        if (this.config.recomputeNormals) {
            this.cpuFallback.geometry.computeVertexNormals();
        }
    }

    /**
     * Reset geometry to original state.
     */
    reset(): void {
        this.cpuFallback.reset();
    }

    /**
     * Dispose GPU resources.
     */
    dispose(): void {
        this.originalBuffer?.destroy();
        this.deformedBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.originalBuffer = null;
        this.deformedBuffer = null;
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;
    }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a GPU-accelerated wave deformation.
 * @param geometry - Target geometry
 * @param config - GPU config options
 */
export function createGPUWaveDeformation(
    geometry: THREE.BufferGeometry,
    config: MeshDeformationGPUConfig & { strength?: number; frequency?: number; audioReactive?: boolean } = {}
): MeshDeformationGPU {
    const cpu = new MeshDeformationCompute(geometry, DeformationType.WAVE, {
        strength: config.strength,
        frequency: config.frequency,
        audioReactive: config.audioReactive,
    });
    return new MeshDeformationGPU(cpu, config);
}

/**
 * Create a GPU-accelerated jiggle deformation.
 */
export function createGPUJiggleDeformation(
    geometry: THREE.BufferGeometry,
    config: MeshDeformationGPUConfig & { strength?: number; audioReactive?: boolean } = {}
): MeshDeformationGPU {
    const cpu = new MeshDeformationCompute(geometry, DeformationType.JIGGLE, {
        strength: config.strength,
        audioReactive: config.audioReactive,
    });
    return new MeshDeformationGPU(cpu, config);
}

/**
 * Create a GPU-accelerated wobble deformation.
 */
export function createGPUWobbleDeformation(
    geometry: THREE.BufferGeometry,
    config: MeshDeformationGPUConfig & { strength?: number; audioReactive?: boolean } = {}
): MeshDeformationGPU {
    const cpu = new MeshDeformationCompute(geometry, DeformationType.WOBBLE, {
        strength: config.strength,
        audioReactive: config.audioReactive,
    });
    return new MeshDeformationGPU(cpu, config);
}
