/**
 * @file culling-system-gpu.ts
 * @description GPU-accelerated batch culling using WebGPU compute shaders.
 *
 * Provides frustum, distance, and combined culling for large instance counts
 * with automatic CPU fallback via the existing CullingSystem.
 *
 * @example
 * ```ts
 * import { CullingSystemGPU } from './culling-system-gpu';
 *
 * const culler = new CullingSystemGPU();
 * await culler.init();
 *
 * // Each frame:
 * const visible = await culler.frustumCullGPU(frustumPlanes, spheres);
 * ```
 */

import * as THREE from 'three';
import { GPUComputeLibrary, getSharedGPUCompute } from '../compute/gpu-compute-library.ts';
import {
    FRUSTUM_CULL_WGSL,
    DISTANCE_CULL_WGSL,
    COMBINED_CULL_WGSL,
} from '../compute/gpu-compute-shaders.ts';

// =============================================================================
// TYPES
// =============================================================================

/** Bounding sphere: [centerX, centerY, centerZ, radius] per instance */
export type BoundingSphereArray = Float32Array;

/** Frustum as 6 plane equations, each vec4(nx, ny, nz, d) — 24 floats */
export type FrustumPlanes = Float32Array;

export interface CullingGPUConfig {
    /** Use GPU when available (default: true) */
    useGPU?: boolean;
}

// =============================================================================
// BIND GROUP LAYOUTS
// =============================================================================

const CULL_LAYOUT: GPUBindGroupLayoutEntry[] = [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
];

// =============================================================================
// GPU CULLING SYSTEM
// =============================================================================

export class CullingSystemGPU {
    private gpuLib: GPUComputeLibrary;
    private useGPUFlag: boolean;

    // Pipelines (lazily created)
    private frustumPipeline: GPUComputePipeline | null = null;
    private distancePipeline: GPUComputePipeline | null = null;
    private combinedPipeline: GPUComputePipeline | null = null;

    constructor(config: CullingGPUConfig = {}) {
        this.useGPUFlag = config.useGPU ?? true;
        this.gpuLib = getSharedGPUCompute();
    }

    /** Whether the GPU path is active */
    isReady(): boolean {
        return this.gpuLib.isReady();
    }

    /**
     * Initialise GPU device and compile all culling pipelines.
     */
    async init(): Promise<void> {
        if (!this.useGPUFlag) return;

        try {
            await this.gpuLib.initDevice();
        } catch {
            console.log('[GPU] CullingSystemGPU: WebGPU unavailable, using CPU fallback');
            return;
        }

        try {
            [this.frustumPipeline, this.distancePipeline, this.combinedPipeline] =
                await Promise.all([
                    this.gpuLib.createComputePipeline({
                        shader: FRUSTUM_CULL_WGSL,
                        workgroupSize: 64,
                        bindingLayout: CULL_LAYOUT,
                        label: 'frustum-cull',
                    }),
                    this.gpuLib.createComputePipeline({
                        shader: DISTANCE_CULL_WGSL,
                        workgroupSize: 64,
                        bindingLayout: CULL_LAYOUT,
                        label: 'distance-cull',
                    }),
                    this.gpuLib.createComputePipeline({
                        shader: COMBINED_CULL_WGSL,
                        workgroupSize: 64,
                        bindingLayout: CULL_LAYOUT,
                        label: 'combined-cull',
                    }),
                ]);

            console.log('[GPU] CullingSystemGPU initialised');
        } catch (e) {
            console.warn('[GPU] CullingSystemGPU init failed:', e);
        }
    }

    // =========================================================================
    // Frustum Culling
    // =========================================================================

    /**
     * GPU frustum culling.
     * @param frustumPlanes - 6 plane normals+distance as Float32Array(24)
     * @param boundingSpheres - Packed vec4 per instance (centerX,Y,Z, radius)
     * @returns Uint32Array of visibility flags (1 = visible, 0 = culled)
     */
    async frustumCullGPU(
        frustumPlanes: FrustumPlanes,
        boundingSpheres: BoundingSphereArray
    ): Promise<Uint32Array> {
        const instanceCount = boundingSpheres.length / 4;

        if (!this.isReady() || !this.frustumPipeline) {
            return this.frustumCullCPU(frustumPlanes, boundingSpheres);
        }

        // Uniforms: 6 × vec4(plane) + instanceCount + 3 × pad = 28 floats = 112 bytes
        const uniformView = new ArrayBuffer(112);
        const f32 = new Float32Array(uniformView);
        const u32 = new Uint32Array(uniformView);
        f32.set(frustumPlanes, 0); // 24 floats for 6 planes
        u32[24] = instanceCount;
        // pad at 25, 26, 27

        return this.runCullPipeline(this.frustumPipeline, uniformView, boundingSpheres, instanceCount);
    }

    // =========================================================================
    // Distance Culling
    // =========================================================================

    /**
     * GPU distance culling.
     * @param cameraPosition - Camera world position
     * @param maxDistance - Maximum visible distance
     * @param boundingSpheres - Packed vec4 per instance
     * @returns Uint32Array of visibility flags
     */
    async distanceCullGPU(
        cameraPosition: THREE.Vector3,
        maxDistance: number,
        boundingSpheres: BoundingSphereArray
    ): Promise<Uint32Array> {
        const instanceCount = boundingSpheres.length / 4;

        if (!this.isReady() || !this.distancePipeline) {
            return this.distanceCullCPU(cameraPosition, maxDistance, boundingSpheres);
        }

        // Uniforms: cameraPosition(vec3) + maxDistance(f32) + instanceCount(u32) + 3×pad = 8 floats = 32 bytes
        const uniformView = new ArrayBuffer(32);
        const f32 = new Float32Array(uniformView);
        const u32 = new Uint32Array(uniformView);
        f32[0] = cameraPosition.x;
        f32[1] = cameraPosition.y;
        f32[2] = cameraPosition.z;
        f32[3] = maxDistance;
        u32[4] = instanceCount;

        return this.runCullPipeline(this.distancePipeline, uniformView, boundingSpheres, instanceCount);
    }

    // =========================================================================
    // Combined Culling
    // =========================================================================

    /**
     * GPU combined frustum + distance culling.
     * @param frustumPlanes - 6 plane equations
     * @param cameraPosition - Camera world position
     * @param maxDistance - Maximum visible distance
     * @param boundingSpheres - Packed vec4 per instance
     * @returns Uint32Array of visibility flags
     */
    async combinedCullGPU(
        frustumPlanes: FrustumPlanes,
        cameraPosition: THREE.Vector3,
        maxDistance: number,
        boundingSpheres: BoundingSphereArray
    ): Promise<Uint32Array> {
        const instanceCount = boundingSpheres.length / 4;

        if (!this.isReady() || !this.combinedPipeline) {
            return this.combinedCullCPU(frustumPlanes, cameraPosition, maxDistance, boundingSpheres);
        }

        // Uniforms: 6×vec4 + cameraPosition(vec3) + maxDistance(f32) + instanceCount(u32) + 3×pad = 32 floats = 128 bytes
        const uniformView = new ArrayBuffer(128);
        const f32 = new Float32Array(uniformView);
        const u32 = new Uint32Array(uniformView);
        f32.set(frustumPlanes, 0); // 24 floats
        f32[24] = cameraPosition.x;
        f32[25] = cameraPosition.y;
        f32[26] = cameraPosition.z;
        f32[27] = maxDistance;
        u32[28] = instanceCount;

        return this.runCullPipeline(this.combinedPipeline, uniformView, boundingSpheres, instanceCount);
    }

    // =========================================================================
    // CPU Fallbacks
    // =========================================================================

    /** CPU frustum culling fallback */
    frustumCullCPU(planes: FrustumPlanes, spheres: BoundingSphereArray): Uint32Array {
        const count = spheres.length / 4;
        const result = new Uint32Array(count);

        for (let i = 0; i < count; i++) {
            const cx = spheres[i * 4];
            const cy = spheres[i * 4 + 1];
            const cz = spheres[i * 4 + 2];
            const r = spheres[i * 4 + 3];

            let visible = true;
            for (let p = 0; p < 6 && visible; p++) {
                const nx = planes[p * 4];
                const ny = planes[p * 4 + 1];
                const nz = planes[p * 4 + 2];
                const d = planes[p * 4 + 3];
                const dist = nx * cx + ny * cy + nz * cz + d;
                if (dist < -r) visible = false;
            }

            result[i] = visible ? 1 : 0;
        }

        return result;
    }

    /** CPU distance culling fallback */
    distanceCullCPU(camera: THREE.Vector3, maxDist: number, spheres: BoundingSphereArray): Uint32Array {
        const count = spheres.length / 4;
        const result = new Uint32Array(count);

        for (let i = 0; i < count; i++) {
            const dx = spheres[i * 4] - camera.x;
            const dy = spheres[i * 4 + 1] - camera.y;
            const dz = spheres[i * 4 + 2] - camera.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            result[i] = dist <= maxDist ? 1 : 0;
        }

        return result;
    }

    /** CPU combined culling fallback */
    combinedCullCPU(
        planes: FrustumPlanes,
        camera: THREE.Vector3,
        maxDist: number,
        spheres: BoundingSphereArray
    ): Uint32Array {
        const count = spheres.length / 4;
        const result = new Uint32Array(count);

        for (let i = 0; i < count; i++) {
            const cx = spheres[i * 4];
            const cy = spheres[i * 4 + 1];
            const cz = spheres[i * 4 + 2];
            const r = spheres[i * 4 + 3];

            // Distance check first (cheaper)
            const dx = cx - camera.x;
            const dy = cy - camera.y;
            const dz = cz - camera.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > maxDist) {
                result[i] = 0;
                continue;
            }

            // Frustum check
            let visible = true;
            for (let p = 0; p < 6 && visible; p++) {
                const nx = planes[p * 4];
                const ny = planes[p * 4 + 1];
                const nz = planes[p * 4 + 2];
                const d = planes[p * 4 + 3];
                const planeDist = nx * cx + ny * cy + nz * cz + d;
                if (planeDist < -r) visible = false;
            }

            result[i] = visible ? 1 : 0;
        }

        return result;
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private static _scratchExtractMatrix = new THREE.Matrix4(); // ⚡ OPTIMIZATION: Scratch matrix
    private static _scratchExtractFrustum = new THREE.Frustum(); // ⚡ OPTIMIZATION: Scratch frustum

    /**
     * Extract frustum planes from a Three.js camera as a Float32Array(24).
     * Each plane is vec4(nx, ny, nz, d) matching the WGSL convention.
     */
    static extractFrustumPlanes(camera: THREE.Camera): Float32Array {
        // ⚡ OPTIMIZATION: Use pre-allocated scratch objects to avoid GC spikes
        const mat = CullingSystemGPU._scratchExtractMatrix.multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
        );
        const frustum = CullingSystemGPU._scratchExtractFrustum;
        frustum.setFromProjectionMatrix(mat);

        const planes = new Float32Array(24);
        for (let i = 0; i < 6; i++) {
            const p = frustum.planes[i];
            planes[i * 4] = p.normal.x;
            planes[i * 4 + 1] = p.normal.y;
            planes[i * 4 + 2] = p.normal.z;
            planes[i * 4 + 3] = p.constant;
        }
        return planes;
    }

    /**
     * Pack an array of objects with bounding spheres into a BoundingSphereArray.
     */
    static packBoundingSpheres(
        objects: Array<{ center: THREE.Vector3; radius: number }>
    ): BoundingSphereArray {
        const data = new Float32Array(objects.length * 4);
        for (let i = 0; i < objects.length; i++) {
            data[i * 4] = objects[i].center.x;
            data[i * 4 + 1] = objects[i].center.y;
            data[i * 4 + 2] = objects[i].center.z;
            data[i * 4 + 3] = objects[i].radius;
        }
        return data;
    }

    /**
     * Convert visibility flags to an array of visible indices.
     */
    static getVisibleIndices(flags: Uint32Array): number[] {
        const indices: number[] = [];
        for (let i = 0; i < flags.length; i++) {
            if (flags[i] === 1) indices.push(i);
        }
        return indices;
    }

    /** Dispose GPU resources */
    dispose(): void {
        this.frustumPipeline = null;
        this.distancePipeline = null;
        this.combinedPipeline = null;
    }

    // =========================================================================
    // Private
    // =========================================================================

    private async runCullPipeline(
        pipeline: GPUComputePipeline,
        uniformData: ArrayBuffer,
        boundingSpheres: BoundingSphereArray,
        instanceCount: number
    ): Promise<Uint32Array> {
        const sphereBuffer = this.gpuLib.createStorageBuffer(boundingSpheres, 'cull-spheres');
        const flagBuffer = this.gpuLib.createStorageBuffer(
            new Uint32Array(instanceCount),
            'cull-flags'
        );
        const uniformBuffer = this.gpuLib.createUniformBuffer(
            new Float32Array(uniformData),
            'cull-uniforms'
        );

        const bindGroup = this.gpuLib.createBindGroup(
            pipeline,
            [sphereBuffer, flagBuffer, uniformBuffer],
            'cull-bind'
        );

        const workgroups = Math.ceil(instanceCount / 64);
        this.gpuLib.dispatchCompute(pipeline, bindGroup, workgroups);

        const result = await this.gpuLib.readBufferU32(flagBuffer, instanceCount * 4);

        sphereBuffer.destroy();
        flagBuffer.destroy();
        uniformBuffer.destroy();

        return result;
    }
}
