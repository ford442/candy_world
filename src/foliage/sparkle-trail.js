import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, color, vec3, smoothstep, sin, positionLocal, cos } from 'three/tsl';
import { uTime, uAudioHigh } from './common.js';

const TRAIL_SIZE = 1000; // Increased buffer size for richer trails

export function createSparkleTrail() {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(TRAIL_SIZE * 3);
    const birthTimes = new Float32Array(TRAIL_SIZE);
    const lifeSpans = new Float32Array(TRAIL_SIZE);

    // Fill with initial data to avoid empty buffer issues
    birthTimes.fill(-1000);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('birthTime', new THREE.BufferAttribute(birthTimes, 1));
    geo.setAttribute('lifeSpan', new THREE.BufferAttribute(lifeSpans, 1));

    // Material
    const mat = new PointsNodeMaterial({
        size: 0.4, // Slightly larger base size
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const birthTime = attribute('birthTime');
    const lifeSpan = attribute('lifeSpan');

    const age = uTime.sub(birthTime);
    const lifeProgress = age.div(lifeSpan); // 0.0 to 1.0 (clamped by lifespan usually)

    // --- TSL PHYSICS (Juice) ---
    // 1. Drift Upwards (Magic Dust rises)
    const driftUp = vec3(0.0, age.mul(1.5), 0.0);

    // 2. Swirl Effect (Spiral out as they rise)
    const swirlFreq = float(5.0);
    const swirlAmp = age.mul(0.2); // Expands over time
    const swirl = vec3(
        sin(age.mul(swirlFreq)).mul(swirlAmp),
        float(0.0),
        cos(age.mul(swirlFreq)).mul(swirlAmp)
    );

    // Apply displacement to the base position
    mat.positionNode = positionLocal.add(driftUp).add(swirl);

    // --- VISUALS ---

    // Opacity: Fade in quickly, fade out smoothly
    // smoothstep(0, 0.1, p) * (1 - smoothstep(0.4, 1, p))
    // We let them fade out earlier (at 0.4 progress) to avoid hard pops if lifespan varies
    const fadeIn = smoothstep(0.0, 0.1, lifeProgress);
    const fadeOut = float(1.0).sub(smoothstep(0.4, 1.0, lifeProgress));
    const opacity = fadeIn.mul(fadeOut);

    // Audio Reactivity: Pulse size with High Frequencies (Hi-hats/Magic)
    // Base 1.0 + Audio Boost
    const audioScale = float(1.0).add(uAudioHigh.mul(2.0));

    // Size: Shrink over time, scale by Audio
    const sizeNode = float(0.4).mul(float(1.0).sub(lifeProgress)).mul(audioScale);
    mat.sizeNode = sizeNode;

    // Color: Cycle Gold -> Pink -> Cyan based on age
    // We can use age or lifeProgress.
    // Gold: 0xFFD700
    // Pink: 0xFF69B4
    // Cyan: 0x00FFFF

    const colorGold = color(0xFFD700);
    const colorPink = color(0xFF69B4);
    const colorCyan = color(0x00FFFF);

    // Mix 1: Gold -> Pink (First half)
    const mix1 = mix(colorGold, colorPink, smoothstep(0.0, 0.5, lifeProgress));
    // Mix 2: Result -> Cyan (Second half)
    const finalColor = mix(mix1, colorCyan, smoothstep(0.5, 1.0, lifeProgress));

    // Twinkle: High frequency sine flicker
    const twinkle = sin(age.mul(30.0)).mul(0.5).add(0.5);

    // Emission Boost
    mat.colorNode = finalColor.mul(twinkle.add(0.5)).mul(3.0);
    mat.opacityNode = opacity;

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;

    // Custom data for JS update loop
    points.userData.head = 0;
    points.userData.isSparkleTrail = true;
    points.userData.bufferSize = TRAIL_SIZE;

    return points;
}

const _offset = new THREE.Vector3();

export function updateSparkleTrail(trail, playerPos, playerVel, time) {
    if (!trail || !trail.userData.isSparkleTrail) return;

    const speed = playerVel.length();
    // Only spawn if moving fast (run speed is ~15.0, sneak is 5.0)
    if (speed < 8.0) return;

    // Scale particle count by speed
    // More particles for better trails
    const count = Math.min(Math.floor(speed / 2.0), 20);

    const positions = trail.geometry.attributes.position;
    const birthTimes = trail.geometry.attributes.birthTime;
    const lifeSpans = trail.geometry.attributes.lifeSpan;

    const size = trail.userData.bufferSize;
    let currentHead = trail.userData.head;

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
        lifeSpans.setX(currentHead, 0.8 + Math.random() * 0.6); // Longer life (0.8s - 1.4s)

        currentHead = (currentHead + 1) % size;
    }

    trail.userData.head = currentHead;

    positions.needsUpdate = true;
    birthTimes.needsUpdate = true;
    lifeSpans.needsUpdate = true;
}
