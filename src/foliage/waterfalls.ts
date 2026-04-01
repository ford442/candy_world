import * as THREE from 'three';
import { color, time, uv, float, vec2, mix, sin, uniform, UniformNode, normalWorld, Fn, storage, instanceIndex, vec3, positionLocal, max, length, min, abs } from 'three/tsl';
import { MeshStandardNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import { registerReactiveMaterial, attachReactivity, CandyPresets, uAudioHigh, uTime, createJuicyRimLight } from './common.ts';

/**
 * Creates a bioluminescent waterfall connecting two points.
 * @param {THREE.Vector3} startPos - Top position
 * @param {THREE.Vector3} endPos - Bottom position
 * @param {number} width - Width of the waterfall
 */
export function createWaterfall(startPos: THREE.Vector3, endPos: THREE.Vector3, width: number = 5.0): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Waterfall';

    const height = startPos.y - endPos.y;
    const midY = (startPos.y + endPos.y) / 2;

    // Use a CylinderGeometry with open ends, scaled flat.
    const geo = new THREE.CylinderGeometry(width, width * 1.5, height, 32, 16, true);

    // --- PALETTE: Unified Material Pipeline (SeaJelly Variant) ---
    // Use SeaJelly preset for wet, translucent, viscous look
    const mat = CandyPresets.SeaJelly(0x00FFFF, {
        transmission: 0.9,
        thickness: 1.2,
        roughness: 0.1,
        ior: 1.33,
        subsurfaceStrength: 0.5,
        subsurfaceColor: 0xCCFFFF,
        animateMoisture: true,
        thicknessDistortion: 0.6,
        side: THREE.DoubleSide
    });

    // Custom Flow & Reactivity Nodes
    const speed = 2.0;
    const flowUV = uv().add(vec2(0, time.mul(speed).negate())); // Scroll UV Y

    // Create a procedural ripple/foam pattern
    // We mix two sine waves for a more organic feel
    const ripple1 = sin(flowUV.y.mul(15.0).add(flowUV.x.mul(5.0))).mul(0.5).add(0.5);
    const ripple2 = sin(flowUV.y.mul(25.0).sub(flowUV.x.mul(10.0)).add(time)).mul(0.5).add(0.5);
    const foam = ripple1.mul(ripple2);

    // Dynamic Uniforms for Reactivity
    const uPulseIntensity = uniform(0.0); // Controlled by audio
    const uBaseEmission = float(0.2);     // Always slightly glowing

    // Color Gradient: Cyan (top) -> Purple (bottom)
    const gradient = mix(color(0xFF00FF), color(0x00FFFF), uv().y);

    // Modify the base color node from the preset (SeaJelly uses solid color usually)
    // We mix the gradient into the base color
    mat.colorNode = mix(mat.colorNode, gradient, 0.5);

    // 🎨 PALETTE: Integrate `createJuicyRimLight` and non-linear `uAudioHigh` for bioluminescent flow
    const rim = createJuicyRimLight(gradient, float(2.0), float(3.0), normalWorld);

    // Add foam brightness to emission
    // Pulse adds extra glow on beat
    const emission = gradient.mul(uBaseEmission.add(uPulseIntensity)).mul(foam.add(0.2));

    // Mix in the rim light and audio-driven highs for extra juice
    const highIntensity = uAudioHigh.pow(float(1.5)).mul(1.5);
    mat.emissiveNode = emission.add(rim).add(gradient.mul(highIntensity));

    // Modify roughness based on foam (foam is rougher)
    // Safety check: wrap in float() if roughnessNode is missing or primitive
    // In TSL, roughnessNode is usually a Node. If undefined, we can default.
    const currentRoughness = mat.roughnessNode || float(mat.roughness);
    mat.roughnessNode = currentRoughness.add(foam.mul(0.5));

    // -----------------------------------------------------------

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(startPos.x, midY, startPos.z);

    // Store uniforms for JS access
    mesh.userData.uPulseIntensity = uPulseIntensity;

    // Register for reactivity
    registerReactiveMaterial(mat);
    group.add(mesh);

    // ⚡ OPTIMIZATION: Phase 4 WebGPU Compute Shader Migration
    // Replaced CPU array loop and individual meshes with TSL StorageBuffers + Compute Shader
    const splashCount = 128; // Significantly increased particle count now that it's on GPU
    const positionBuffer = new StorageBufferAttribute(splashCount, 3);
    const velocityBuffer = new StorageBufferAttribute(splashCount, 3);

    for (let i = 0; i < splashCount; i++) {
        const x = startPos.x + (Math.random() - 0.5) * width;
        const y = endPos.y;
        const z = startPos.z + (Math.random() - 0.5) * width;
        positionBuffer.setXYZ(i, x, y, z);

        // Random initial velocity
        velocityBuffer.setXYZ(i, (Math.random() - 0.5) * 2.0, Math.random() * 8.0 + 2.0, (Math.random() - 0.5) * 2.0);
    }

    const positionStorage = storage(positionBuffer, 'vec3', splashCount);
    const velocityStorage = storage(velocityBuffer, 'vec3', splashCount);
    const baseFloorY = float(endPos.y);

    const computeSplashes = Fn(() => {
        const p = positionStorage.element(instanceIndex);
        const v = velocityStorage.element(instanceIndex);

        const dt = float(0.016);
        const gravity = vec3(0.0, -20.0, 0.0);

        // Audio reactive impulse
        // Use a threshold so they don't constantly jump, only on heavy beats
        const audioImpulse = max(float(0.0), uPulseIntensity.sub(float(0.5))).mul(20.0);
        const randSeed = p.x.mul(10.0).add(p.z.mul(10.0)).add(time.mul(100.0));

        // Add random variation to impulse so they don't all jump exactly the same
        const impulseVar = sin(randSeed).mul(0.5).add(0.5);
        const appliedImpulse = vec3(
            sin(randSeed.mul(2.0)).mul(audioImpulse).mul(0.5),
            audioImpulse.mul(impulseVar),
            cos(randSeed.mul(3.0)).mul(audioImpulse).mul(0.5)
        );

        const acceleration = gravity.add(appliedImpulse);
        const newVel = v.add(acceleration.mul(dt));
        const nextPos = p.add(newVel.mul(dt));

        // Floor collision / Reset logic
        // Use a functional approach: if nextPos.y < baseFloorY, apply bounce and reset, else apply normal movement

        // Condition checks

        // True branch: Bounce
        const bouncedVelY = abs(newVel.y).mul(0.4);

        // If bounced velocity is too low, we respawn the particle

        // Respawn logic
        const respawnX = float(startPos.x).add(sin(randSeed).mul(float(width * 0.5)));
        const respawnZ = float(startPos.z).add(cos(randSeed).mul(float(width * 0.5)));
        const respawnVel = vec3(
            sin(randSeed.mul(5.0)).mul(1.0),
            abs(cos(randSeed.mul(4.0))).mul(8.0).add(2.0),
            cos(randSeed.mul(6.0)).mul(1.0)
        );

        // TSL conditional logic using mix/step instead of If for better GPU performance and compatibility
        const bouncePos = vec3(nextPos.x, baseFloorY, nextPos.z);
        const bounceVel = vec3(newVel.x, bouncedVelY, newVel.z);

        const respawnPos = vec3(respawnX, baseFloorY, respawnZ);

        // Select between bounce and respawn based on speed
        const isTooSlowFloat = step(bouncedVelY, float(1.0)); // 1.0 if too slow, 0.0 if fast enough
        const chosenCollisionPos = mix(bouncePos, respawnPos, isTooSlowFloat);
        const chosenCollisionVel = mix(bounceVel, respawnVel, isTooSlowFloat);

        // Select between normal flight and collision based on floor check
        const isBelowFloorFloat = step(nextPos.y, baseFloorY); // 1.0 if below, 0.0 if above
        const finalPos = mix(nextPos, chosenCollisionPos, isBelowFloorFloat);
        const finalVel = mix(newVel, chosenCollisionVel, isBelowFloorFloat);

        p.assign(finalPos);
        v.assign(finalVel);
    });

    const computeNode = computeSplashes().compute(splashCount);

    const splashGeo = new THREE.SphereGeometry(width * 0.15, 8, 8);
    const splashMat = new MeshStandardNodeMaterial({
        roughness: 0.4,
        metalness: 0.0,
        transparent: true,
        color: 0xFFFFFF
    });

    // Vertex positioning from storage buffer
    const instancePos = positionStorage.element(instanceIndex);

    // Simple squash/stretch based on velocity
    const instanceVel = velocityStorage.element(instanceIndex);
    const speedScale = length(instanceVel);
    const stretchFactor = min(speedScale.mul(0.1).add(1.0), float(2.0));
    const squashFactor = float(1.0).div(stretchFactor.sqrt());

    const scaledVertex = positionLocal.mul(vec3(squashFactor, stretchFactor, squashFactor));
    splashMat.positionNode = instancePos.add(scaledVertex);

    // Dynamic emissive glow for splashes based on pulse
    const splashGlowColor = mix(color(0x00FFFF), color(0xFF00FF), uPulseIntensity);
    splashMat.emissiveNode = splashGlowColor.mul(uPulseIntensity.add(0.5));

    const splashInstanced = new THREE.InstancedMesh(splashGeo, splashMat, splashCount);
    splashInstanced.userData.computeNode = computeNode;
    splashInstanced.frustumCulled = false;
    group.add(splashInstanced);

    group.userData.type = 'waterfall';
    group.userData.computeNode = computeNode; // Tag group to be processed by compute manager if needed

    // --- AUDIO REACTIVITY ---
    attachReactivity(group, { minLight: 0.0, maxLight: 1.0, type: 'flora' }); // Reacts to lower channels (Bass/Melody)

    (group as any).reactToNote = (note: any, colorVal: any, velocity: number) => {
        // 1. Visual Pulse (TSL Uniform)
        // Bump intensity: base 0.0 -> adds up to 2.0 based on velocity
        (mesh.userData.uPulseIntensity as UniformNode<number>).value = 0.5 + (velocity * 2.0);
    };

    // Custom animate function to decay pulse
    (group as any).onAnimate = (delta: number, time: number) => {
        // Decay pulse
        const pulse = mesh.userData.uPulseIntensity as UniformNode<number>;
        if (pulse.value > 0.01) {
            pulse.value = THREE.MathUtils.lerp(pulse.value, 0.0, delta * 5.0);
        }

        // Compute node is handled globally by engine or we can force it here if necessary,
        // but typically WebGPU handles compute passes internally if added to the renderer.
        // For Three.js WebGPU, we just attach computeNode to userData and it should be executed if registered,
        // or we need to ensure the renderer runs it.
    };

    return group;
}
