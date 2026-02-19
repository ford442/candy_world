import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    vec3, float, positionLocal, normalLocal, mx_noise_float,
    mix, sin, smoothstep, normalize, positionWorld, color, instanceColor
} from 'three/tsl';
import { foliageClouds, foliageGeysers } from '../world/state.ts';
import { createCandyMaterial, uTime, uAudioHigh, createJuicyRimLight } from '../foliage/common.ts';
import { getCelestialState } from '../core/cycle.ts';
import { spawnImpact } from '../foliage/impacts.ts';

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
        const geo = new THREE.SphereGeometry(RADIUS, 16, 16); // Increased detail for displacement

        // --- PALETTE UPGRADE: Plasma Material (TSL) ---
        const mat = new MeshStandardNodeMaterial({
            roughness: 0.4,
            metalness: 0.1,
        });

        // 1. Base Color from Instance
        // Use imported instanceColor node
        const baseColor = instanceColor || color(0xFFFFFF);
        mat.colorNode = baseColor;

        // 2. Plasma Displacement (Wobble)
        // Scroll noise vertically + rotate?
        const plasmaTime = uTime.mul(float(3.0));
        const noisePos = positionLocal.mul(float(2.0)).add(vec3(0.0, plasmaTime, 0.0));
        const plasmaNoise = mx_noise_float(noisePos);

        // Displace along normal
        const displacement = normalLocal.mul(plasmaNoise.mul(float(0.15)));

        // 3. Audio Pulse (Size)
        // Expand on high frequencies (melody/snare)
        const audioPulse = uAudioHigh.mul(float(0.3)).add(float(1.0));

        // Apply Total Deformation
        mat.positionNode = positionLocal.add(displacement).mul(audioPulse);

        // 4. Juicy Rim Light & Glow
        // Strong rim light for energy feel
        const rim = createJuicyRimLight(baseColor, float(2.0), float(3.0), null);

        // Inner Glow (Emissive)
        // Pulsate the core brightness with audio
        const coreGlow = baseColor.mul(float(0.5).add(uAudioHigh.mul(0.5)));

        mat.emissiveNode = coreGlow.add(rim);

        this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PROJECTILES);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = false;

        // Initialize Instance Colors Buffer
        // Crucial for the TSL material to read per-instance colors
        const colors = new Float32Array(MAX_PROJECTILES * 3);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

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

            // Set initial white
            this.mesh.setColorAt(i, new THREE.Color(0xFFFFFF));
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

        // Rainbow Color Logic
        const time = performance.now() / 1000;
        const hue = (time * 0.5) % 1.0;
        this.color.setHSL(hue, 1.0, 0.5);

        // Update Instance Color
        this.mesh.setColorAt(idx, this.color);
        p.color.copy(this.color); // Store for trail logic

        // JUICE: Muzzle Flash
        _scratchImpactOptions.color.copy(this.color);
        _scratchImpactOptions.direction.copy(direction);
        spawnImpact(origin, 'muzzle', _scratchImpactOptions.color, _scratchImpactOptions.direction);

        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    update(dt: number, scene: THREE.Scene, weatherSystem: any, isDay: boolean) {
        let needsUpdate = false;

        for (let i = 0; i < MAX_PROJECTILES; i++) {
            const p = this.projectiles[i];
            if (!p.active) continue;

            // Move
            p.position.addScaledVector(p.velocity, dt);
            p.life -= dt;

            // JUICE: Projectile Trail
            // Spawn every frame for a continuous trail
            _scratchImpactOptions.color.copy(p.color);
            spawnImpact(p.position, 'trail', _scratchImpactOptions.color);

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

            // Collision with Geysers (Charging)
            const geysers = foliageGeysers || [];
            for (let j = geysers.length - 1; j >= 0; j--) {
                const geyser = geysers[j];
                // Check if hit the base (radius ~1.0)
                // Geyser is at y=ground. Check distSq to base.
                const distSq = p.position.distanceToSquared(geyser.position);
                const hitRadius = 1.5;

                if (distSq < (hitRadius * hitRadius) && Math.abs(p.position.y - geyser.position.y) < 2.0) {
                    hit = true;
                    // Trigger Charge
                    geyser.userData.chargeLevel = (geyser.userData.chargeLevel || 0) + 0.5;
                    // Clamp charge? Let it go high for super boost!

                    // Visuals
                    spawnImpact(geyser.position, 'jump');
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
                // Spin for fun (visible due to noise displacement)
                this.dummy.rotation.x += dt * 5.0;
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
