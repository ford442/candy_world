// src/foliage/aurora.ts

import * as THREE from 'three';
import { color, float, vec3, vec4, uv, mix, smoothstep, uniform, Fn, time, mx_noise_float, positionWorld, positionLocal, dot, sin, cos, storage, instanceIndex, vec2, If } from 'three/tsl';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';
import { uAudioLow, uAudioHigh, CandyPresets, uTime, createJuicyRimLight } from './common.ts';
import { getSphereGeometry } from '../utils/geometry-dedup.ts';

// Global uniforms for Aurora control
export const uAuroraIntensity = uniform(0.0); // 0.0 to 1.0
export const uAuroraColor = uniform(color(0x00FF99)); // Base color (Greenish default)
export const uAuroraSpeed = uniform(0.2); // Speed of the wave movement

export function createAurora(): THREE.Mesh {
    // Create a tall cylinder for the aurora curtain
    // Radius ~800, Height ~500, High segment count for smooth waves
    const geometry = new THREE.CylinderGeometry(800, 800, 500, 128, 32, true);
    geometry.translate(0, 300, 0); // Lift it up into the sky

    // TSL Shader Logic
    const mainAurora = Fn(() => {
        const vUv = uv();

        // 1. Organic Curtain Movement (Noise-based)
        // Displace UVs with noise to create "folds"
        // Bass boosts speed slightly
        const timeScaled = time.mul(uAuroraSpeed.add(uAudioLow.mul(0.1)));

        // Large slow wave
        const noise1 = mx_noise_float(vec3(vUv.x.mul(5.0), timeScaled.mul(0.5), float(0.0)));
        // Smaller fast ripple
        const noise2 = mx_noise_float(vec3(vUv.x.mul(15.0).add(noise1), timeScaled.mul(1.5), float(0.0)));

        const distortedX = vUv.x.add(noise1.mul(0.2)).add(noise2.mul(0.1));

        // 2. Vertical Rays
        // High frequency noise for the "curtain rays"
        const rayNoise = mx_noise_float(vec3(distortedX.mul(30.0), float(0.0), float(0.0)));
        const rayIntensity = smoothstep(0.3, 0.7, rayNoise).mul(0.8).add(0.2);

        // 3. Audio Reactivity (Juice)
        // Bass pushes the curtain "up" (modulates vertical fade)
        const bassLift = uAudioLow.mul(0.2);

        // Treble adds "sparkle" or "shimmer" to the rays
        const shimmer = uAudioHigh.mul(mx_noise_float(vec3(vUv.x.mul(100.0), time.mul(5.0), vUv.y)));

        // 4. Vertical Fade (Soft top and bottom)
        const bottomFade = smoothstep(0.0, 0.3, vUv.y.add(bassLift));
        const topFade = float(1.0).sub(smoothstep(0.7, 1.0, vUv.y));
        const verticalFade = bottomFade.mul(topFade);

        // 5. Spectral Color Shift
        // Base color mixed with a "Magic" color (Purple/Pink) based on height and Audio
        const magicColor = color(0x9933FF);
        // More purple when bass hits or at top
        const colorMix = vUv.y.mul(0.5).add(uAudioLow.mul(0.4)).min(1.0);

        const finalColorRGB = mix(uAuroraColor, magicColor, colorMix);

        // 6. Combine
        // Rays + Shimmer + Fade + Global Intensity
        const combinedIntensity = rayIntensity.add(shimmer).mul(verticalFade).mul(uAuroraIntensity);

        return vec4(finalColorRGB, combinedIntensity);
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = mainAurora();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.fog = false; // Aurora glows through fog

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.type = 'aurora';
    mesh.frustumCulled = false; // Always visible in sky

    return mesh;
}

// --- HARMONY ORBS SYSTEM ---

const MAX_ORBS = 50;

class HarmonyOrbSystem {
    mesh: THREE.InstancedMesh;
    dropCooldown: number = 0;

    // WebGPU Compute specific
    positionBuffer: StorageInstancedBufferAttribute;
    velocityBuffer: StorageInstancedBufferAttribute;
    stateBuffer: StorageInstancedBufferAttribute; // x: life, y: scale (negative life = inactive)
    computeNode: any;

    // Uniforms for compute
    private uDeltaTime = uniform(0.016);
    private uOrbAudioSway = uniform(0.0);

    // Spawning Uniforms
    private uSpawnIndex = uniform(-1); // -1 means no spawn this frame
    private uSpawnPos = uniform(vec3(0));
    private uSpawnVel = uniform(vec3(0));

    // CPU-side tracking to prevent spawning over active orbs without reading back from GPU
    private _nextSpawnIndex: number = 0;

    constructor() {
        // High quality sphere for glossy look
        const geometry = getSphereGeometry(0.3, 32, 32);

        // 1. Initialize Storage Buffers (Empty arrays, initialized in compute)
        const initialPositions = new Float32Array(MAX_ORBS * 3);
        const initialVelocities = new Float32Array(MAX_ORBS * 3);
        const initialStates = new Float32Array(MAX_ORBS * 2);

        for (let i = 0; i < MAX_ORBS; i++) {
            initialStates[i * 2] = -1.0;     // Life
            initialStates[i * 2 + 1] = 0.0;  // Scale
            initialPositions[i * 3 + 1] = -9999.0;
        }

        this.positionBuffer = new StorageInstancedBufferAttribute(initialPositions, 3);
        this.velocityBuffer = new StorageInstancedBufferAttribute(initialVelocities, 3);
        this.stateBuffer = new StorageInstancedBufferAttribute(initialStates, 2);

        // CandyPresets.Gummy base
        const opts = {
            transmission: 0.8,
            thickness: 1.5,
            roughness: 0.1,
            ior: 1.5,
            subsurfaceStrength: 1.0,
            subsurfaceColor: 0x9933FF
        };
        const material = CandyPresets.Gummy(0x9933FF, opts);

        // TSL Logic for Audio-Reactive Pulse and Glow
        const baseColor = color(0x00FF99);
        const magicColor = color(0x9933FF);

        // Mix colors based on audio high
        const orbColor = mix(baseColor, magicColor, uAudioHigh.add(float(0.5)).min(1.0));

        // Emissive: Pulse with bass and rim light
        const phase = dot(positionWorld, vec3(0.5)).mul(5.0);
        const beatSpeed = float(8.0);
        const heartbeat = sin(uTime.mul(beatSpeed).add(phase)).pow(4.0);
        const glowIntensity = float(0.5).add(heartbeat.mul(uAudioLow));

        // Add rim light for juice
        const rim = createJuicyRimLight(orbColor, float(1.5), float(3.0), null);

        material.emissiveNode = orbColor.mul(glowIntensity).add(rim);

        // 2. Map Storage Buffers to Material
        const instIndex = instanceIndex;
        const stateNode = storage(this.stateBuffer, 'vec2', this.stateBuffer.count).element(instIndex);
        const positionNode = storage(this.positionBuffer, 'vec3', this.positionBuffer.count).element(instIndex);

        const orbScale = stateNode.y;

        // Vertex displacement (Squishy feel based on velocity/audio)
        // Scale with bass AND individual orb scale
        const scaleFactor = float(1.0).add(heartbeat.mul(uAudioLow).mul(0.3)).mul(orbScale);

        // Final position = (Local * Scale) + WorldPosition from Buffer
        material.positionNode = positionLocal.mul(scaleFactor).add(positionNode);

        this.mesh = new THREE.InstancedMesh(geometry, material, MAX_ORBS);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = false;

        // 3. Define TSL Compute Node for Physics/Lifecycle Updates
        const updateOrbsCompute = Fn(() => {
            const index = instanceIndex;

            const position = storage(this.positionBuffer, 'vec3', this.positionBuffer.count).element(index);
            const velocity = storage(this.velocityBuffer, 'vec3', this.velocityBuffer.count).element(index);
            const state = storage(this.stateBuffer, 'vec2', this.stateBuffer.count).element(index);

            const life = state.x;
            const currentScale = state.y;
            const pos = position.toVar();
            const vel = velocity.toVar();

            // Handle Spawning
            If(index.equal(this.uSpawnIndex), () => {
                state.x = float(20.0); // 20s life
                state.y = float(0.1);  // Initial scale
                position.assign(this.uSpawnPos);
                velocity.assign(this.uSpawnVel);
            }).ElseIf(life.greaterThan(0.0), () => {
                // Update active orbs
                // Decrease life
                state.x = life.sub(this.uDeltaTime);

                // Increase scale to max 1.0
                state.y = currentScale.add(this.uDeltaTime).min(1.0);

                // Physics: Gravity
                vel.y = vel.y.sub(float(9.8).mul(0.2).mul(this.uDeltaTime)); // Floaty gravity

                // Wind Sway (based on life/time)
                const swaySpeed = float(2.0);
                vel.x = vel.x.add(sin(life.mul(swaySpeed)).mul(2.0).mul(this.uDeltaTime));
                vel.z = vel.z.add(cos(life.mul(swaySpeed).mul(0.75)).mul(2.0).mul(this.uDeltaTime));

                // Terminal velocity for falling
                vel.y = vel.y.max(-5.0);

                // Audio Sway Reactivity
                vel.x = vel.x.add(this.uOrbAudioSway.mul(this.uDeltaTime));

                velocity.assign(vel);

                // Update Position
                position.assign(pos.add(vel.mul(this.uDeltaTime)));

                // Floor Collision -> Destroy
                // Note: We access the specific component of the vector since position.y isn't valid on a var in this TSL context
                const posY = pos.add(vel.mul(this.uDeltaTime)).y;
                If(posY.lessThan(-5.0), () => {
                     state.x = float(-1.0); // Kill
                     // Assign new hidden position
                     position.assign(vec3(pos.x, float(-9999.0), pos.z));
                });
            });
        });

        this.computeNode = updateOrbsCompute().compute(MAX_ORBS);
    }

    addToScene(scene: THREE.Scene) {
        scene.add(this.mesh);
    }

    spawnOrb(playerPos: THREE.Vector3) {
        // Use ring-buffer approach for spawning to avoid reading back from GPU
        // Assuming orbs live ~20s, pool of 50 should be plenty
        const idx = this._nextSpawnIndex;
        this._nextSpawnIndex = (this._nextSpawnIndex + 1) % MAX_ORBS;

        const spawnRadius = 30.0;
        this.uSpawnPos.value.set(
            playerPos.x + (Math.random() - 0.5) * spawnRadius,
            200.0 + Math.random() * 50.0,
            playerPos.z + (Math.random() - 0.5) * spawnRadius
        );

        this.uSpawnVel.value.set(
            (Math.random() - 0.5) * 5.0,
            -10.0,
            (Math.random() - 0.5) * 5.0
        );

        this.uSpawnIndex.value = idx;
    }

    update(dt: number, audioState: any, playerPos: THREE.Vector3) {
        // Reset spawn index at start of frame
        // If spawnOrb is called this frame, it will be overridden with the new index
        this.uSpawnIndex.value = -1;
        this.uDeltaTime.value = dt;

        let harmonicTrigger = 0;
        if (audioState && audioState.channelData) {
            if (audioState.channelData[4] && audioState.channelData[4].trigger > 0.8) harmonicTrigger = 1;
            if (audioState.channelData[5] && audioState.channelData[5].trigger > 0.8) harmonicTrigger = 1;

            // Pass audio context to compute shader for wind sway
            this.uOrbAudioSway.value = (audioState.channelData[0]?.trigger || 0) * 5.0;
        }

        if (this.dropCooldown > 0) {
            this.dropCooldown -= dt;
        } else if (harmonicTrigger > 0 && Math.random() < 0.3) {
            this.spawnOrb(playerPos);
            this.dropCooldown = 5.0; // Drop one every 5 seconds max
        }

        let needsUpdate = false;

        for (let i = 0; i < MAX_ORBS; i++) {
            const orb = this.orbs[i];
            if (!orb.active) continue;

            orb.life -= dt;
            if (orb.life <= 0) {

                orb.active = false;
                // ⚡ OPTIMIZATION: Direct matrix write bypasses Object3D overhead
                const te = this.mesh.instanceMatrix.array;
                const offset = i * 16;
                te[offset] = 0; te[offset+5] = 0; te[offset+10] = 0;
                te[offset+12] = 0; te[offset+13] = -9999; te[offset+14] = 0;
                needsUpdate = true;
                continue;
            }


            // Physics: Gravity, Wind, Floatiness
            orb.velocity.y -= 9.8 * 0.2 * dt; // Slow, floaty gravity (feather-like)

            // Add some sway based on sine wave (like a falling leaf or bubble)
            orb.velocity.x += Math.sin(orb.life * 2.0) * 2.0 * dt;
            orb.velocity.z += Math.cos(orb.life * 1.5) * 2.0 * dt;

            // Terminal velocity (slow fall)
            if (orb.velocity.y < -5.0) orb.velocity.y = -5.0;

            orb.position.addScaledVector(orb.velocity, dt);

            // Ground collision
            // We do a simple height check. Ideally we use getGroundHeight, but since orbs are floaty, we can just say y < 0 is destroyed.
            if (orb.position.y < -5.0) {

                orb.active = false;
                // ⚡ OPTIMIZATION: Direct matrix write bypasses Object3D overhead
                const te = this.mesh.instanceMatrix.array;
                const offset = i * 16;
                te[offset] = 0; te[offset+5] = 0; te[offset+10] = 0;
                te[offset+12] = 0; te[offset+13] = -9999; te[offset+14] = 0;
                needsUpdate = true;
                continue;
            }


            // Scale up smoothly
            if (orb.scale < 1.0) {
                orb.scale += dt;
                if (orb.scale > 1.0) orb.scale = 1.0;

            }

            // ⚡ OPTIMIZATION: Direct matrix write for scale and translation
            const te = this.mesh.instanceMatrix.array;
            const offset = i * 16;
            const s = orb.scale;
            te[offset] = s; te[offset+5] = s; te[offset+10] = s;
            te[offset+12] = orb.position.x;
            te[offset+13] = orb.position.y;
            te[offset+14] = orb.position.z;
            needsUpdate = true;
        }

        if (needsUpdate) {
            this.mesh.instanceMatrix.needsUpdate = true;
        }
    }
}

export const harmonyOrbSystem = new HarmonyOrbSystem();
