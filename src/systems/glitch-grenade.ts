import * as THREE from 'three';
import { uGlitchExplosionCenter, uGlitchExplosionRadius, sharedGeometries } from '../foliage/common.ts';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float } from 'three/tsl';
import { getGroundHeight } from '../utils/wasm-loader.js';
import { spawnImpact } from '../foliage/impacts.ts';

const MAX_GRENADES = 10; // Simple fixed pool size

// Simple interface for an active glitch grenade
interface GlitchGrenade {
    active: boolean;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    lifetime: number; // Max flight time just in case it falls into the void
}

// ⚡ OPTIMIZATION: Scratch objects to prevent GC spikes in animation loop
const _scratchDummy = new THREE.Object3D();

class GlitchGrenadeSystem {
    private grenades: GlitchGrenade[] = [];
    private explosionTimer: number = 0;

    // ⚡ OPTIMIZATION: Use InstancedMesh instead of instantiating individual meshes
    private mesh: THREE.InstancedMesh;
    private initialized: boolean = false;

    // Config
    private gravity: number = 15.0;
    private throwSpeed: number = 20.0;
    private maxLifetime: number = 5.0;
    private explosionDuration: number = 2.0; // How long the glitch field lasts
    private explosionRadiusMax: number = 8.0;

    constructor() {
        const geo = sharedGeometries.unitSphere;
        const mat = new MeshStandardNodeMaterial();
        mat.colorNode = color(0x00ffff);
        mat.emissiveNode = color(0xff00ff);
        mat.roughnessNode = float(0.2);

        this.mesh = new THREE.InstancedMesh(geo, mat, MAX_GRENADES);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;

        // ⚡ OPTIMIZATION: Initialize Object Pool
        for (let i = 0; i < MAX_GRENADES; i++) {
            this.grenades.push({
                active: false,
                position: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                lifetime: 0
            });

            // Hide initially
            _scratchDummy.position.set(0, -9999, 0);
            _scratchDummy.scale.setScalar(0);
            _scratchDummy.updateMatrix();
            this.mesh.setMatrixAt(i, _scratchDummy.matrix);
        }
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

        _scratchDummy.position.copy(grenade.position);
        _scratchDummy.scale.setScalar(0.3);
        _scratchDummy.updateMatrix();
        this.mesh.setMatrixAt(idx, _scratchDummy.matrix);
        this.mesh.instanceMatrix.needsUpdate = true;

        // Spawn small throw effect
        spawnImpact(grenade.position, 'dash');
    }

    /**
     * Updates grenade physics and the explosion fading logic.
     */
    public update(delta: number, scene: THREE.Scene) {
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

        let needsUpdate = false;

        // 2. Update active projectiles
        for (let i = 0; i < MAX_GRENADES; i++) {
            const grenade = this.grenades[i];

            if (!grenade.active) continue;

            // Apply gravity
            grenade.velocity.y -= this.gravity * delta;

            // Move
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
                _scratchDummy.position.set(0, -9999, 0);
                _scratchDummy.scale.setScalar(0);
                _scratchDummy.updateMatrix();
                this.mesh.setMatrixAt(i, _scratchDummy.matrix);
                needsUpdate = true;
            } else {
                // Keep moving
                _scratchDummy.position.copy(grenade.position);
                _scratchDummy.scale.setScalar(0.3);
                _scratchDummy.updateMatrix();
                this.mesh.setMatrixAt(i, _scratchDummy.matrix);
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this.mesh.instanceMatrix.needsUpdate = true;
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
    }
}

// Export singleton instance
export const glitchGrenadeSystem = new GlitchGrenadeSystem();
