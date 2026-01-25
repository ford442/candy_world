import * as THREE from 'three';
import { PointsNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import {
    Fn, uniform, storage, instanceIndex, float, vec3,
    mix, sin, cos, normalize, color,
    mx_noise_float, vertexIndex, max, length, min
} from 'three/tsl';
import { uTime, uAudioLow, uAudioHigh, uPlayerPosition } from './common.js';

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
        // Let's make them jitter/explode slightly
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
        // Soft clamp: if y < 0.5, push up
        // Simple conditional assignment isn't always easy in TSL without 'If',
        // but we can use mix or max.
        // p.y = max(p.y, 0.5)
        p.y.assign(max(p.y, float(0.5)));

    });

    const computeNode = computeFireflies().compute(count);

    // 3. Create Visualization Material
    const material = new PointsNodeMaterial({
        size: 0.15,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    // Read from storage using vertexIndex (since we are rendering points)
    // Note: storage(...).element(node) reads the buffer at that index.
    const particlePos = positionStorage.element(vertexIndex);
    const particlePhase = storage(phaseBuffer, 'float', count).element(vertexIndex);

    material.positionNode = particlePos;

    // Color Logic (Audio Reactive Blink)
    const blinkSpeed = float(2.0);
    const blink = sin(uTime.mul(blinkSpeed).add(particlePhase)); // -1 to 1
    const sharpBlink = max(float(0.0), blink); // 0 to 1

    // Color Palette: Green/Gold
    const colorA = color(0x88FF00); // Green
    const colorB = color(0xFFFF00); // Gold

    // Treble boost
    const intensity = sharpBlink.add(uAudioHigh.mul(3.0)); // Audio makes them super bright

    // Mix color based on intensity
    const mixFactor = min(float(1.0), intensity.mul(0.5));
    const finalColor = mix(colorA, colorB, mixFactor);

    material.colorNode = finalColor.mul(intensity);
    material.opacityNode = min(float(1.0), intensity.add(0.2));

    // 4. Create Mesh
    // We need a geometry with a 'position' attribute to determine draw count,
    // even though we overwrite positionNode.
    // Ideally we use a buffer with 'count' vertices.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positionBuffer); // Attach as attribute too (standard requirement for Points)
    geometry.drawRange.count = count;

    const fireflies = new THREE.Points(geometry, material);
    fireflies.frustumCulled = false; // Always update/draw as they move procedurally
    fireflies.userData.computeNode = computeNode;
    fireflies.userData.isFireflies = true;

    return fireflies;
}
