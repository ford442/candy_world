import * as THREE from 'three';
import { PointsNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import {
    Fn, uniform, storage, instanceIndex, float, vec3,
    mix, sin, cos, normalize, color,
    mx_noise_float, vertexIndex, max, min, length,
    positionLocal, time, uv, distance, smoothstep, discard,
    vec2
} from 'three/tsl';
import { uTime, uAudioLow, uAudioHigh, uWindSpeed, uWindDirection, uPlayerPosition } from './common.ts';

export function createNeonPollen(count = 2000, areaSize = 30, center = new THREE.Vector3(0, 5, 0)) {
    // 1. Setup Buffers
    const positionBuffer = new StorageBufferAttribute(count, 3);
    const velocityBuffer = new StorageBufferAttribute(count, 3);
    const lifeBuffer = new StorageBufferAttribute(count, 1);

    // Initialize with random data
    for (let i = 0; i < count; i++) {
        // Random position within area (Sphere-ish distribution)
        const r = Math.cbrt(Math.random()) * areaSize; // Cube root for uniform spherical volume
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const x = center.x + r * Math.sin(phi) * Math.cos(theta);
        const y = center.y + r * Math.sin(phi) * Math.sin(theta);
        const z = center.z + r * Math.cos(phi);

        positionBuffer.setXYZ(i, x, y, z);

        // Random small velocity
        velocityBuffer.setXYZ(i, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05);

        // Life offset / Random seed
        lifeBuffer.setX(i, Math.random() * 100.0);
    }

    // 2. Create Compute Logic
    const positionStorage = storage(positionBuffer, 'vec3', count);
    const velocityStorage = storage(velocityBuffer, 'vec3', count);
    const lifeStorage = storage(lifeBuffer, 'float', count);

    const computePollen = Fn(() => {
        const p = positionStorage.element(instanceIndex);
        const v = velocityStorage.element(instanceIndex);

        // --- Forces ---

        // 1. Wind Drift
        // Apply wind force scaled by wind speed
        const windForce = uWindDirection.mul(uWindSpeed).mul(0.05);

        // 2. Curl Noise (Wander)
        const noiseScale = float(0.2);
        const timeScale = uTime.mul(0.3);
        const noiseInput = p.mul(noiseScale).add(timeScale);

        const noiseX = mx_noise_float(noiseInput);
        const noiseY = mx_noise_float(noiseInput.add(vec3(31.41)));
        const noiseZ = mx_noise_float(noiseInput.add(vec3(42.5)));

        const wanderForce = vec3(noiseX, noiseY, noiseZ).mul(0.5);

        // 3. Audio Turbulence (Juice)
        // Bass kick creates a burst outward from center?
        // Or just general chaotic jitter.
        const audioJitter = normalize(v).mul(uAudioLow).mul(2.0);

        // 4. Center Attraction (Soft Constraint)
        const centerVec = vec3(center.x, center.y, center.z);
        const toCenter = centerVec.sub(p);
        const dist = length(toCenter);
        // If outside area, pull back gently
        const areaRadius = float(areaSize);
        const pullStrength = max(float(0.0), dist.sub(areaRadius)).mul(0.1);
        const centerForce = normalize(toCenter).mul(pullStrength);

        // --- PALETTE UPDATE: Player Repulsion (Interaction) ---
        // Push pollen away if player is close
        const toPlayer = p.sub(uPlayerPosition);
        const distToPlayer = length(toPlayer);
        // Repel Radius = 5.0
        const repelRadius = float(5.0);
        const repelFactor = max(float(0.0), repelRadius.sub(distToPlayer));
        // Force increases as distance decreases (Linear falloff)
        const repelForce = normalize(toPlayer).mul(repelFactor).mul(2.0);

        // Integration
        const dt = float(0.016);
        const acceleration = windForce.add(wanderForce).add(audioJitter).add(centerForce).add(repelForce);

        const newVel = v.add(acceleration.mul(dt));

        // Damping
        const dampedVel = newVel.mul(0.98);

        // Apply
        v.assign(dampedVel);
        p.assign(p.add(dampedVel.mul(dt)));

        // Floor constraint
        // Keep above water level ~1.8
        p.y.assign(max(p.y, float(1.8)));
    });

    const computeNode = computePollen().compute(count);

    // 3. Visualization Material
    const material = new PointsNodeMaterial({
        size: 0.1, // Will be overridden by sizeNode
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const particlePos = positionStorage.element(vertexIndex);
    const particleSeed = lifeStorage.element(vertexIndex);

    material.positionNode = particlePos;

    // --- PALETTE UPDATE: Soft Circular Particle Shape ---
    // Use uv() which maps 0..1 across the point sprite
    const distFromCenter = distance(uv(), vec2(0.5));
    // Smooth circle: 0.5 (edge) -> 0.0 (center)
    // Alpha falls off: 1.0 at center, 0.0 at edge
    const alpha = smoothstep(0.5, 0.2, distFromCenter);

    // Discard pixels outside circle for performance (reduce overdraw?)
    // Or just let alpha handle it. Discard is good for depth buffer but here we are transparent/no-depth-write.
    // Let's just use alpha.

    // --- PALETTE UPDATE: Twinkle & Sparkle ---
    // Random offset based on particleSeed
    const twinkleSpeed = float(5.0);
    const twinkle = sin(uTime.mul(twinkleSpeed).add(particleSeed)).mul(0.5).add(0.5); // 0..1

    // Audio Boost (Highs = Sparkle)
    // When melody plays, sparkles flare up
    const audioBoost = uAudioHigh.mul(3.0);
    const brightness = float(1.0).add(twinkle).add(audioBoost);

    // Color Logic (Neon Gradient)
    // Mix Cyan (0x00FFFF) and Magenta (0xFF00FF) based on position
    const hueMix = sin(particlePos.x.mul(0.1).add(particlePos.z.mul(0.1)).add(uTime)).mul(0.5).add(0.5);
    const cyan = color(0x00FFFF);
    const magenta = color(0xFF00FF);
    const baseColor = mix(cyan, magenta, hueMix);

    // Hot Core (White center)
    // Mix White at center (dist < 0.2)
    const coreMix = smoothstep(0.3, 0.0, distFromCenter);
    const finalColor = mix(baseColor, color(0xFFFFFF), coreMix.mul(0.5)); // 50% white core

    material.colorNode = finalColor.mul(brightness);
    material.opacityNode = alpha; // Apply circular mask

    // Size modulation
    // Base size + audio boost
    // Make them slightly larger so the soft edge is visible
    material.sizeNode = float(0.15).add(uAudioHigh.mul(0.1));

    // 4. Mesh
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positionBuffer);
    geometry.drawRange.count = count;

    const pollen = new THREE.Points(geometry, material);
    pollen.frustumCulled = false;
    pollen.userData.computeNode = computeNode;
    pollen.userData.isPollen = true;
    pollen.userData.type = 'neonPollen';

    return pollen;
}
