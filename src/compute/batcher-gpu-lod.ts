/**
 * @file batcher-gpu-lod.ts
 * @brief GPU-authoritative LOD factor pass for instanced foliage batchers.
 *
 * One LOD_SELECT dispatch per frame for all registered instances.
 * Readback is pipelined: dispatch in frame N, apply in frame N+1 (1-frame latency).
 */

import * as THREE from 'three';
import { LOD_SELECT_WGSL } from './gpu-compute-shaders.ts';
import { getSharedGPUCompute } from './gpu-compute-library.ts';
import {
    preferGpuCompute,
    isGpuComputeReady,
    setLastFrameGpuLod,
    trackGpuBufferBytes,
} from './compute-orchestrator.ts';
import type { FoliageLodConfig } from '../systems/batcher-lod.ts';

const WORKGROUP = 256;

interface LodGpuState {
    maxInstances: number;
    positionBuffer: GPUBuffer | null;
    lodBuffer: GPUBuffer | null;
    uniformBuffer: GPUBuffer | null;
    pipeline: GPUComputePipeline | null;
    bindGroup: GPUBindGroup | null;
    indexMap: Array<{ mesh: THREE.InstancedMesh; localIndex: number }>;
    lodScratch: Uint32Array | null;
    readbackPending: boolean;
}

let _state: LodGpuState | null = null;
let _initPromise: Promise<boolean> | null = null;

function lodLevelToFactor(level: number): number {
    if (level >= 3) return 3;
    if (level === 2) return 2;
    if (level === 1) return 1;
    return 0;
}

async function ensureLodGpu(maxInstances: number): Promise<boolean> {
    if (!preferGpuCompute() || !isGpuComputeReady()) return false;

    if (_initPromise && _state && _state.maxInstances >= maxInstances) {
        return _initPromise;
    }

    _initPromise = (async () => {
        const gpu = getSharedGPUCompute();
        const device = gpu.getDevice();
        if (!device) return false;

        const cap = Math.max(maxInstances, 4096);
        const posBytes = cap * 12;
        const lodBytes = cap * 4;

        _state?.positionBuffer?.destroy();
        _state?.lodBuffer?.destroy();
        _state?.uniformBuffer?.destroy();

        const positionBuffer = device.createBuffer({
            size: posBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'batcher-lod-positions',
        });
        const lodBuffer = device.createBuffer({
            size: lodBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            label: 'batcher-lod-levels',
        });
        const uniformBuffer = device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'batcher-lod-uniforms',
        });

        trackGpuBufferBytes(posBytes + lodBytes + 32);

        const layout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
            label: 'batcher-lod-layout',
        });

        const pipeline = await device.createComputePipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
            compute: {
                module: device.createShaderModule({ code: LOD_SELECT_WGSL }),
                entryPoint: 'main',
            },
            label: 'batcher-lod-pipeline',
        });

        const bindGroup = device.createBindGroup({
            layout,
            entries: [
                { binding: 0, resource: { buffer: positionBuffer } },
                { binding: 1, resource: { buffer: lodBuffer } },
                { binding: 2, resource: { buffer: uniformBuffer } },
            ],
        });

        _state = {
            maxInstances: cap,
            positionBuffer,
            lodBuffer,
            uniformBuffer,
            pipeline,
            bindGroup,
            indexMap: [],
            lodScratch: new Uint32Array(cap),
            readbackPending: false,
        };
        return true;
    })();

    return _initPromise;
}

function collectInstanceCount(meshTracks: Map<THREE.InstancedMesh, Float32Array>): number {
    let n = 0;
    for (const [mesh] of meshTracks) n += mesh.count;
    return n;
}

/**
 * Apply pipelined GPU LOD readback when ready. Returns true if GPU path handled this frame.
 */
export async function applyGpuBatcherLodIfReady(
    meshTracks: Map<THREE.InstancedMesh, Float32Array>,
    cfg: FoliageLodConfig,
    delta: number,
    onFactor: (factor: number) => void
): Promise<boolean> {
    if (!_state || !_state.readbackPending || !_state.lodScratch) {
        setLastFrameGpuLod(false);
        return false;
    }

    const total = _state.indexMap.length;
    if (total === 0) return false;

    const gpu = getSharedGPUCompute();
    const lodData = await gpu.readBufferU32(_state.lodBuffer!, total * 4);
    _state.lodScratch.set(lodData.subarray(0, total));
    _state.readbackPending = false;

    const blendT = cfg.blendSeconds > 0 ? Math.min(1, delta / cfg.blendSeconds) : 1;
    let flat = 0;

    for (const [mesh, smoothed] of meshTracks) {
        const count = mesh.count;
        if (count === 0) continue;
        const attr = mesh.geometry.getAttribute('instanceLod') as THREE.InstancedBufferAttribute;
        const attrArray = attr.array as Float32Array;

        for (let i = 0; i < count; i++) {
            const target = lodLevelToFactor(_state.lodScratch[flat]);
            const next = smoothed[i] + (target - smoothed[i]) * blendT;
            smoothed[i] = next;
            attrArray[i] = next;
            onFactor(next);
            flat++;
        }
        attr.needsUpdate = true;
    }

    setLastFrameGpuLod(true);
    return true;
}

/**
 * Dispatch GPU LOD for the next frame. Non-blocking.
 */
export async function dispatchGpuBatcherLod(
    camera: THREE.Camera,
    meshTracks: Map<THREE.InstancedMesh, Float32Array>,
    cfg: FoliageLodConfig
): Promise<boolean> {
    if (!preferGpuCompute() || !isGpuComputeReady()) return false;

    const totalInstances = collectInstanceCount(meshTracks);
    if (totalInstances === 0) return false;

    const ready = await ensureLodGpu(totalInstances);
    if (!ready || !_state) return false;

    const gpu = getSharedGPUCompute();
    const device = gpu.getDevice()!;

    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    const positions = new Float32Array(totalInstances * 3);
    _state.indexMap.length = 0;

    for (const [mesh] of meshTracks) {
        const count = mesh.count;
        if (count === 0) continue;
        const matrixArray = mesh.instanceMatrix.array as Float32Array;
        for (let i = 0; i < count; i++) {
            const offset = i * 16;
            const pOff = _state.indexMap.length * 3;
            positions[pOff] = matrixArray[offset + 12];
            positions[pOff + 1] = matrixArray[offset + 13];
            positions[pOff + 2] = matrixArray[offset + 14];
            _state.indexMap.push({ mesh, localIndex: i });
        }
    }

    gpu.writeStorageBuffer(_state.positionBuffer!, positions);

    const uniforms = new Float32Array([
        camPos.x,
        camPos.y,
        camPos.z,
        cfg.heroMax,
        cfg.midMax,
        cfg.farCull,
        totalInstances,
        0,
    ]);
    gpu.writeUniformBuffer(_state.uniformBuffer!, uniforms);

    const encoder = device.createCommandEncoder({ label: 'batcher-lod-encoder' });
    const pass = encoder.beginComputePass({ label: 'batcher-lod-pass' });
    pass.setPipeline(_state.pipeline!);
    pass.setBindGroup(0, _state.bindGroup!);
    pass.dispatchWorkgroups(Math.ceil(totalInstances / WORKGROUP));
    pass.end();
    device.queue.submit([encoder.finish()]);

    _state.readbackPending = true;
    return true;
}

export function isGpuBatcherLodPending(): boolean {
    return _state?.readbackPending ?? false;
}

export function disposeGpuBatcherLod(): void {
    _state?.positionBuffer?.destroy();
    _state?.lodBuffer?.destroy();
    _state?.uniformBuffer?.destroy();
    _state = null;
    _initPromise = null;
}
