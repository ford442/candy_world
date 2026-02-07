import * as THREE from 'three';
import { attribute } from 'three/tsl';
import { foliageClouds } from '../world/state.ts';
import { createCandyMaterial } from '../foliage/common.ts';
import { getCelestialState } from '../core/cycle.ts';
import { spawnImpact } from '../foliage/impacts.js';

// Projectile Configuration
const SPEED = 60.0;
const RADIUS = 0.5;
const MAX_PROJECTILES = 100;
const MAX_LIFE = 3.0;

// ⚡ OPTIMIZATION: Scratch objects to prevent GC in hot loops
const _scratchImpactOptions = { color: new THREE.Color(), direction: new THREE.Vector3() };

class ProjectilePool {
    mesh: THREE.InstancedMesh;
    projectiles: {
        active: boolean;
        life: number;
        velocity: THREE.Vector3;
        position: THREE.Vector3;
        color: THREE.Color;
    }[];
    dummy: THREE.Object3D;
    color: THREE.Color;

    constructor() {
        const geo = new THREE.SphereGeometry(RADIUS, 8, 8);

        // FIX: Setup instanceColor attribute BEFORE creating TSL material
        // This prevents "instanceColor not found" warnings
        const colors = new Float32Array(MAX_PROJECTILES * 3);
        geo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));

        // TSL: Use instanceColor for the rainbow effect
        // Note: Now the attribute exists on the geometry when the shader is compiled
        const instanceColorNode = attribute('instanceColor', 'vec3');

        // Use Gummy preset (Candy) but with instanceColor
        // 0xFFFFFF is fallback
        const mat = createCandyMaterial(0xFFFFFF);
        // We override colorNode directly to ensure it picks up the attribute
        mat.colorNode = instanceColorNode;
        // JUICE: Add emissive glow
        mat.emissiveNode = instanceColorNode.mul(0.5);

        this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PROJECTILES);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = false;

        // Reference the instanceColor from geometry for updates
        this.mesh.instanceColor = geo.attributes.instanceColor as THREE.InstancedBufferAttribute;

        this.projectiles = [];
        this.dummy = new THREE.Object3D();
        this.color = new THREE.Color();

        // Initialize pool
        for (let i = 0; i < MAX_PROJECTILES; i++) {
            this.projectiles.push({
                active: false,
                life: 0,
                velocity: new THREE.Vector3(),
                position: new THREE.Vector3(),
                color: new THREE.Color()
            });
            // Hide initially
            this.dummy.position.set(0, -9999, 0);
            this.dummy.scale.setScalar(0);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
        }
    }

    addToScene(scene: THREE.Scene) {
        scene.add(this.mesh);
    }

    fire(origin: THREE.Vector3, direction: THREE.Vector3) {
        // Find free slot
        let idx = -1;
        for (let i = 0; i < MAX_PROJECTILES; i++) {
            if (!this.projectiles[i].active) {
                idx = i;
                break;
            }
        }

        if (idx === -1) return; // Pool full

        const p = this.projectiles[idx];
        p.active = true;
        p.life = MAX_LIFE;
        p.position.copy(origin);
        p.velocity.copy(direction).normalize().multiplyScalar(SPEED);

        // Visuals
        this.dummy.position.copy(p.position);
        this.dummy.scale.setScalar(1.0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(idx, this.dummy.matrix);

        // Rainbow Color
        const time = performance.now() / 1000;
        const hue = (time * 0.5) % 1.0;
        this.color.setHSL(hue, 1.0, 0.5);
        this.mesh.setColorAt(idx, this.color);
        p.color.copy(this.color); // Store for trail

        // JUICE: Muzzle Flash
        spawnImpact(origin, 'muzzle', { color: this.color, direction: direction });

        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    update(dt: number, scene: THREE.Scene, weatherSystem: any, isDay: boolean) {
        let needsUpdate = false;

        // TSL Materials might need manual update if not handled by renderer automatically
        // But InstancedMesh instanceMatrix needs explicit flag

        for (let i = 0; i < MAX_PROJECTILES; i++) {
            const p = this.projectiles[i];
            if (!p.active) continue;

            // Move
            p.position.addScaledVector(p.velocity, dt);
            p.life -= dt;

            // JUICE: Projectile Trail
            // Spawn every frame for a continuous trail
            // ⚡ OPTIMIZATION: Use shared options object
            _scratchImpactOptions.color.copy(p.color);
            spawnImpact(p.position, 'trail', _scratchImpactOptions);

            let hit = false;

            // Collision with Clouds
            const clouds = foliageClouds || [];

            // Optimization: Simple distance check
            // Iterate backwards to allow removal if logic required (though we don't remove clouds here, just state)
            for (let j = clouds.length - 1; j >= 0; j--) {
                const cloud = clouds[j];
                const cloudRadius = 3.0 * (cloud.scale.x || 1.0);
                const distSq = p.position.distanceToSquared(cloud.position);

                if (distSq < (cloudRadius * cloudRadius)) {
                    hit = true;
                    this.handleCloudHit(cloud, scene, isDay);

                     if (weatherSystem && weatherSystem.notifyCloudShot) {
                        weatherSystem.notifyCloudShot(isDay);
                    }
                    break;
                }
            }

            if (hit || p.life <= 0) {
                p.active = false;
                this.dummy.scale.setScalar(0);
                this.dummy.position.set(0, -9999, 0); // Move out of view
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
                needsUpdate = true;
            } else {
                this.dummy.position.copy(p.position);
                this.dummy.rotation.x += dt * 5.0; // Spin for fun
                this.dummy.rotation.z += dt * 5.0;
                this.dummy.scale.setScalar(1.0);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    handleCloudHit(cloud: any, scene: THREE.Scene, isDay: boolean) {
        if (isDay) {
            this.knockDownCloudMist(cloud);
             // Spawn Mist Impact
             spawnImpact(cloud.position, 'mist');
        } else {
            this.knockDownCloudDeluge(cloud);
            // Spawn Rain Impact
            spawnImpact(cloud.position, 'rain');
        }
    }

    knockDownCloudMist(cloud: any) {
        if (cloud.userData.isFalling) return;
        cloud.userData.isFalling = true;
        // ⚡ OPTIMIZATION: Reuse vector
        if (!cloud.userData.velocity) cloud.userData.velocity = new THREE.Vector3();
        cloud.userData.velocity.set(0, 5.0, 0);

        cloud.traverse((c: any) => {
            if (c.isMesh && c.material) {
                 // Optimization: Modifying material directly assuming simple use case.
            }
        });
    }

    knockDownCloudDeluge(cloud: any) {
         if (cloud.userData.isFalling) return;
        cloud.userData.isFalling = true;
        // ⚡ OPTIMIZATION: Reuse vector
        if (!cloud.userData.velocity) cloud.userData.velocity = new THREE.Vector3();
        cloud.userData.velocity.set(0, -20.0, 0);
    }
}

// Global Pool Instance
const projectilePool = new ProjectilePool();
let initialized = false;

export function fireRainbow(scene: THREE.Scene, origin: THREE.Vector3, direction: THREE.Vector3) {
    if (!initialized) {
        projectilePool.addToScene(scene);
        initialized = true;
    }
    projectilePool.fire(origin, direction);
}

export function updateBlaster(dt: number, scene: THREE.Scene, weatherSystem: any, currentTime: number) {
    const celestial = getCelestialState(currentTime);
    const isDay = celestial.sunIntensity > 0.5;

    // Ensure pool is in scene (safety)
    if (!initialized) {
         projectilePool.addToScene(scene);
         initialized = true;
    }

    projectilePool.update(dt, scene, weatherSystem, isDay);
}
