import * as THREE from 'three';
import { MeshStandardNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import {
    Fn, uniform, storage, instanceIndex, float, vec3,
    mix, sin, cos, normalize, color,
    mx_noise_float, positionLocal, max, length, min,
    vec4, positionWorld, normalLocal
} from 'three/tsl';
import {
    uTime, uAudioLow, uAudioHigh, uPlayerPosition,
    sharedGeometries, createJuicyRimLight
} from './common.ts';

export function createFireflies(count = 150, areaSize = 100) {
    // 1. Setup Buffers
    const positionBuffer = new StorageBufferAttribute(count, 3);
    const velocityBuffer = new StorageBufferAttribute(count, 3);
    const anchorBuffer = new StorageBufferAttribute(count, 3);
    const phaseBuffer = new StorageBufferAttribute(count, 1); // Phase for blinking

    // Initialize with random data
    for (let i = 0; i < count; i++) {
        // Random position within area
        const x = (Math.random() - 0.5) * areaSize;
        const y = 1.0 + Math.random() * 5.0; // Keep above ground (1.0 to 6.0)
        const z = (Math.random() - 0.5) * areaSize;

        positionBuffer.setXYZ(i, x, y, z);
        anchorBuffer.setXYZ(i, x, y, z); // Anchor is initial position

        // Random small velocity
        velocityBuffer.setXYZ(i, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1);

        phaseBuffer.setX(i, Math.random() * Math.PI * 2);
    }

    // 2. Create Compute Logic
    // Access buffers as storage nodes
    const positionStorage = storage(positionBuffer, 'vec3', count);
    const velocityStorage = storage(velocityBuffer, 'vec3', count);
    const anchorStorage = storage(anchorBuffer, 'vec3', count);

    // Compute shader runs per instance (thread)
    const computeFireflies = Fn(() => {
        const p = positionStorage.element(instanceIndex);
        const v = velocityStorage.element(instanceIndex);
        const anchor = anchorStorage.element(instanceIndex);

        // Forces

        // 1. Spring to Anchor (Keep them in their territory)
        const toAnchor = anchor.sub(p);
        const springForce = toAnchor.mul(0.5); // Spring constant

        // 2. Wander / Curl Noise
        // Create a 3D noise vector by sampling noise at offsets
        const noiseScale = float(0.1);
        const timeScale = uTime.mul(0.5);
        const noiseInput = p.mul(noiseScale).add(timeScale);

        const noiseX = mx_noise_float(noiseInput);
        const noiseY = mx_noise_float(noiseInput.add(vec3(10.0))); // Offset for Y
        const noiseZ = mx_noise_float(noiseInput.add(vec3(20.0))); // Offset for Z

        const wanderForce = vec3(noiseX, noiseY, noiseZ).mul(2.0);

        // 3. Audio Repulsion / Turbulence (Bass Kick)
        // If uAudioLow is high, push particles away from their current direction or center
        const audioForce = normalize(v).mul(uAudioLow).mul(5.0);

        // 4. Player Interaction (Repulsion)
        const toPlayer = p.sub(uPlayerPosition);
        const distToPlayer = length(toPlayer);
        // Repel if within 5 units
        const repelRadius = float(5.0);
        const repelStrength = max(float(0.0), repelRadius.sub(distToPlayer));
        const playerRepelForce = normalize(toPlayer).mul(repelStrength).mul(10.0);

        // Integration (Euler)
        const dt = float(0.016); // Fixed time step for stability
        const acceleration = springForce.add(wanderForce).add(audioForce).add(playerRepelForce);

        const newVel = v.add(acceleration.mul(dt));

        // Damping (Air Resistance)
        const dampedVel = newVel.mul(0.95);

        // Apply
        v.assign(dampedVel);
        p.assign(p.add(dampedVel.mul(dt)));

        // Floor constraint (bounce or clamp)
        // p.y = max(p.y, 0.5)
        p.y.assign(max(p.y, float(0.5)));

    });

    const computeNode = computeFireflies().compute(count);

    // 3. Create Visualization (InstancedMesh)
    // Use low-poly sphere for performance
    const geometry = sharedGeometries.sphereLow;

    // TSL Material
    const material = new MeshStandardNodeMaterial({
        roughness: 0.4,
        metalness: 0.1,
        transparent: true, // Needed for opacity fade
        depthWrite: false, // Don't occlude other fireflies
        blending: THREE.AdditiveBlending
    });

    // --- TSL Vertex Logic ---
    const instancePos = positionStorage.element(instanceIndex);
    const instanceVel = velocityStorage.element(instanceIndex);
    const instancePhase = storage(phaseBuffer, 'float', count).element(instanceIndex);

    // Scaling & Squash/Stretch
    const baseScale = float(0.15); // Base size

    // Stretch based on velocity magnitude
    const speed = length(instanceVel);
    const stretchFactor = min(speed.mul(2.0), float(1.0)); // Cap stretch

    // Y-axis aligns with movement?
    // For simplicity, we just stretch Y and squash XZ based on speed,
    // assuming they move mostly vertically or we don't care about perfect alignment for tiny dots.
    // Ideally we align to velocity, but that's complex rotation.
    // Let's just pulse-scale instead for "Juice".

    // Pulse on Audio High (Excitement)
    const audioPulse = uAudioHigh.mul(0.5);
    const scalePulse = sin(uTime.mul(5.0).add(instancePhase)).mul(0.1);

    const finalScale = baseScale.add(scalePulse).add(audioPulse.mul(0.2));

    // Simple squash: when moving fast up/down (Y velocity), stretch Y
    const yVelAbs = instanceVel.y.abs();
    const squashY = float(1.0).add(yVelAbs.mul(2.0)); // Stretch Y
    const squashXZ = float(1.0).div(squashY.sqrt()); // Preserve volume approx

    // Apply position & scale
    const scaledVertex = positionLocal.mul(finalScale).mul(vec3(squashXZ, squashY, squashXZ));
    material.positionNode = instancePos.add(scaledVertex);

    // Recalculate normal for lighting (spheres need this or they look flat)
    // Since we squashed, normals are distorted.
    // Approximate: Just use original local normal (good enough for tiny glowing orbs)
    material.normalNode = normalLocal;

    // --- TSL Color/Emissive Logic ---

    // Blink Logic
    const blinkSpeed = float(2.0);
    const blink = sin(uTime.mul(blinkSpeed).add(instancePhase)); // -1 to 1
    const sharpBlink = max(float(0.0), blink); // 0 to 1

    // Colors
    const colorA = color(0x88FF00); // Green
    const colorB = color(0xFFFF00); // Gold

    // Mix based on intensity/blink
    const intensity = sharpBlink.add(uAudioHigh.mul(3.0)); // Audio boost
    const mixFactor = min(float(1.0), intensity.mul(0.5));
    const baseColor = mix(colorA, colorB, mixFactor);

    material.colorNode = baseColor;

    // Juicy Rim Light (The "Palette" Polish)
    // Makes them look like magical glass orbs
    const rim = createJuicyRimLight(baseColor, float(2.0), float(3.0));

    // Emissive = Base Glow + Rim
    const glow = baseColor.mul(intensity);
    material.emissiveNode = glow.add(rim);

    // Opacity
    material.opacityNode = min(float(1.0), intensity.add(0.2));

    // 4. Instantiate
    const fireflies = new THREE.InstancedMesh(geometry, material, count);
    fireflies.userData.computeNode = computeNode;
    fireflies.userData.isFireflies = true;
    fireflies.frustumCulled = false; // Always update

    return fireflies;
}
