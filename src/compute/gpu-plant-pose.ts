/**
 * @file gpu-plant-pose.ts
 * @brief GPU compute replacement for `PlantPoseMachine` ADSR pose envelopes.
 *
 * Mirrors `src/foliage/plant-pose-machine.ts` math for tier-parity alignment.
 * Stateful envelope + currentPose live in a GPU storage buffer between frames.
 */

import type { PlantPoseConfig } from '../foliage/plant-pose-machine.ts';
import {
    preferGpuCompute,
    isGpuComputeReady,
    setLastFrameGpuFoliage,
    trackGpuBufferBytes,
} from './compute-orchestrator.ts';
import { getSharedGPUCompute } from './gpu-compute-library.ts';
import { isGpuFoliageDefaultPath } from './gpu-foliage-flag.ts';

const PLANT_POSE_WGSL = /* wgsl */ `
struct Uniforms {
    delta: f32,
    channelIntensity: f32,
    dayNightBias: f32,
    attackRate: f32,
    releaseRate: f32,
    sustainLevel: f32,
    dayTarget: f32,
    nightTarget: f32,
    triggerThreshold: f32,
    waveActive: u32,
    waveOriginX: f32,
    waveOriginY: f32,
    waveOriginZ: f32,
    waveRadiusSq: f32,
    count: u32,
    _pad0: u32,
    _pad1: u32,
};

struct InstanceState {
    envelopeLevel: f32,
    currentPose: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec3<f32>>;
@group(0) @binding(2) var<storage, read_write> state: array<InstanceState>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u.count) { return; }

    var triggerValue = u.channelIntensity;

    if (u.waveActive != 0u) {
        let pos = positions[i];
        let dx = pos.x - u.waveOriginX;
        let dy = pos.y - u.waveOriginY;
        let dz = pos.z - u.waveOriginZ;
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < u.waveRadiusSq && u.waveRadiusSq > 0.0) {
            let progress = 1.0 - (distSq / u.waveRadiusSq);
            triggerValue = min(1.0, progress * 2.0);
        } else {
            triggerValue = 0.0;
        }
    }

    var env = state[i].envelopeLevel;
    if (triggerValue > u.triggerThreshold) {
        env = env + u.attackRate * u.delta;
        if (env > 1.0) { env = 1.0; }
    } else {
        env = env - u.releaseRate * u.delta;
        if (env < 0.0) { env = 0.0; }
    }

    let baseline = u.nightTarget + (u.dayTarget - u.nightTarget) * u.dayNightBias;
    let envelopePeak = u.dayTarget * u.sustainLevel;
    let targetPose = baseline + (envelopePeak - baseline) * env;

    var pose = state[i].currentPose;
    let lerpK = min(1.0, u.attackRate * u.delta);
    pose = pose + (targetPose - pose) * lerpK;

    state[i].envelopeLevel = env;
    state[i].currentPose = pose;
}
`;

export interface GpuPlantPoseWave {
    originX: number;
    originY: number;
    originZ: number;
    radiusSq: number;
}

export interface GpuPlantPoseParams {
    count: number;
    delta: number;
    channelIntensity: number;
    dayNightBias: number;
    config: PlantPoseConfig;
    wave?: GpuPlantPoseWave | null;
}

interface PoseGpuState {
    maxCount: number;
    positionBuffer: GPUBuffer | null;
    stateBuffer: GPUBuffer | null;
    uniformBuffer: GPUBuffer | null;
    pipeline: GPUComputePipeline | null;
    bindGroup: GPUBindGroup | null;
    /** CPU mirror for readback without stalling when pipelined. */
    poseStaging: Float32Array | null;
    /** Persistent double-buffered readback to avoid sync stalls */
    readbackBuffers: GPUBuffer[] | null;
    readbackIndex: number;
    prevCount: number;
}

let _poseGpu: PoseGpuState | null = null;
let _initPromise: Promise<boolean> | null = null;
let _trackedBytes = 0;
let _deviceLostUnsub: (() => void) | null = null;

const UNIFORM_FLOATS = 16; // 64 bytes
const STATE_FLOATS_PER_INSTANCE = 2; // envelope + currentPose

function shouldRunGpuPlantPose(count: number): boolean {
    return isGpuFoliageDefaultPath() && count > 0;
}

async function ensurePoseGpu(maxCount: number): Promise<boolean> {
    if (!shouldRunGpuPlantPose(1)) return false;
    if (_initPromise && _poseGpu && _poseGpu.maxCount >= maxCount) return _initPromise;

    _initPromise = (async () => {
        if (!preferGpuCompute() || !isGpuComputeReady()) return false;

        const gpu = getSharedGPUCompute();
        const device = gpu.getDevice();
        if (!device) return false;

        disposePoseGpuInternal();

        const cap = Math.max(maxCount, 256);
        const posBytes = cap * 12;
        const stateBytes = cap * STATE_FLOATS_PER_INSTANCE * 4;
        const uniformBytes = UNIFORM_FLOATS * 4;

        const positionBuffer = device.createBuffer({
            size: posBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'gpu-plant-pose-positions',
        });
        const stateBuffer = device.createBuffer({
            size: stateBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            label: 'gpu-plant-pose-state',
        });
        const uniformBuffer = device.createBuffer({
            size: uniformBytes,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'gpu-plant-pose-uniforms',
        });

        _trackedBytes = posBytes + stateBytes + uniformBytes;
        trackGpuBufferBytes(_trackedBytes);

        const layout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
            label: 'gpu-plant-pose-layout',
        });

        const pipeline = await device.createComputePipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
            compute: {
                module: device.createShaderModule({ code: PLANT_POSE_WGSL, label: 'gpu-plant-pose' }),
                entryPoint: 'main',
            },
            label: 'gpu-plant-pose-pipeline',
        });

        const bindGroup = device.createBindGroup({
            layout,
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: { buffer: positionBuffer } },
                { binding: 2, resource: { buffer: stateBuffer } },
            ],
            label: 'gpu-plant-pose-bind-group',
        });

        const readbackBuffers = [
            device.createBuffer({
                size: stateBytes,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                label: 'gpu-plant-pose-readback-0',
            }),
            device.createBuffer({
                size: stateBytes,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                label: 'gpu-plant-pose-readback-1',
            }),
        ];

        _poseGpu = {
            maxCount: cap,
            positionBuffer,
            stateBuffer,
            uniformBuffer,
            pipeline,
            bindGroup,
            poseStaging: new Float32Array(cap),
            readbackBuffers,
            readbackIndex: 0,
            prevCount: 0,
        };

        if (!_deviceLostUnsub) {
            const { onGpuDeviceLost } = await import('../rendering/gpu-context.ts');
            _deviceLostUnsub = onGpuDeviceLost(() => {
                disposePoseGpuInternal();
            });
        }

        return true;
    })();

    return _initPromise;
}

function disposePoseGpuInternal(): void {
    if (_trackedBytes > 0) {
        trackGpuBufferBytes(-_trackedBytes);
        _trackedBytes = 0;
    }
    _poseGpu?.positionBuffer?.destroy();
    _poseGpu?.stateBuffer?.destroy();
    _poseGpu?.uniformBuffer?.destroy();
    if (_poseGpu?.readbackBuffers) {
        _poseGpu.readbackBuffers[0].destroy();
        _poseGpu.readbackBuffers[1].destroy();
    }
    _poseGpu = null;
    _initPromise = null;
}

/** Upload static world positions once per registration batch (xyz interleaved). */
export function uploadGpuPlantPositions(positions: Float32Array, count: number): void {
    if (!shouldRunGpuPlantPose(count) || !_poseGpu?.positionBuffer) return;
    const gpu = getSharedGPUCompute();
    gpu.writeStorageBuffer(_poseGpu.positionBuffer, positions.subarray(0, count * 3));
}

/** Reset GPU envelope state for a slot (e.g. on register). */
export function resetGpuPlantPoseSlot(index: number, value = 0): void {
    if (!_poseGpu?.poseStaging) return;
    _poseGpu.poseStaging[index * 2] = 0; // envelope
    _poseGpu.poseStaging[index * 2 + 1] = value; // currentPose
    // Full state upload happens on next dispatch via partial write — for register,
    // CPU path reset is sufficient until GPU path runs.
}

/**
 * Advance poses on GPU and read back currentPose values.
 * Returns null to fall back to CPU PlantPoseMachine.
 */
export async function runGpuPlantPose(params: GpuPlantPoseParams): Promise<Float32Array | null> {
    const { count, delta, channelIntensity, dayNightBias, config, wave } = params;
    if (!shouldRunGpuPlantPose(count)) return null;

    const ready = await ensurePoseGpu(count);
    if (!ready || !_poseGpu) return null;

    const gpu = getSharedGPUCompute();
    const device = gpu.getDevice();
    if (!device) return null;

    const uniformBuf = new ArrayBuffer(UNIFORM_FLOATS * 4);
    const f32 = new Float32Array(uniformBuf);
    const u32 = new Uint32Array(uniformBuf);

    f32[0] = delta;
    f32[1] = channelIntensity;
    f32[2] = dayNightBias;
    f32[3] = config.attackRate;
    f32[4] = config.releaseRate;
    f32[5] = config.sustainLevel;
    f32[6] = config.dayTarget;
    f32[7] = config.nightTarget;
    f32[8] = config.triggerThreshold;
    u32[9] = wave ? 1 : 0;
    f32[10] = wave?.originX ?? 0;
    f32[11] = wave?.originY ?? 0;
    f32[12] = wave?.originZ ?? 0;
    f32[13] = wave?.radiusSq ?? 0;
    u32[14] = count;

    gpu.writeUniformBuffer(_poseGpu.uniformBuffer!, f32);

    const encoder = device.createCommandEncoder({ label: 'gpu-plant-pose' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(_poseGpu.pipeline!);
    pass.setBindGroup(0, _poseGpu.bindGroup!);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();

    // ⚡ OPTIMIZATION: Persistent ping-pong readback buffers to avoid GC and GPU sync stalls
    // Only copy active elements to save memory bandwidth
    const readBytes = count * STATE_FLOATS_PER_INSTANCE * 4;
    const currentBuffer = _poseGpu.readbackBuffers![_poseGpu.readbackIndex];
    const prevBuffer = _poseGpu.readbackBuffers![1 - _poseGpu.readbackIndex];

    // Ensure the current buffer is unmapped before copying into it to avoid WebGPU validation errors
    if (currentBuffer.mapState !== 'unmapped') {
        currentBuffer.unmap();
    }

    // Copy current state to the staging buffer for this frame
    encoder.copyBufferToBuffer(_poseGpu.stateBuffer!, 0, currentBuffer, 0, readBytes);
    device.queue.submit([encoder.finish()]);

    // Map the current buffer for the NEXT frame (do not await)
    currentBuffer.mapAsync(GPUMapMode.READ).catch(() => {});

    // Read the results from the PREVIOUS frame
    const poses = _poseGpu.poseStaging!;
    if (prevBuffer.mapState === 'mapped') {
        const mapped = new Float32Array(prevBuffer.getMappedRange());
        const readCount = Math.min(_poseGpu.prevCount, count);
        for (let i = 0; i < readCount; i++) {
            poses[i] = mapped[i * 2 + 1];
        }
        prevBuffer.unmap();
    }

    // Update state for next frame
    _poseGpu.readbackIndex = 1 - _poseGpu.readbackIndex;
    _poseGpu.prevCount = count;

    setLastFrameGpuFoliage(true);
    // Return a view of just the active count to avoid out-of-bounds processing downstream
    return poses.subarray(0, count);
}

/** Synchronous gate for batchers — async work must be awaited by caller. */
export function shouldUseGpuPlantPose(count: number): boolean {
    return isGpuFoliageDefaultPath() && count > 0;
}

export function disposeGpuPlantPose(): void {
    disposePoseGpuInternal();
    _deviceLostUnsub?.();
    _deviceLostUnsub = null;
}

/** Reference implementation for tier-parity tests (matches WGSL). */
export function computePlantPoseFrameTS(
    count: number,
    delta: number,
    channelIntensity: number,
    dayNightBias: number,
    config: PlantPoseConfig,
    positions: Float32Array,
    envelopeLevels: Float32Array,
    currentPoses: Float32Array,
    wave?: GpuPlantPoseWave | null
): void {
    const { attackRate, releaseRate, sustainLevel, dayTarget, nightTarget, triggerThreshold } = config;
    const baseline = nightTarget + (dayTarget - nightTarget) * dayNightBias;
    const envelopePeak = dayTarget * sustainLevel;
    const lerpK = Math.min(1.0, attackRate * delta);

    for (let i = 0; i < count; i++) {
        let triggerValue = channelIntensity;
        if (wave) {
            const px = positions[i * 3];
            const py = positions[i * 3 + 1];
            const pz = positions[i * 3 + 2];
            const dx = px - wave.originX;
            const dy = py - wave.originY;
            const dz = pz - wave.originZ;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < wave.radiusSq && wave.radiusSq > 0) {
                const progress = 1.0 - distSq / wave.radiusSq;
                triggerValue = Math.min(1.0, progress * 2.0);
            } else {
                triggerValue = 0;
            }
        }

        if (triggerValue > triggerThreshold) {
            envelopeLevels[i] += attackRate * delta;
            if (envelopeLevels[i] > 1.0) envelopeLevels[i] = 1.0;
        } else {
            envelopeLevels[i] -= releaseRate * delta;
            if (envelopeLevels[i] < 0.0) envelopeLevels[i] = 0.0;
        }

        const targetPose = baseline + (envelopePeak - baseline) * envelopeLevels[i];
        currentPoses[i] += (targetPose - currentPoses[i]) * lerpK;
    }
}
