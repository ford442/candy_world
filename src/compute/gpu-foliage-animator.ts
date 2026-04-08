/**
 * @file gpu-foliage-animator.ts
 * @description GPU-accelerated batch foliage animation using WebGPU compute shaders.
 *
 * Replaces CPU-bound `animateFoliage()` calls with GPU compute shaders for massive
 * batch animation of foliage instances. Supports up to 10,000 instances with
 * various animation types like sway, bounce, wobble, and audio-reactive effects.
 *
 * @example
 * ```ts
 * const animator = new GPUFoliageAnimator(gpu, 10000);
 * await animator.initialize();
 * animator.uploadInstances(foliageData);
 * animator.update(time, audioState);
 * const results = await animator.readbackResults();
 * ```
 */

import { GPUComputeLibrary } from './gpu-compute-library';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

/**
 * Foliage instance data for GPU animation.
 * All arrays should have consistent lengths based on instance count.
 */
export interface FoliageInstanceData {
    /** Positions [x, y, z, x, y, z, ...] - length = instanceCount * 3 */
    positions: Float32Array;
    /** Rotations [rotX, rotY, rotZ, ...] - length = instanceCount * 3 */
    rotations: Float32Array;
    /** Scales [scaleX, scaleY, scaleZ, ...] - length = instanceCount * 3 */
    scales: Float32Array;
    /** Animation type per instance (see AnimationType enum) */
    animTypes: Uint32Array;
    /** Animation offset for variation */
    animOffsets: Float32Array;
    /** Animation intensity multipliers */
    intensities: Float32Array;
}

/**
 * Audio state for reactive foliage animations.
 */
export interface FoliageAudioState {
    /** Kick drum intensity (0-1) */
    kick: number;
    /** Groove/beat intensity (0-1) */
    groove: number;
    /** Current beat phase (0-1) */
    beatPhase: number;
    /** Whether it's day time (affects animation style) */
    isDay: boolean;
}

/**
 * Animation type identifiers.
 * These must match the WGSL shader definitions.
 */
export enum AnimationType {
    NONE = 0,
    GENTLE_SWAY = 1,
    BOUNCE = 2,
    WOBBLE = 3,
    HOP = 4,
    SHIVER = 5,
    SPRING = 6,
    VINE_SWAY = 7,
    SPIRAL_WAVE = 8,
    FLOAT = 9,
    SPIN = 10,
    GLOW_PULSE = 11,
    CLOUD_BOB = 12,
}

/**
 * GPU compute output for foliage instances.
 */
export interface FoliageAnimationOutput {
    /** Updated positions [x, y, z, ...] */
    positions: Float32Array;
    /** Updated rotations [rotX, rotY, rotZ, ...] */
    rotations: Float32Array;
}

// =============================================================================
// WGSL COMPUTE SHADER
// =============================================================================

/**
 * WGSL shader for foliage animation.
 * 
 * Instance Buffer Layout (48 bytes per instance):
 *   pos: vec3<f32>       offset 0
 *   animType: u32        offset 12
 *   rot: vec3<f32>       offset 16
 *   animOffset: f32      offset 28
 *   scale: vec3<f32>     offset 32
 *   intensity: f32       offset 44
 * 
 * Output Buffer Layout:
 *   Even indices: position (x, y, z, 0)
 *   Odd indices: rotation (rotX, rotY, rotZ, 0)
 * 
 * Uniform Buffer Layout (32 bytes):
 *   time: f32            offset 0
 *   beatPhase: f32       offset 4
 *   kick: f32            offset 8
 *   groove: f32          offset 12
 *   isDay: u32           offset 16
 *   instanceCount: u32   offset 20
 *   _pad0: u32           offset 24
 *   _pad1: u32           offset 28
 */
export const FOLIAGE_ANIMATION_WGSL = /* wgsl */ `
struct Instance {
    pos: vec3<f32>,
    animType: u32,
    rot: vec3<f32>,
    animOffset: f32,
    scale: vec3<f32>,
    intensity: f32,
};

struct Uniforms {
    time: f32,
    beatPhase: f32,
    kick: f32,
    groove: f32,
    isDay: u32,
    instanceCount: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<storage, read> instances: array<Instance>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> u: Uniforms;

// Animation type constants
const ANIM_NONE: u32 = 0u;
const ANIM_GENTLE_SWAY: u32 = 1u;
const ANIM_BOUNCE: u32 = 2u;
const ANIM_WOBBLE: u32 = 3u;
const ANIM_HOP: u32 = 4u;
const ANIM_SHIVER: u32 = 5u;
const ANIM_SPRING: u32 = 6u;
const ANIM_VINE_SWAY: u32 = 7u;
const ANIM_SPIRAL_WAVE: u32 = 8u;
const ANIM_FLOAT: u32 = 9u;
const ANIM_SPIN: u32 = 10u;
const ANIM_GLOW_PULSE: u32 = 11u;
const ANIM_CLOUD_BOB: u32 = 12u;

// Easing functions
fn easeOutBounce(t: f32) -> f32 {
    let n1 = 7.5625;
    let d1 = 2.75;
    
    if (t < 1.0 / d1) {
        return n1 * t * t;
    } else if (t < 2.0 / d1) {
        let t2 = t - 1.5 / d1;
        return n1 * t2 * t2 + 0.75;
    } else if (t < 2.5 / d1) {
        let t2 = t - 2.25 / d1;
        return n1 * t2 * t2 + 0.9375;
    } else {
        let t2 = t - 2.625 / d1;
        return n1 * t2 * t2 + 0.984375;
    }
}

fn easeInOutSine(t: f32) -> f32 {
    return -(cos(3.14159265359 * t) - 1.0) / 2.0;
}

// Animation functions
fn animateGentleSway(pos: vec3<f32>, rot: vec3<f32>, t: f32, offset: f32, intensity: f32, isDay: bool) -> vec4<f32> {
    let swayFreq = select(0.3, 0.5, isDay);
    let swayAmp = select(0.05, 0.1, isDay) * intensity;
    let angle = sin(t * swayFreq + offset) * swayAmp;
    return vec4<f32>(rot.x, rot.y + angle, rot.z, 0.0);
}

fn animateBounce(pos: vec3<f32>, t: f32, offset: f32, intensity: f32, beatPhase: f32) -> vec3<f32> {
    let bounceFreq = 3.0;
    let bounce = sin(t * bounceFreq + offset) * 0.2 * intensity;
    let beatBounce = sin(beatPhase * 3.14159265359 * 2.0) * 0.1 * intensity;
    return vec3<f32>(pos.x, pos.y + max(0.0, bounce) + beatBounce, pos.z);
}

fn animateWobble(pos: vec3<f32>, rot: vec3<f32>, t: f32, offset: f32, intensity: f32) -> vec4<f32> {
    let wobbleX = sin(t * 2.0 + offset) * 0.1 * intensity;
    let wobbleZ = cos(t * 1.7 + offset * 1.3) * 0.1 * intensity;
    return vec4<f32>(rot.x + wobbleX, rot.y, rot.z + wobbleZ, 0.0);
}

fn animateHop(pos: vec3<f32>, t: f32, offset: f32, intensity: f32, beatPhase: f32) -> vec3<f32> {
    let hopPhase = fract(t * 2.0 + offset * 0.5);
    let hopHeight = easeOutBounce(1.0 - hopPhase) * 0.5 * intensity;
    let beatBoost = step(0.9, beatPhase) * 0.2 * intensity;
    return vec3<f32>(pos.x, pos.y + hopHeight + beatBoost, pos.z);
}

fn animateShiver(pos: vec3<f32>, rot: vec3<f32>, t: f32, offset: f32, intensity: f32) -> vec4<f32> {
    let shiver = sin(t * 20.0 + offset * 10.0) * 0.05 * intensity;
    return vec4<f32>(rot.x + shiver, rot.y + shiver * 0.5, rot.z + shiver * 0.3, 0.0);
}

fn animateSpring(pos: vec3<f32>, scale: vec3<f32>, t: f32, offset: f32, intensity: f32) -> vec3<f32> {
    let springPhase = sin(t * 4.0 + offset) * 0.5 + 0.5;
    let squash = 1.0 - springPhase * 0.2 * intensity;
    let stretch = 1.0 + springPhase * 0.2 * intensity;
    return scale * vec3<f32>(squash, stretch, squash);
}

fn animateVineSway(pos: vec3<f32>, rot: vec3<f32>, t: f32, offset: f32, intensity: f32, isDay: bool) -> vec4<f32> {
    let cascade = sin(t * 0.4 + offset + pos.y * 0.5) * 0.15 * intensity;
    let windGust = select(0.0, sin(t * 0.8) * 0.05, isDay);
    return vec4<f32>(rot.x + cascade, rot.y + windGust, rot.z, 0.0);
}

fn animateSpiralWave(pos: vec3<f32>, t: f32, offset: f32, intensity: f32) -> vec3<f32> {
    let spiralT = t * 0.5 + offset;
    let radius = 0.1 * intensity;
    let x = cos(spiralT * 2.0) * radius;
    let z = sin(spiralT * 2.0) * radius;
    return vec3<f32>(pos.x + x, pos.y, pos.z + z);
}

fn animateFloat(pos: vec3<f32>, t: f32, offset: f32, intensity: f32) -> vec3<f32> {
    let floatY = sin(t * 0.3 + offset) * 0.15 * intensity;
    let driftX = cos(t * 0.2 + offset * 0.7) * 0.05 * intensity;
    return vec3<f32>(pos.x + driftX, pos.y + floatY, pos.z);
}

fn animateSpin(rot: vec3<f32>, t: f32, offset: f32, intensity: f32) -> vec4<f32> {
    let spinSpeed = 1.0 * intensity;
    return vec4<f32>(rot.x, rot.y + t * spinSpeed + offset, rot.z, 0.0);
}

fn animateGlowPulse(pos: vec3<f32>, t: f32, offset: f32, intensity: f32, beatPhase: f32) -> vec3<f32> {
    let pulse = sin(t * 2.0 + offset) * 0.05 * intensity;
    let beatPulse = sin(beatPhase * 3.14159265359) * 0.03 * intensity;
    return vec3<f32>(pos.x, pos.y + pulse + beatPulse, pos.z);
}

fn animateCloudBob(pos: vec3<f32>, t: f32, offset: f32, intensity: f32) -> vec3<f32> {
    let bobY = sin(t * 0.2 + offset) * 0.3 * intensity;
    let bobX = cos(t * 0.15 + offset * 0.5) * 0.1 * intensity;
    let bobZ = sin(t * 0.1 + offset * 0.3) * 0.1 * intensity;
    return vec3<f32>(pos.x + bobX, pos.y + bobY, pos.z + bobZ);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.instanceCount) { return; }
    
    let instance = instances[idx];
    var newPos = instance.pos;
    var newRot = instance.rot;
    var newScale = instance.scale;
    
    let t = u.time + instance.animOffset;
    let intensity = instance.intensity;
    let isDay = u.isDay != 0u;
    
    switch(instance.animType) {
        case ANIM_NONE: {
            // No animation
        }
        case ANIM_GENTLE_SWAY: {
            newRot = animateGentleSway(instance.pos, instance.rot, t, instance.animOffset, intensity, isDay).xyz;
        }
        case ANIM_BOUNCE: {
            newPos = animateBounce(instance.pos, t, instance.animOffset, intensity, u.beatPhase);
        }
        case ANIM_WOBBLE: {
            newRot = animateWobble(instance.pos, instance.rot, t, instance.animOffset, intensity).xyz;
        }
        case ANIM_HOP: {
            newPos = animateHop(instance.pos, t, instance.animOffset, intensity, u.beatPhase);
        }
        case ANIM_SHIVER: {
            newRot = animateShiver(instance.pos, instance.rot, t, instance.animOffset, intensity).xyz;
        }
        case ANIM_SPRING: {
            newScale = animateSpring(instance.pos, instance.scale, t, instance.animOffset, intensity);
        }
        case ANIM_VINE_SWAY: {
            newRot = animateVineSway(instance.pos, instance.rot, t, instance.animOffset, intensity, isDay).xyz;
        }
        case ANIM_SPIRAL_WAVE: {
            newPos = animateSpiralWave(instance.pos, t, instance.animOffset, intensity);
            newRot = vec3<f32>(instance.rot.x, instance.rot.y + sin(t) * 0.1 * intensity, instance.rot.z);
        }
        case ANIM_FLOAT: {
            newPos = animateFloat(instance.pos, t, instance.animOffset, intensity);
        }
        case ANIM_SPIN: {
            newRot = animateSpin(instance.rot, t, instance.animOffset, intensity).xyz;
        }
        case ANIM_GLOW_PULSE: {
            newPos = animateGlowPulse(instance.pos, t, instance.animOffset, intensity, u.beatPhase);
        }
        case ANIM_CLOUD_BOB: {
            newPos = animateCloudBob(instance.pos, t, instance.animOffset, intensity);
        }
        default: {
            // Unknown animation type, keep original
        }
    }
    
    // Apply kick reaction (global intensity boost on beat)
    if (u.kick > 0.1) {
        let kickScale = 1.0 + u.kick * 0.1 * intensity;
        newScale = newScale * kickScale;
    }
    
    // Apply groove sway
    if (u.groove > 0.1) {
        let grooveSway = sin(t * 4.0) * 0.05 * u.groove * intensity;
        newRot.y = newRot.y + grooveSway;
    }
    
    // Output: even indices = position, odd indices = rotation
    output[idx * 2u] = vec4<f32>(newPos, 0.0);
    output[idx * 2u + 1u] = vec4<f32>(newRot, 0.0);
}
`;

// =============================================================================
// GPU FOLIAGE ANIMATOR CLASS
// =============================================================================

/**
 * GPU-accelerated batch foliage animator.
 * 
 * Uses WebGPU compute shaders to animate thousands of foliage instances in parallel.
 * Supports 13 different animation types with audio-reactive features.
 * 
 * @example
 * ```ts
 * const gpu = new GPUComputeLibrary();
 * await gpu.initDevice();
 * 
 * const animator = new GPUFoliageAnimator(gpu, 10000);
 * await animator.initialize();
 * 
 * animator.uploadInstances(instanceData);
 * animator.update(time, { kick: 0.5, groove: 0.3, beatPhase: 0.2, isDay: true });
 * 
 * const results = await animator.readbackResults();
 * // Apply results to InstancedMesh...
 * ```
 */
export class GPUFoliageAnimator {
    private gpu: GPUComputeLibrary;
    private maxInstances: number;
    private instanceCount: number = 0;
    
    // GPU Buffers
    private instanceBuffer: GPUBuffer | null = null;
    private outputBuffer: GPUBuffer | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private indirectBuffer: GPUBuffer | null = null;
    
    // GPU Resources
    private pipeline: GPUComputePipeline | null = null;
    private bindGroup: GPUBindGroup | null = null;
    
    // CPU staging
    private instanceData: FoliageInstanceData | null = null;
    private outputStaging: Float32Array | null = null;
    
    // Constants
    private readonly INSTANCE_STRUCT_SIZE = 48; // bytes per instance
    private readonly OUTPUT_VEC4_SIZE = 16;     // bytes per vec4<f32>
    private readonly UNIFORM_BUFFER_SIZE = 32;  // bytes (padded)
    private readonly WORKGROUP_SIZE = 128;
    
    /**
     * Creates a new GPUFoliageAnimator.
     * 
     * @param gpu - Initialized GPUComputeLibrary instance
     * @param maxInstances - Maximum number of foliage instances to support (default: 10000)
     */
    constructor(gpu: GPUComputeLibrary, maxInstances: number = 10000) {
        this.gpu = gpu;
        this.maxInstances = Math.min(maxInstances, 10000);
        
        if (!this.gpu.isReady()) {
            console.warn('[GPUFoliageAnimator] GPU not ready. Call gpu.initDevice() before using animator.');
        }
    }
    
    /**
     * Initialize GPU resources (buffers, pipeline, bind group).
     * Must be called before using uploadInstances() or update().
     * 
     * @throws Error if GPU device is not initialized
     */
    async initialize(): Promise<void> {
        if (!this.gpu.isReady()) {
            throw new Error('[GPUFoliageAnimator] GPU device not initialized. Call gpu.initDevice() first.');
        }
        
        const instanceBufferSize = this.maxInstances * this.INSTANCE_STRUCT_SIZE;
        const outputBufferSize = this.maxInstances * 2 * this.OUTPUT_VEC4_SIZE; // position + rotation
        
        // Create buffers with initial dummy data
        const dummyInstanceData = new Float32Array(this.maxInstances * 12); // 12 floats per instance struct
        const dummyOutputData = new Float32Array(this.maxInstances * 8);    // 2 vec4 per instance
        const dummyUniformData = new Float32Array(8); // 8 floats (32 bytes)
        
        this.instanceBuffer = this.gpu.createStorageBuffer(dummyInstanceData, 'foliage-instances');
        this.outputBuffer = this.gpu.createStorageBuffer(dummyOutputData, 'foliage-output');
        this.uniformBuffer = this.gpu.createUniformBuffer(dummyUniformData, 'foliage-uniforms');
        
        // Create compute pipeline
        this.pipeline = await this.gpu.createComputePipeline({
            shader: FOLIAGE_ANIMATION_WGSL,
            workgroupSize: this.WORKGROUP_SIZE,
            bindingLayout: [
                { 
                    binding: 0, 
                    visibility: GPUShaderStage.COMPUTE, 
                    buffer: { type: 'read-only-storage' } 
                },
                { 
                    binding: 1, 
                    visibility: GPUShaderStage.COMPUTE, 
                    buffer: { type: 'storage' } 
                },
                { 
                    binding: 2, 
                    visibility: GPUShaderStage.COMPUTE, 
                    buffer: { type: 'uniform' } 
                },
            ],
            label: 'foliage-animation',
        });
        
        // Create bind group
        this.bindGroup = this.gpu.createBindGroup(
            this.pipeline,
            [this.instanceBuffer, this.outputBuffer, this.uniformBuffer],
            'foliage-bind-group'
        );
        
        // Pre-allocate output staging array
        this.outputStaging = new Float32Array(this.maxInstances * 8);
        
        console.log(`[GPUFoliageAnimator] Initialized for ${this.maxInstances} max instances`);
    }
    
    /**
     * Upload instance data to GPU.
     * 
     * @param data - Foliage instance data to upload
     * @throws Error if instance count exceeds maxInstances
     */
    uploadInstances(data: FoliageInstanceData): void {
        if (!this.gpu.isReady() || !this.instanceBuffer) {
            console.warn('[GPUFoliageAnimator] Cannot upload instances - not initialized');
            return;
        }
        
        this.instanceCount = data.positions.length / 3;
        
        if (this.instanceCount > this.maxInstances) {
            throw new Error(
                `[GPUFoliageAnimator] Instance count (${this.instanceCount}) exceeds max (${this.maxInstances})`
            );
        }
        
        this.instanceData = data;
        
        // Pack instance data into buffer (12 floats per instance)
        const packed = new Float32Array(this.instanceCount * 12);
        
        for (let i = 0; i < this.instanceCount; i++) {
            const base = i * 12;
            const posBase = i * 3;
            const rotBase = i * 3;
            const scaleBase = i * 3;
            
            // Position (3 floats) - offset 0
            packed[base + 0] = data.positions[posBase];
            packed[base + 1] = data.positions[posBase + 1];
            packed[base + 2] = data.positions[posBase + 2];
            
            // animType as float - offset 12 (will be cast to u32 in shader)
            packed[base + 3] = data.animTypes[i];
            
            // Rotation (3 floats) - offset 16
            packed[base + 4] = data.rotations[rotBase];
            packed[base + 5] = data.rotations[rotBase + 1];
            packed[base + 6] = data.rotations[rotBase + 2];
            
            // animOffset - offset 28
            packed[base + 7] = data.animOffsets[i];
            
            // Scale (3 floats) - offset 32
            packed[base + 8] = data.scales[scaleBase];
            packed[base + 9] = data.scales[scaleBase + 1];
            packed[base + 10] = data.scales[scaleBase + 2];
            
            // intensity - offset 44
            packed[base + 11] = data.intensities[i];
        }
        
        this.gpu.writeStorageBuffer(this.instanceBuffer, packed);
    }
    
    /**
     * Update animations on GPU.
     * 
     * @param time - Current time in seconds
     * @param audio - Audio state for reactive animations
     */
    update(time: number, audio: FoliageAudioState): void {
        if (!this.gpu.isReady() || !this.uniformBuffer || !this.pipeline || !this.bindGroup) {
            return;
        }
        
        if (this.instanceCount === 0) {
            return;
        }
        
        // Update uniforms
        const uniforms = new Float32Array([
            time,
            audio.beatPhase,
            audio.kick,
            audio.groove,
            audio.isDay ? 1 : 0,
            this.instanceCount,
            0, // _pad0
            0, // _pad1
        ]);
        
        this.gpu.writeUniformBuffer(this.uniformBuffer, uniforms);
        
        // Dispatch compute shader
        const workgroups = Math.ceil(this.instanceCount / this.WORKGROUP_SIZE);
        this.gpu.dispatchCompute(this.pipeline, this.bindGroup, workgroups);
    }
    
    /**
     * Read back animation results from GPU.
     * Note: This causes a GPU-to-CPU sync and should be used sparingly.
     * 
     * @returns Promise resolving to updated positions and rotations
     */
    async readbackResults(): Promise<FoliageAnimationOutput> {
        if (!this.gpu.isReady() || !this.outputBuffer) {
            return { positions: new Float32Array(0), rotations: new Float32Array(0) };
        }
        
        const outputSize = this.instanceCount * 2 * this.OUTPUT_VEC4_SIZE;
        const result = await this.gpu.readBuffer(this.outputBuffer, outputSize);
        
        // Unpack results
        const positions = new Float32Array(this.instanceCount * 3);
        const rotations = new Float32Array(this.instanceCount * 3);
        
        for (let i = 0; i < this.instanceCount; i++) {
            const base = i * 8; // 8 floats per instance (2 vec4s)
            
            // Position from even index
            positions[i * 3] = result[base];
            positions[i * 3 + 1] = result[base + 1];
            positions[i * 3 + 2] = result[base + 2];
            
            // Rotation from odd index
            rotations[i * 3] = result[base + 4];
            rotations[i * 3 + 1] = result[base + 5];
            rotations[i * 3 + 2] = result[base + 6];
        }
        
        return { positions, rotations };
    }
    
    /**
     * Get the output GPU buffer for use with indirect rendering.
     * The buffer contains vec4 positions and rotations interleaved.
     * 
     * @returns GPUBuffer or null if not initialized
     */
    getOutputBuffer(): GPUBuffer | null {
        return this.outputBuffer;
    }
    
    /**
     * Get the output buffer as a Float32Array for reading.
     * This is more efficient than readbackResults() for continuous access.
     * 
     * @returns Float32Array view of output or null
     */
    getOutputArray(): Float32Array | null {
        return this.outputStaging;
    }
    
    /**
     * Get the current instance count.
     */
    getInstanceCount(): number {
        return this.instanceCount;
    }
    
    /**
     * Get the maximum supported instances.
     */
    getMaxInstances(): number {
        return this.maxInstances;
    }
    
    /**
     * Check if the animator is ready to use.
     */
    isReady(): boolean {
        return this.gpu.isReady() && 
               this.pipeline !== null && 
               this.bindGroup !== null &&
               this.instanceBuffer !== null &&
               this.outputBuffer !== null &&
               this.uniformBuffer !== null;
    }
    
    /**
     * Destroy all GPU resources.
     * Call this when the animator is no longer needed.
     */
    destroy(): void {
        if (this.instanceBuffer) {
            this.instanceBuffer.destroy();
            this.instanceBuffer = null;
        }
        if (this.outputBuffer) {
            this.outputBuffer.destroy();
            this.outputBuffer = null;
        }
        if (this.uniformBuffer) {
            this.uniformBuffer.destroy();
            this.uniformBuffer = null;
        }
        if (this.indirectBuffer) {
            this.indirectBuffer.destroy();
            this.indirectBuffer = null;
        }
        
        this.pipeline = null;
        this.bindGroup = null;
        this.instanceData = null;
        this.outputStaging = null;
        this.instanceCount = 0;
        
        console.log('[GPUFoliageAnimator] Destroyed');
    }
}

// =============================================================================
// THREE.JS INTEGRATION HELPERS
// =============================================================================

import type * as THREE from 'three';

/**
 * Update a Three.js InstancedMesh with animation results.
 * 
 * @param mesh - The InstancedMesh to update
 * @param animator - The GPUFoliageAnimator with results
 * @param preserveScale - Whether to preserve original scales (default: true)
 */
export async function updateInstancedMeshFromAnimator(
    mesh: THREE.InstancedMesh,
    animator: GPUFoliageAnimator,
    preserveScale: boolean = true
): Promise<void> {
    const { positions, rotations } = await animator.readbackResults();
    const instanceCount = animator.getInstanceCount();
    
    const dummy = new THREE.Object3D();
    const scale = new THREE.Vector3();
    
    for (let i = 0; i < instanceCount; i++) {
        dummy.position.set(
            positions[i * 3],
            positions[i * 3 + 1],
            positions[i * 3 + 2]
        );
        dummy.rotation.set(
            rotations[i * 3],
            rotations[i * 3 + 1],
            rotations[i * 3 + 2]
        );
        
        if (preserveScale && animator['instanceData']) {
            const data = animator['instanceData'] as FoliageInstanceData;
            scale.set(
                data.scales[i * 3],
                data.scales[i * 3 + 1],
                data.scales[i * 3 + 2]
            );
            dummy.scale.copy(scale);
        }
        
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    
    mesh.instanceMatrix.needsUpdate = true;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a GPUFoliageAnimator with automatic initialization.
 * 
 * @param gpu - GPUComputeLibrary instance
 * @param maxInstances - Maximum number of instances
 * @returns Promise resolving to initialized animator
 */
export async function createGPUFoliageAnimator(
    gpu: GPUComputeLibrary,
    maxInstances: number = 10000
): Promise<GPUFoliageAnimator> {
    const animator = new GPUFoliageAnimator(gpu, maxInstances);
    await animator.initialize();
    return animator;
}

/**
 * Create foliage instance data from arrays of positions.
 * Useful for converting existing CPU-side data to GPU format.
 * 
 * @param positions - Array of [x, y, z] positions
 * @param animType - Default animation type for all instances
 * @param intensity - Default intensity for all instances
 * @returns FoliageInstanceData ready for uploadInstances()
 */
export function createFoliageInstanceData(
    positions: Float32Array | number[],
    animType: AnimationType = AnimationType.GENTLE_SWAY,
    intensity: number = 1.0
): FoliageInstanceData {
    const count = positions.length / 3;
    
    const posArray = positions instanceof Float32Array 
        ? positions 
        : new Float32Array(positions);
    
    return {
        positions: posArray,
        rotations: new Float32Array(count * 3), // All zero rotation
        scales: new Float32Array(count * 3).fill(1), // Uniform scale of 1
        animTypes: new Uint32Array(count).fill(animType),
        animOffsets: new Float32Array(count).map((_, i) => i * 0.1), // Staggered offsets
        intensities: new Float32Array(count).fill(intensity),
    };
}

// =============================================================================
// FALLBACK CHAIN
// =============================================================================

/**
 * Fallback priority for foliage animation:
 * 
 * 1. GPUFoliageAnimator (WebGPU compute) - Best for 1000+ instances
 * 2. FoliageBatcher (TSL-based) - Three.js shader nodes
 * 3. wasmUpdateFoliageBatch (AssemblyScript) - SIMD-optimized WASM
 * 4. animateFoliage (CPU JS) - Baseline JavaScript implementation
 * 
 * Use detectFoliageAnimator() to automatically select the best available option.
 */

export interface FoliageAnimatorCapabilities {
    webgpu: boolean;
    webgl2: boolean;
    wasm: boolean;
}

/**
 * Detect available foliage animation capabilities.
 */
export function detectFoliageCapabilities(): FoliageAnimatorCapabilities {
    return {
        webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
        webgl2: typeof document !== 'undefined' && !!document.createElement('canvas').getContext('webgl2'),
        wasm: typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0x00, 0x61, 0x73, 0x6d])),
    };
}
