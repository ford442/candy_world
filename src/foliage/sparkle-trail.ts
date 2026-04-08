import * as THREE from 'three';
import { PointsNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import { vec4, attribute, float, mix, color, vec3, smoothstep, sin, positionLocal, cos, Fn, instanceIndex, storage, uniform, If, length, floor } from 'three/tsl';

// WGSL-compatible modulo: x - y * floor(x / y)
const modFloat = (x: any, y: any) => x.sub(y.mul(x.div(y).floor()));
import { uTime, uAudioHigh, uAudioLow } from './index.ts';

const TRAIL_SIZE = 2000; // Increased buffer size for richer trails

// Exporting interface for better type safety if needed elsewhere
export interface SparkleTrailUserData {
    head: number;
    isSparkleTrail: boolean;
    bufferSize: number;
    computeNode: any;
    uSpawnPos: any;
    uSpawnVel: any;
    uSpawnCount: any;
    uSpawnIndex: any;
    uDeltaTime: any;
    uCurrentTime: any;
}

export function createSparkleTrail(): THREE.Points {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(TRAIL_SIZE * 3);
    const states = new Float32Array(TRAIL_SIZE * 4); // x: birthTime, y: lifeSpan, z: spawnSpeed, w: randomOffset
    const randOffsets = new Float32Array(TRAIL_SIZE * 3); // random position offset for juice

    // Fill with initial data to avoid empty buffer issues
    for (let i = 0; i < TRAIL_SIZE; i++) {
        states[i * 4] = -1000; // birthTime
        states[i * 4 + 1] = 0; // lifeSpan
        states[i * 4 + 2] = 0; // spawnSpeed
        states[i * 4 + 3] = Math.random(); // random scalar

        randOffsets[i * 3] = (Math.random() - 0.5) * 0.6;
        randOffsets[i * 3 + 1] = 0.1 + Math.random() * 0.4;
        randOffsets[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
    }

    // Use Storage Buffers for Compute Shaders
    const positionBuffer = new StorageBufferAttribute(positions, 3);
    const stateBuffer = new StorageBufferAttribute(states, 4);
    const offsetBuffer = new StorageBufferAttribute(randOffsets, 3);

    geo.setAttribute('position', positionBuffer);
    geo.setAttribute('state', stateBuffer);

    // Material
    const mat = new PointsNodeMaterial({
        size: 0.5,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const state = attribute('state', 'vec4');
    const birthTime = state.x;
    const lifeSpan = state.y;
    const spawnSpeed = state.z;

    const age = uTime.sub(birthTime);
    // Add small epsilon to avoid divide by zero, though lifeSpan should be > 0 when active
    const lifeProgress = age.div(lifeSpan.add(0.001)); // 0.0 to 1.0

    // --- TSL PHYSICS (Juice) ---

    // Speed Factor (0.0 at walking, 1.0 at sprint/dash)
    // Helps modulate effects based on how fast player was moving when particle spawned
    // PALETTE: Lowered threshold to 0.5 so even slow walking generates sparkles
    const speedFactor = smoothstep(0.5, 15.0, spawnSpeed);

    // 1. Drift Upwards (Magic Dust rises)
    // Faster movement = Higher drift
    const driftUp = vec3(0.0, age.mul(1.5).add(age.mul(speedFactor).mul(1.0)), 0.0);

    // 2. Swirl Effect (Spiral out as they rise)
    const swirlFreq = float(5.0).add(speedFactor.mul(5.0)); // Faster swirl when running
    const swirlAmp = age.mul(0.2).add(age.mul(speedFactor).mul(0.3)); // Wider swirl when running

    const swirl = vec3(
        sin(age.mul(swirlFreq)).mul(swirlAmp),
        float(0.0),
        cos(age.mul(swirlFreq)).mul(swirlAmp)
    );

    // Apply displacement to the base position
    mat.positionNode = positionLocal.add(driftUp).add(swirl);

    // --- VISUALS ---

    // Opacity: Fade in quickly, fade out smoothly
    const fadeIn = smoothstep(0.0, 0.1, lifeProgress);
    const fadeOut = float(1.0).sub(smoothstep(0.4, 1.0, lifeProgress));
    const opacity = fadeIn.mul(fadeOut);

    // Audio Reactivity: Pulse size with High Frequencies (Hi-hats) AND Low (Kick)
    // Adding Kick (uAudioLow) gives it that "heartbeat" feel
    const audioScale = float(1.0).add(uAudioHigh.mul(2.0)).add(uAudioLow.mul(0.5));

    // Size: Shrink over time, scale by Audio, scale by Speed
    // PALETTE: Smaller base size when walking slow to avoid clutter
    const baseSize = float(0.2).add(speedFactor.mul(0.5));
    const sizeNode = baseSize.mul(float(1.0).sub(lifeProgress)).mul(audioScale);
    mat.sizeNode = sizeNode;

    // Color: Cycle Gold -> Pink -> Cyan based on age
    // PALETTE: Tuned colors for maximum candy vibe
    const colorGold = color(0xFFD700);
    const colorPink = color(0xFF69B4);
    const colorCyan = color(0x00FFFF);
    const colorHot = color(0xFF00AA); // Magenta (Hot Pink) for high speed

    // Mix 1: Gold -> Pink (First half)
    const mix1 = mix(colorGold, colorPink, smoothstep(0.0, 0.5, lifeProgress));
    // Mix 2: Result -> Cyan (Second half)
    const coolMix = mix(mix1, colorCyan, smoothstep(0.5, 1.0, lifeProgress));

    // Final Color: Mix Cool -> Hot based on Speed
    // If sprinting, shift towards fiery/energetic colors
    const finalColor = mix(coolMix, colorHot, speedFactor.mul(0.8)); // Increased mix strength to 0.8

    // Twinkle: High frequency sine flicker to simulate glitter
    const randomFlickerOffset = state.w.mul(100.0);
    const twinkle = sin(age.mul(30.0).add(randomFlickerOffset)).mul(0.5).add(0.5);

    // Emission Boost
    const intensity = float(3.0).add(speedFactor.mul(2.0));
    mat.colorNode = finalColor.mul(twinkle.add(0.5)).mul(intensity);
    // Hide particles that are dead
    mat.opacityNode = opacity.mul(smoothstep(0.0, 0.01, lifeSpan));

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;

    // COMPUTE SHADER LOGIC
    const uSpawnPos = uniform(new THREE.Vector3());
    const uSpawnVel = uniform(new THREE.Vector3());
    const uSpawnCount = uniform(0);
    const uSpawnIndex = uniform(-1);
    const uCurrentTime = uniform(0);

    const updateTrailCompute = Fn(() => {
        const index = instanceIndex;

        const posNode = storage(positionBuffer, 'vec3', positionBuffer.count).element(index);
        const stateNode = storage(stateBuffer, 'vec4', stateBuffer.count).element(index);
        const offsetNode = storage(offsetBuffer, 'vec3', offsetBuffer.count).element(index);

        const spawnCount = uSpawnCount.toVar();
        const spawnIdx = uSpawnIndex.toVar();

        // Handle wrapping logic manually in TSL since modulo operations can be tricky
        // If the current particle index is within the range [spawnIdx, spawnIdx + spawnCount) (handling wrap around)

        // Is this index one of the ones being spawned this frame?
        const diff = index.sub(spawnIdx);
        // Add TRAIL_SIZE to handle negative diffs, then modulo
        const wrappedDiff = modFloat(diff.add(float(TRAIL_SIZE)), float(TRAIL_SIZE));

        If(wrappedDiff.lessThan(spawnCount), () => {
            // Spawn new particle!
            posNode.assign(uSpawnPos.add(offsetNode));

            // Random life between 0.8 and 1.4
            // Since we can't easily do random in compute cleanly per-frame per-instance without state,
            // we use the pre-generated random w component to vary the life
            const randomLife = float(0.8).add(stateNode.w.mul(0.6));

            // Speed is length of uSpawnVel
            const speed = length(uSpawnVel);

            // update state: x=birthTime, y=lifeSpan, z=spawnSpeed, w=keep existing random
            stateNode.assign(vec4(uCurrentTime, randomLife, speed, stateNode.w));
        });
    });

    const computeNode = updateTrailCompute().compute(TRAIL_SIZE);

    // Custom data for JS update loop
    points.userData = {
        head: 0,
        isSparkleTrail: true,
        bufferSize: TRAIL_SIZE,
        computeNode: computeNode,
        uSpawnPos: uSpawnPos,
        uSpawnVel: uSpawnVel,
        uSpawnCount: uSpawnCount,
        uSpawnIndex: uSpawnIndex,
        uCurrentTime: uCurrentTime,
        uDeltaTime: null
    } as SparkleTrailUserData;

    return points;
}

export function updateSparkleTrail(trail: THREE.Points, playerPos: THREE.Vector3, playerVel: THREE.Vector3, time: number, renderer: THREE.WebGLRenderer | any) {
    if (!trail || !trail.userData.isSparkleTrail) return;

    const userData = trail.userData as SparkleTrailUserData;

    // Always update current time for the compute shader to run properly over living particles
    userData.uCurrentTime.value = time;

    const speed = playerVel.length();

    let spawnCount = 0;
    if (speed >= 0.5) {
        // Scale particle count by speed
        // More particles for better trails, but ensure at least 1 when moving slow
        spawnCount = Math.max(1, Math.min(Math.floor(speed / 1.5), 20));

        // Update uniforms for the compute shader to spawn new particles
        userData.uSpawnPos.value.copy(playerPos);
        userData.uSpawnVel.value.copy(playerVel);
        userData.uSpawnCount.value = spawnCount;
        userData.uSpawnIndex.value = userData.head;

        // Advance head
        userData.head = (userData.head + spawnCount) % userData.bufferSize;
    } else {
        // No spawning this frame
        userData.uSpawnCount.value = 0;
    }

    // Execute the compute shader
    if (renderer && renderer.compute && spawnCount > 0) {
        renderer.compute(userData.computeNode);
    }
}
