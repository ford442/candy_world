import * as THREE from 'three';
import { uGlitchExplosionCenter, uGlitchExplosionRadius, sharedGeometries } from '../foliage/index.ts';
import { MeshStandardNodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';
import { color, float, attribute, storage, instanceIndex, Fn, If, vec4, uniform, positionLocal, smoothstep } from 'three/tsl';
import { getGroundHeight } from '../utils/wasm-loader.js';
import { spawnImpact } from '../foliage/impacts.ts';
import { addCameraShake } from '../core/game-loop.ts';

const MAX_GRENADES = 10; // Simple fixed pool size

// Simple interface for an active glitch grenade CPU proxy
interface GlitchGrenade {
    active: boolean;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    lifetime: number; // Max flight time just in case it falls into the void
}

class GlitchGrenadeSystem {
    private grenades: GlitchGrenade[] = [];
    private explosionTimer: number = 0;

    // ⚡ OPTIMIZATION: Use InstancedMesh instead of instantiating individual meshes
    private mesh: THREE.InstancedMesh;
    private initialized: boolean = false;

    // Compute Shader nodes
    private computeNode: any;
    private uDeltaTime: any;

    // Buffers for CPU <-> GPU sync
    private stateArray: Float32Array;
    private velocityArray: Float32Array;
    private stateBuffer: StorageInstancedBufferAttribute;
    private velocityBuffer: StorageInstancedBufferAttribute;

    // Config
    private gravity: number = 15.0;
    private throwSpeed: number = 20.0;
    private maxLifetime: number = 5.0;
    private explosionDuration: number = 2.0; // How long the glitch field lasts
    private explosionRadiusMax: number = 8.0;

    constructor() {
        const geo = sharedGeometries.unitSphere.clone(); // Clone to avoid modifying shared geometry attributes

        this.stateArray = new Float32Array(MAX_GRENADES * 4);
        this.velocityArray = new Float32Array(MAX_GRENADES * 4);

        // Hide all initially
        for (let i = 0; i < MAX_GRENADES; i++) {
            this.stateArray[i * 4 + 3] = 0; // w = 0 means inactive
        }

        this.stateBuffer = new StorageInstancedBufferAttribute(this.stateArray, 4);
        this.velocityBuffer = new StorageInstancedBufferAttribute(this.velocityArray, 4);

        geo.setAttribute('aState', this.stateBuffer);
        geo.setAttribute('aVelocity', this.velocityBuffer);

        const mat = new MeshStandardNodeMaterial({
            transparent: true,
            depthWrite: false
        });

        mat.colorNode = color(0x00ffff);
        mat.emissiveNode = color(0xff00ff);
        mat.roughnessNode = float(0.2);

        const stateAttr = attribute('aState', 'vec4');
        const velAttr = attribute('aVelocity', 'vec4');

        const instancePos = stateAttr.xyz;
        const activeState = stateAttr.w;

        // Fixed scale for grenades
        const scale = float(0.3);

        mat.positionNode = positionLocal.mul(scale).add(instancePos);

        // Hide inactive grenades
        mat.opacityNode = smoothstep(0.0, 0.01, activeState);

        this.mesh = new THREE.InstancedMesh(geo, mat, MAX_GRENADES);
        this.mesh.matrixAutoUpdate = false;
        this.mesh.frustumCulled = false;
        this.mesh.castShadow = true;

        // ⚡ OPTIMIZATION: Write a pure identity matrix into the instanceMatrix buffer
        const identityMatrix = new THREE.Matrix4();
        for (let i = 0; i < MAX_GRENADES; i++) {
            this.mesh.setMatrixAt(i, identityMatrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;

        // ⚡ OPTIMIZATION: Initialize CPU Object Pool (Collision Proxy)
        for (let i = 0; i < MAX_GRENADES; i++) {
            this.grenades.push({
                active: false,
                position: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                lifetime: 0
            });
        }

        // --- WebGPU COMPUTE SHADER LOGIC ---
        this.uDeltaTime = uniform(0);

        const updateGrenadesCompute = Fn(() => {
            const index = instanceIndex;

            const stateNode = storage(this.stateBuffer, 'vec4', MAX_GRENADES).element(index);
            const velNode = storage(this.velocityBuffer, 'vec4', MAX_GRENADES).element(index);

            const pos = stateNode.xyz;
            const active = stateNode.w;

            const vel = velNode.xyz;

            const dt = this.uDeltaTime;

            If(active.greaterThan(0.0), () => {
                // Apply gravity
                const newVel = vec4(vel.x, vel.y.sub(float(this.gravity).mul(dt)), vel.z, 0.0);
                // Move
                const newPos = pos.add(newVel.xyz.mul(dt));

                stateNode.assign(vec4(newPos, active));
                velNode.assign(newVel);
            });
        });

        this.computeNode = updateGrenadesCompute().compute(MAX_GRENADES);
    }

    /**
     * Throws a new glitch grenade from the origin in the given direction.
     */
    public throwGrenade(scene: THREE.Scene, origin: THREE.Vector3, direction: THREE.Vector3) {
        if (!this.initialized) {
            scene.add(this.mesh);
            this.initialized = true;
        }

        // Find inactive grenade
        let idx = -1;
        for (let i = 0; i < MAX_GRENADES; i++) {
            if (!this.grenades[i].active) {
                idx = i;
                break;
            }
        }

        if (idx === -1) return; // Pool full

        const grenade = this.grenades[idx];
        grenade.active = true;
        grenade.lifetime = 0;

        // Start slightly in front of the player/camera
        grenade.position.copy(origin).addScaledVector(direction, 0.5);

        // Calculate initial velocity (forward + slightly up for arc)
        grenade.velocity.copy(direction).normalize().multiplyScalar(this.throwSpeed);
        grenade.velocity.y += 5.0; // Upward arc

        // Update GPU Backing Buffer
        this.stateArray[idx * 4 + 0] = grenade.position.x;
        this.stateArray[idx * 4 + 1] = grenade.position.y;
        this.stateArray[idx * 4 + 2] = grenade.position.z;
        this.stateArray[idx * 4 + 3] = 1.0; // active

        this.velocityArray[idx * 4 + 0] = grenade.velocity.x;
        this.velocityArray[idx * 4 + 1] = grenade.velocity.y;
        this.velocityArray[idx * 4 + 2] = grenade.velocity.z;
        this.velocityArray[idx * 4 + 3] = 0.0;

        this.stateBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;

        // Spawn small throw effect
        spawnImpact(grenade.position, 'dash');
    }

    /**
     * Updates grenade physics and the explosion fading logic.
     */
    public update(delta: number, scene: THREE.Scene, renderer?: THREE.WebGLRenderer | any) {
        // Run GPU Compute Shader first
        if (renderer && renderer.compute) {
            this.uDeltaTime.value = delta;
            renderer.compute(this.computeNode);
        }

        // 1. Update Explosion Fading (Decrement Timer)
        if (this.explosionTimer > 0) {
            this.explosionTimer -= delta;

            if (this.explosionTimer <= 0) {
                // Turn off glitch field completely
                uGlitchExplosionRadius.value = 0;
            } else {
                // Stay large for a bit, then shrink
                const progress = this.explosionTimer / this.explosionDuration;
                const radiusFactor = Math.pow(progress, 0.5);
                uGlitchExplosionRadius.value = this.explosionRadiusMax * radiusFactor;
            }
        }

        if (!this.initialized) return;

        let needsStateUpdate = false;

        // 2. Update CPU proxy for collisions
        for (let i = 0; i < MAX_GRENADES; i++) {
            const grenade = this.grenades[i];

            if (!grenade.active) continue;

            // CPU Proxy Simulation
            grenade.velocity.y -= this.gravity * delta;
            grenade.position.addScaledVector(grenade.velocity, delta);
            grenade.lifetime += delta;

            // Check Ground Collision using unified ground height
            const groundY = getGroundHeight(grenade.position.x, grenade.position.z);

            if (grenade.position.y <= groundY || grenade.lifetime > this.maxLifetime) {
                // Snap to ground level if it hit
                if (grenade.position.y <= groundY) {
                     grenade.position.y = groundY;
                }

                // EXPLODE!
                this.triggerExplosion(grenade.position);

                // Cleanup (Deactivate and hide)
                grenade.active = false;

                // Sync death state to GPU
                this.stateArray[i * 4 + 3] = 0; // inactive
                needsStateUpdate = true;
            } else {
                // Sync current CPU proxy position back to stateArray
                // in case we need to upload due to other grenades dying
                this.stateArray[i * 4 + 0] = grenade.position.x;
                this.stateArray[i * 4 + 1] = grenade.position.y;
                this.stateArray[i * 4 + 2] = grenade.position.z;
                this.stateArray[i * 4 + 3] = 1.0;

                this.velocityArray[i * 4 + 0] = grenade.velocity.x;
                this.velocityArray[i * 4 + 1] = grenade.velocity.y;
                this.velocityArray[i * 4 + 2] = grenade.velocity.z;
            }
        }

        if (needsStateUpdate) {
            this.stateBuffer.needsUpdate = true;
            this.velocityBuffer.needsUpdate = true;
        }
    }

    private triggerExplosion(position: THREE.Vector3) {
        // Set the TSL uniforms to apply the local glitch shader
        uGlitchExplosionCenter.value.copy(position);
        uGlitchExplosionRadius.value = this.explosionRadiusMax;

        // Reset timer
        this.explosionTimer = this.explosionDuration;

        // Visual impact (reusing spore or jump for now)
        spawnImpact(position, 'spore');

        // 🎨 Palette: Juice up the explosion with shake and sound
        addCameraShake(0.8);
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
            (window as any).AudioSystem.playSound('explosion', { position, pitch: 0.5 + Math.random() * 0.5, volume: 1.0 });
        }
    }
}

// Export singleton instance
export const glitchGrenadeSystem = new GlitchGrenadeSystem();
