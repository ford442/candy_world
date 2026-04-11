import * as THREE from 'three';
import { MeshStandardNodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';
import {
    vec3, float, positionLocal, normalLocal, mx_noise_float,
    mix, sin, smoothstep, normalize, positionWorld, color, attribute,
    storage, instanceIndex, Fn, If, exp, vec4, uniform, rotate
} from 'three/tsl';
import { foliageClouds, foliageGeysers, foliageTraps } from '../world/state.ts';
import { createCandyMaterial, uTime, uAudioHigh, createJuicyRimLight } from '../foliage/index.ts';
import { getCelestialState } from '../core/cycle.ts';
import { spawnImpact } from '../foliage/impacts.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { triggerHarpoon } from '../systems/physics/index.js';
import { isInLakeBasin } from '../systems/physics.core.ts';

// Projectile Configuration
const SPEED = 60.0;
const RADIUS = 0.5;
const MAX_PROJECTILES = 100;
const MAX_LIFE = 3.0;

// ⚡ OPTIMIZATION: Scratch objects to prevent GC in hot loops
const _scratchImpactOptions = { color: new THREE.Color(), direction: new THREE.Vector3() };
const _scratchVec3 = new THREE.Vector3();
const _scratchCelestialState = { sunIntensity: 0, moonIntensity: 0 };

class ProjectilePool {
    mesh: THREE.InstancedMesh;
    projectiles: {
        active: boolean;
        life: number;
        velocity: THREE.Vector3;
        position: THREE.Vector3;
        color: THREE.Color;
        scale: number;
    }[];
    color: THREE.Color;

    // TSL Compute Shader Nodes
    computeNode: any;
    uDeltaTime: any;

    // Buffers for CPU <-> GPU sync
    stateArray: Float32Array;
    velocityArray: Float32Array;
    stateBuffer: StorageInstancedBufferAttribute;
    velocityBuffer: StorageInstancedBufferAttribute;

    constructor() {
        const geo = new THREE.SphereGeometry(RADIUS, 16, 16); // Increased detail for displacement

        this.stateArray = new Float32Array(MAX_PROJECTILES * 4);
        this.velocityArray = new Float32Array(MAX_PROJECTILES * 4);

        // Hide all initially
        for (let i = 0; i < MAX_PROJECTILES; i++) {
            this.stateArray[i * 4 + 3] = 0; // life = 0 means dead/hidden
            this.velocityArray[i * 4 + 3] = 0; // scale = 0
        }

        this.stateBuffer = new StorageInstancedBufferAttribute(this.stateArray, 4);
        this.velocityBuffer = new StorageInstancedBufferAttribute(this.velocityArray, 4);

        geo.setAttribute('aState', this.stateBuffer);
        geo.setAttribute('aVelocity', this.velocityBuffer);

        // --- PALETTE UPGRADE: Plasma Material (TSL) ---
        const mat = new MeshStandardNodeMaterial({
            roughness: 0.4,
            metalness: 0.1,
            transparent: true,
            depthWrite: false
        });

        const stateAttr = attribute('aState', 'vec4');
        const velAttr = attribute('aVelocity', 'vec4');

        const instancePos = stateAttr.xyz;
        const life = stateAttr.w;
        const scaleAttr = velAttr.w;

        // 1. Base Color from Instance
        // Use imported instanceColor node
        const baseColor = attribute('instanceColor', 'vec3') || color(0xFFFFFF);
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

        // Apply spinning rotation ("Juice")
        const spinAxis = normalize(vec3(1.0, 0.0, 1.0));
        const spunPosition = rotate(positionLocal, spinAxis, uTime.mul(float(5.0)));

        // Apply Total Deformation based on compute shader scale and position
        mat.positionNode = spunPosition.add(displacement).mul(audioPulse).mul(scaleAttr).add(instancePos);

        // Hide dead projectiles
        mat.opacityNode = smoothstep(0.0, 0.01, life);

        // 4. Juicy Rim Light & Glow
        // Strong rim light for energy feel
        const rim = createJuicyRimLight(baseColor, float(2.0), float(3.0), null);

        // Inner Glow (Emissive)
        // Pulsate the core brightness with audio
        const coreGlow = baseColor.mul(float(0.5).add(uAudioHigh.mul(0.5)));

        mat.emissiveNode = coreGlow.add(rim);

        this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PROJECTILES);

        // Disable matrix updates and frustum culling since GPU handles transformations
        this.mesh.matrixAutoUpdate = false;
        this.mesh.frustumCulled = false;

        // ⚡ OPTIMIZATION: Write a pure identity matrix into the instanceMatrix buffer
        // WebGPU TSL multiplies custom positionNode output by instanceMatrix
        const identityMatrix = new THREE.Matrix4();
        for (let i = 0; i < MAX_PROJECTILES; i++) {
            // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
        identityMatrix.toArray(this.mesh.instanceMatrix.array, (i) * 16);
        }
        this.mesh.instanceMatrix.needsUpdate = true;

        this.mesh.castShadow = true;
        this.mesh.receiveShadow = false;

        // Initialize Instance Colors Buffer
        // Crucial for the TSL material to read per-instance colors
        const colors = new Float32Array(MAX_PROJECTILES * 3);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

        this.projectiles = [];
        this.color = new THREE.Color();

        // Initialize CPU pool for collision proxy
        for (let i = 0; i < MAX_PROJECTILES; i++) {
            this.projectiles.push({
                active: false,
                life: 0,
                velocity: new THREE.Vector3(),
                position: new THREE.Vector3(),
                color: new THREE.Color(),
                scale: 0
            });

            // Set initial white
            // ⚡ OPTIMIZATION: Reuse color
            this.color.setHex(0xFFFFFF);
            this.mesh.setColorAt(i, this.color);
        }

        // --- WebGPU COMPUTE SHADER LOGIC ---
        this.uDeltaTime = uniform(0);

        const updateProjectilesCompute = Fn(() => {
            const index = instanceIndex;

            const stateNode = storage(this.stateBuffer, 'vec4', MAX_PROJECTILES).element(index);
            const velNode = storage(this.velocityBuffer, 'vec4', MAX_PROJECTILES).element(index);

            const pos = stateNode.xyz;
            const life = stateNode.w;

            const vel = velNode.xyz;
            const scale = velNode.w;

            const dt = this.uDeltaTime;

            If(life.greaterThan(0.0), () => {
                const newPos = pos.add(vel.mul(dt));
                const newLife = life.sub(dt);

                // Exponential decay approximation for damp(scale, 1.0, 15.0, dt)
                const decay = exp(float(-15.0).mul(dt));
                const newScale = mix(float(1.0), scale, decay);

                stateNode.assign(vec4(newPos, newLife));
                velNode.assign(vec4(vel, newScale));
            });
        });

        this.computeNode = updateProjectilesCompute().compute(MAX_PROJECTILES);
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
        p.scale = 0;
        p.position.copy(origin);
        p.velocity.copy(direction).normalize().multiplyScalar(SPEED);

        // Update GPU Backing Buffer
        this.stateArray[idx * 4 + 0] = p.position.x;
        this.stateArray[idx * 4 + 1] = p.position.y;
        this.stateArray[idx * 4 + 2] = p.position.z;
        this.stateArray[idx * 4 + 3] = p.life;

        this.velocityArray[idx * 4 + 0] = p.velocity.x;
        this.velocityArray[idx * 4 + 1] = p.velocity.y;
        this.velocityArray[idx * 4 + 2] = p.velocity.z;
        this.velocityArray[idx * 4 + 3] = p.scale;

        // Small buffer (100 items), upload whole buffer to avoid range collisions
        this.stateBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;

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

        // this.mesh.instanceMatrix.needsUpdate = true; // No longer needed
        if (this.mesh.instanceColor) {
            this.mesh.instanceColor.needsUpdate = true;
        }
    }

    update(dt: number, scene: THREE.Scene, weatherSystem: any, isDay: boolean, renderer: THREE.WebGLRenderer | any) {
        // Run GPU Compute Shader first
        if (renderer && renderer.compute) {
            this.uDeltaTime.value = dt;
            renderer.compute(this.computeNode);
        }

        let needsStateUpdate = false;

        for (let i = 0; i < MAX_PROJECTILES; i++) {
            const p = this.projectiles[i];
            if (!p.active) continue;

            // CPU Proxy Simulation (Keeps track of where particles are for collisions)
            p.position.addScaledVector(p.velocity, dt);
            p.life -= dt;
            p.scale = THREE.MathUtils.damp(p.scale, 1.0, 15.0, dt);

            // Sync current CPU proxy position back to stateArray in case we need to upload
            this.stateArray[i * 4 + 0] = p.position.x;
            this.stateArray[i * 4 + 1] = p.position.y;
            this.stateArray[i * 4 + 2] = p.position.z;
            this.stateArray[i * 4 + 3] = p.life;
            this.velocityArray[i * 4 + 3] = p.scale;

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

            // Collision with Water (Waveform Harpoon)
            if (isInLakeBasin(p.position.x, p.position.z) && p.position.y <= 1.5) {
                hit = true;
                // Anchor Harpoon
                triggerHarpoon(p.position);
                spawnImpact(p.position, 'splash'); // Visual feedback
            }

            // Collision with Snare Traps (Reflection)
            const traps = foliageTraps || [];
            for (let j = traps.length - 1; j >= 0; j--) {
                const trap = traps[j];
                // Check bounds (Radius ~0.8 * scale)
                const radius = 1.0 * (trap.scale.x || 1.0);
                const distSq = p.position.distanceToSquared(trap.position);

                if (distSq < (radius * radius)) {
                     if (unlockSystem.isUnlocked('snap_core')) {
                         // Hit! Reflect!
                         // Calculate Normal: Outward from trap center
                         _scratchVec3.subVectors(p.position, trap.position).normalize();

                         // Reflect Velocity
                         p.velocity.reflect(_scratchVec3);

                         // Trigger Snap Animation (Immediate Close)
                         trap.userData.snapState = 1.0;

                         // Visuals
                         spawnImpact(p.position, 'snare');

                         // Don't destroy projectile, just bounce
                         // Reduce life slightly to prevent infinite bounces
                         p.life -= 0.5;

                         // Ensure projectile is pushed out to avoid multi-frame collisions?
                         // Move it slightly along normal
                         p.position.addScaledVector(_scratchVec3, 0.5);

                         // Break this loop (handled collision for this frame)
                         // But continue inner loop? No, break checking traps for this projectile
                         break;
                     } else {
                         // Hit! Without upgrade, destroy projectile and trigger trap
                         p.life = 0;
                         trap.userData.snapState = 1.0;
                         spawnImpact(p.position, 'snare');
                         break;
                     }
                }
            }

            if (hit || p.life <= 0) {
                p.active = false;

                // Only sync death state to GPU (life = 0)
                this.stateArray[i * 4 + 3] = 0;

                needsStateUpdate = true;
            }
        }

        // Upload whole buffer to avoid range collisions for this small array
        if (needsStateUpdate) {
            this.stateBuffer.needsUpdate = true;
            this.velocityBuffer.needsUpdate = true;
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

        // ⚡ OPTIMIZATION: Reuse vector. Assume cloud.userData.velocity exists since it's pre-allocated in createCloud.
        // If not, fall back safely.
        if (!cloud.userData.velocity) cloud.userData.velocity = new THREE.Vector3();
        cloud.userData.velocity.set(0, -5.0, 0);

        cloud.traverse((c: any) => {
            if (c.isMesh && c.material) {
                 // Optimization: Modifying material directly assuming simple use case.
            }
        });
    }

    knockDownCloudDeluge(cloud: any) {
        if (cloud.userData.isFalling) return;
        cloud.userData.isFalling = true;

        // ⚡ OPTIMIZATION: Velocity pre-allocated in createCloud (clouds.ts)
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

export function updateBlaster(dt: number, scene: THREE.Scene, weatherSystem: any, currentTime: number, renderer?: THREE.WebGLRenderer) {
    const celestial = getCelestialState(currentTime, _scratchCelestialState);
    const isDay = celestial.sunIntensity > 0.5;

    // Ensure pool is in scene (safety)
    if (!initialized) {
         projectilePool.addToScene(scene);
         initialized = true;
    }

    projectilePool.update(dt, scene, weatherSystem, isDay, renderer);
}
