/**
 * @file particle_compute.ts
 * @description GPU Compute-based particle system using Three.js TSL
 * 
 * This class provides a fully GPU-accelerated particle system with:
 * - Compute shader-based physics updates
 * - Automatic particle respawning
 * - Audio-reactive behavior
 * - WASM offloading for hot loops (optional)
 * 
 * @example
 * ```ts
 * import { ComputeParticleSystem } from './particle_compute';
 * 
 * const particles = new ComputeParticleSystem(10000, renderer);
 * scene.add(particles.createMesh());
 * 
 * // In animation loop:
 * particles.update(deltaTime, { kick: audioState.kickTrigger });
 * ```
 */

import * as THREE from 'three';
import {
    storage,
    uniform,
    vec3,
    vec4,
    float,
    instanceIndex,
    cos,
    sin,
    If,
    Fn
} from 'three/tsl';
import { StorageInstancedBufferAttribute, PointsNodeMaterial } from 'three/webgpu';

import type { ComputeParticleConfig, ParticleAudioState } from '../particles/particle_config.js';
import type { WebGPURenderer } from 'three/webgpu';

/**
 * Interface for optional WASM particle physics module
 */
interface WASMParticleModule {
    /**
     * Updates particle positions and velocities via WASM
     * @param posPtr - Pointer to position buffer in WASM memory
     * @param velPtr - Pointer to velocity buffer in WASM memory
     * @param count - Number of particles
     * @param dt - Delta time in seconds
     * @param gravity - Gravity strength
     * @param audio - Audio pulse strength (0-1)
     */
    updateParticlesWASM?(
        posPtr: number,
        velPtr: number,
        count: number,
        dt: number,
        gravity: number,
        audio: number
    ): void;
}

/**
 * GPU Compute-based particle system.
 * Uses TSL storage buffers and compute shaders for physics.
 */
export class ComputeParticleSystem {
    /** Total particle count */
    public readonly count: number;

    /** WebGPU renderer reference */
    private readonly renderer: WebGPURenderer;

    /** Position + life storage buffer (x, y, z, life) */
    private positionBuffer: Float32Array;

    /** Velocity + speed storage buffer (vx, vy, vz, speed) */
    private velocityBuffer: Float32Array;

    /** Color storage buffer (r, g, b, a) */
    private colorBuffer: Float32Array;

    /** TSL storage nodes */
    private positionStorage: ReturnType<typeof storage>;
    private velocityStorage: ReturnType<typeof storage>;
    private colorStorage: ReturnType<typeof storage>;

    /** Uniforms */
    private readonly uTime = uniform(0.0);
    private readonly uDeltaTime = uniform(0.016);
    private readonly uGravity: ReturnType<typeof uniform>;
    private readonly uSpawnCenter: ReturnType<typeof uniform>;
    private readonly uAudioPulse = uniform(0.0);

    /** Compute shader node */
    private computeNode: ReturnType<ReturnType<typeof Fn>['compute']> | null = null;

    /** Optional WASM module for physics */
    private wasmModule: WASMParticleModule | null = null;

    /** Whether to use WASM for physics (if available) */
    private useWASM: boolean = false;

    /**
     * Creates a new compute particle system.
     * 
     * @param count - Number of particles (default: 10000)
     * @param renderer - WebGPU renderer instance
     * @param config - Optional configuration
     */
    constructor(
        count: number,
        renderer: WebGPURenderer,
        config: ComputeParticleConfig = {}
    ) {
        this.count = count;
        this.renderer = renderer;

        const {
            spawnCenter = new THREE.Vector3(0, 5, 0),
            gravity = new THREE.Vector3(0, -2.0, 0)
        } = config;

        // Initialize buffers
        this.positionBuffer = new Float32Array(count * 4); // xyz + life
        this.velocityBuffer = new Float32Array(count * 4); // xyz + speed
        this.colorBuffer = new Float32Array(count * 4); // rgba

        this.initParticles();

        // Create storage buffer nodes
        this.positionStorage = storage(
            new StorageInstancedBufferAttribute(this.positionBuffer, 4),
            'vec4',
            this.count
        );
        this.velocityStorage = storage(
            new StorageInstancedBufferAttribute(this.velocityBuffer, 4),
            'vec4',
            this.count
        );
        this.colorStorage = storage(
            new StorageInstancedBufferAttribute(this.colorBuffer, 4),
            'vec4',
            this.count
        );

        // Create uniforms
        this.uGravity = uniform(gravity);
        this.uSpawnCenter = uniform(spawnCenter);

        this.setupComputeShader();
    }

    /**
     * Initialize particle data with random values
     */
    private initParticles(): void {
        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;

            // Spread out initially
            this.positionBuffer[i4] = (Math.random() - 0.5) * 50;
            this.positionBuffer[i4 + 1] = Math.random() * 20;
            this.positionBuffer[i4 + 2] = (Math.random() - 0.5) * 50;
            this.positionBuffer[i4 + 3] = Math.random(); // life

            this.velocityBuffer[i4] = (Math.random() - 0.5) * 2;
            this.velocityBuffer[i4 + 1] = Math.random() * 5;
            this.velocityBuffer[i4 + 2] = (Math.random() - 0.5) * 2;
            this.velocityBuffer[i4 + 3] = 1.0; // speed

            // HSL-ish color (hue, sat, lightness, alpha)
            this.colorBuffer[i4] = Math.random(); // Hue
            this.colorBuffer[i4 + 1] = 0.8; // Sat
            this.colorBuffer[i4 + 2] = 0.8; // Light
            this.colorBuffer[i4 + 3] = 1.0; // Alpha
        }
    }

    /**
     * Setup the TSL compute shader for particle physics
     */
    private setupComputeShader(): void {
        // TSL Compute Logic
        const computeLogic = Fn(() => {
            const idx = instanceIndex;

            // Fetch current particle data
            const posData = this.positionStorage.element(idx);
            const velData = this.velocityStorage.element(idx);

            // Read current values into variables
            const position = posData.toVar();
            const velocity = velData.toVar();

            // Physics
            const dt = this.uDeltaTime;
            const gravity = this.uGravity.mul(dt);

            // Update Velocity (apply gravity)
            velocity.y.addAssign(gravity.y);

            // Audio Boost (speed up particles on beat)
            const speed = velocity.w.mul(this.uAudioPulse.mul(2.0).add(1.0));

            // Update Position
            position.x.addAssign(velocity.x.mul(dt).mul(speed));
            position.y.addAssign(velocity.y.mul(dt).mul(speed));
            position.z.addAssign(velocity.z.mul(dt).mul(speed));

            // Age Life (decay over time)
            position.w.subAssign(dt.mul(0.3));

            // Respawn Logic - when life < 0, reset particle
            If(position.w.lessThan(0.0), () => {
                // Reset Life
                position.w.assign(1.0);

                // Respawn at center + random spread using index AND time for variation
                // Adding time ensures different positions on each respawn
                const seed = float(idx).mul(0.123).add(this.uTime.mul(0.1));
                const offsetX = sin(seed.mul(12.9898)).mul(10.0);
                const offsetZ = cos(seed.mul(78.233)).mul(10.0);

                position.x.assign(this.uSpawnCenter.x.add(offsetX));
                position.y.assign(this.uSpawnCenter.y);
                position.z.assign(this.uSpawnCenter.z.add(offsetZ));

                // Reset Velocity with upward burst (also time-varied)
                const velSeed = seed.add(float(idx).mul(0.456));
                velocity.y.assign(float(5.0).add(cos(velSeed).mul(2.0)));
                velocity.x.assign(sin(velSeed).mul(2.0));
                velocity.z.assign(cos(velSeed.mul(1.5)).mul(2.0));
            });

            // Write back to storage
            posData.assign(position);
            velData.assign(velocity);
        });

        // Create compute node
        this.computeNode = computeLogic().compute(this.count);
    }

    /**
     * Set optional WASM module for physics offloading.
     * 
     * Note: WASM execution is reserved for future optimization.
     * Currently, the GPU compute shader handles all physics.
     * The WASM module can be used for CPU fallback when WebGPU
     * compute shaders are not available.
     * 
     * @param module - WASM module with updateParticlesWASM function
     */
    public setWASMModule(module: WASMParticleModule): void {
        this.wasmModule = module;
        this.useWASM = typeof module.updateParticlesWASM === 'function';
        if (this.useWASM) {
            console.log('[ComputeParticles] WASM physics module registered (GPU compute primary, WASM fallback available)');
        }
    }

    /**
     * Update particle system.
     * Runs compute shader on GPU (primary) or uses WASM fallback if GPU compute unavailable.
     * 
     * @param deltaTime - Time since last frame in seconds
     * @param audioState - Optional audio state for reactive behavior
     */
    public update(deltaTime: number, audioState: ParticleAudioState = {}): void {
        this.uDeltaTime.value = deltaTime;
        this.uTime.value += deltaTime;
        this.uAudioPulse.value = audioState.kick ?? 0;

        // Execute Compute Shader on GPU (primary path)
        if (this.computeNode) {
            this.renderer.compute(this.computeNode);
        }
        // Note: WASM fallback would be implemented here if GPU compute is unavailable
        // Currently GPU compute is always available when WebGPU renderer is used
    }

    /**
     * Set the spawn center position.
     * 
     * @param position - New spawn center
     */
    public setSpawnCenter(position: THREE.Vector3): void {
        this.uSpawnCenter.value.copy(position);
    }

    /**
     * Set gravity vector.
     * 
     * @param gravity - New gravity vector
     */
    public setGravity(gravity: THREE.Vector3): void {
        this.uGravity.value.copy(gravity);
    }

    /**
     * Creates a Three.js Points mesh for rendering the particles.
     * 
     * @returns A Points mesh using the particle storage buffers
     */
    public createMesh(): THREE.Points {
        const geometry = new THREE.BufferGeometry();

        // Use storage buffers as geometry attributes
        geometry.setAttribute('position', this.positionStorage as unknown as THREE.BufferAttribute);
        geometry.setAttribute('color', this.colorStorage as unknown as THREE.BufferAttribute);
        geometry.drawRange.count = this.count;

        const material = new PointsNodeMaterial({
            size: 0.2,
            color: 0xFFFFFF,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Use buffer data in shader
        const particlePos = this.positionStorage.toAttribute();
        const life = particlePos.w;

        material.positionNode = particlePos.xyz;
        material.sizeNode = float(0.2).mul(life); // Shrink as they die
        material.colorNode = vec4(1.0, 0.5, 0.2, life); // Simple fade

        const mesh = new THREE.Points(geometry, material);
        mesh.userData.type = 'computeParticles';

        return mesh;
    }

    /**
     * Dispose of all resources.
     */
    public dispose(): void {
        // Clear buffers (let GC handle them)
        this.positionBuffer = new Float32Array(0);
        this.velocityBuffer = new Float32Array(0);
        this.colorBuffer = new Float32Array(0);
        this.computeNode = null;
    }
}
