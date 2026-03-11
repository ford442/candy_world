import * as THREE from 'three';
import { uGlitchExplosionCenter, uGlitchExplosionRadius, sharedGeometries } from '../foliage/common.ts';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float } from 'three/tsl';
import { getGroundHeight } from '../utils/wasm-loader.js';
import { spawnImpact } from '../foliage/impacts.ts';

// Simple interface for an active glitch grenade
interface GlitchGrenade {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    lifetime: number; // Max flight time just in case it falls into the void
}

class GlitchGrenadeSystem {
    private activeGrenades: GlitchGrenade[] = [];
    private explosionTimer: number = 0;

    // Config
    private gravity: number = 15.0;
    private throwSpeed: number = 20.0;
    private maxLifetime: number = 5.0;
    private explosionDuration: number = 2.0; // How long the glitch field lasts
    private explosionRadiusMax: number = 8.0;

    constructor() {}

    /**
     * Throws a new glitch grenade from the origin in the given direction.
     */
    public throwGrenade(scene: THREE.Scene, origin: THREE.Vector3, direction: THREE.Vector3) {
        // Create the physical grenade mesh
        const geo = sharedGeometries.unitSphere;
        // Bright cyan/magenta glitchy look
        const mat = new MeshStandardNodeMaterial();
        mat.colorNode = color(0x00ffff);
        mat.emissiveNode = color(0xff00ff);
        mat.roughnessNode = float(0.2);

        const mesh = new THREE.Mesh(geo, mat);
        // Small grenade size
        mesh.scale.setScalar(0.3);

        // Start slightly in front of the player/camera
        mesh.position.copy(origin).addScaledVector(direction, 0.5);
        scene.add(mesh);

        // Calculate initial velocity (forward + slightly up for arc)
        const velocity = direction.clone().normalize().multiplyScalar(this.throwSpeed);
        velocity.y += 5.0; // Upward arc

        this.activeGrenades.push({
            mesh,
            velocity,
            lifetime: 0
        });

        // Spawn small throw effect
        spawnImpact(mesh.position, 'dash');
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

        // 2. Update active projectiles
        for (let i = this.activeGrenades.length - 1; i >= 0; i--) {
            const grenade = this.activeGrenades[i];

            // Apply gravity
            grenade.velocity.y -= this.gravity * delta;

            // Move
            grenade.mesh.position.addScaledVector(grenade.velocity, delta);
            grenade.lifetime += delta;

            // Check Ground Collision using unified ground height
            const groundY = getGroundHeight(grenade.mesh.position.x, grenade.mesh.position.z);

            if (grenade.mesh.position.y <= groundY || grenade.lifetime > this.maxLifetime) {
                // Snap to ground level if it hit
                if (grenade.mesh.position.y <= groundY) {
                     grenade.mesh.position.y = groundY;
                }

                // EXPLODE!
                this.triggerExplosion(grenade.mesh.position);

                // Cleanup
                scene.remove(grenade.mesh);
                this.activeGrenades.splice(i, 1);
            }
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
