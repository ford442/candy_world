import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, color, vec3, smoothstep, sin, positionLocal, cos } from 'three/tsl';
import { uTime, uAudioHigh, uAudioLow } from './common.ts';

const TRAIL_SIZE = 2000; // Increased buffer size for richer trails

interface SparkleTrailUserData {
    head: number;
    isSparkleTrail: boolean;
    bufferSize: number;
}

export function createSparkleTrail(): THREE.Points {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(TRAIL_SIZE * 3);
    const birthTimes = new Float32Array(TRAIL_SIZE);
    const lifeSpans = new Float32Array(TRAIL_SIZE);
    const spawnSpeeds = new Float32Array(TRAIL_SIZE);

    // Fill with initial data to avoid empty buffer issues
    birthTimes.fill(-1000);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('birthTime', new THREE.BufferAttribute(birthTimes, 1));
    geo.setAttribute('lifeSpan', new THREE.BufferAttribute(lifeSpans, 1));
    geo.setAttribute('spawnSpeed', new THREE.BufferAttribute(spawnSpeeds, 1));

    // Material
    const mat = new PointsNodeMaterial({
        size: 0.5,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const birthTime = attribute('birthTime');
    const lifeSpan = attribute('lifeSpan');
    const spawnSpeed = attribute('spawnSpeed');

    const age = uTime.sub(birthTime);
    const lifeProgress = age.div(lifeSpan); // 0.0 to 1.0

    // --- TSL PHYSICS (Juice) ---

    // Speed Factor (0.0 at walking, 1.0 at sprint/dash)
    // Helps modulate effects based on how fast player was moving when particle spawned
    // PALETTE: Lowered threshold to 4.0 so even walking generates sparkles
    const speedFactor = smoothstep(4.0, 25.0, spawnSpeed);

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
    const baseSize = float(0.4).add(speedFactor.mul(0.3));
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
    const twinkle = sin(age.mul(30.0)).mul(0.5).add(0.5);

    // Emission Boost
    const intensity = float(3.0).add(speedFactor.mul(2.0));
    mat.colorNode = finalColor.mul(twinkle.add(0.5)).mul(intensity);
    mat.opacityNode = opacity;

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;

    // Custom data for JS update loop
    points.userData = {
        head: 0,
        isSparkleTrail: true,
        bufferSize: TRAIL_SIZE
    } as SparkleTrailUserData;

    return points;
}

const _offset = new THREE.Vector3();

export function updateSparkleTrail(trail: THREE.Points, playerPos: THREE.Vector3, playerVel: THREE.Vector3, time: number) {
    if (!trail || !trail.userData.isSparkleTrail) return;

    const speed = playerVel.length();
    // Only spawn if moving (lowered threshold to 4.0 for walking visibility)
    if (speed < 4.0) return;

    // Scale particle count by speed
    // More particles for better trails
    const count = Math.min(Math.floor(speed / 2.0), 20);

    const geometry = trail.geometry;
    const positions = geometry.attributes.position;
    const birthTimes = geometry.attributes.birthTime;
    const lifeSpans = geometry.attributes.lifeSpan;
    const spawnSpeeds = geometry.attributes.spawnSpeed;

    const userData = trail.userData as SparkleTrailUserData;
    const size = userData.bufferSize;
    let currentHead = userData.head;

    for (let i = 0; i < count; i++) {
        // Random offset behind player (low to ground)
        _offset.set(
            (Math.random() - 0.5) * 0.6,
            0.1 + Math.random() * 0.4,
            (Math.random() - 0.5) * 0.6
        );

        positions.setXYZ(currentHead,
            playerPos.x + _offset.x,
            playerPos.y + _offset.y,
            playerPos.z + _offset.z
        );

        birthTimes.setX(currentHead, time);
        lifeSpans.setX(currentHead, 0.8 + Math.random() * 0.6); // 0.8s - 1.4s life
        spawnSpeeds.setX(currentHead, speed);

        currentHead = (currentHead + 1) % size;
    }

    userData.head = currentHead;

    positions.needsUpdate = true;
    birthTimes.needsUpdate = true;
    lifeSpans.needsUpdate = true;
    spawnSpeeds.needsUpdate = true;
}
