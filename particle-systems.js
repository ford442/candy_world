// filepath: g:\github\candy_world\particle-systems.js
import * as THREE from 'three';
import { color, vec3, vec4, attribute, uniform, time, positionLocal, mix, sin, cos, length as lengthNode } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';

/**
 * Advanced GPU Particle Systems for Candy World
 * Uses TSL for shader-based particle animation
 */

// --- Shimmer Particles (Floating Sparkles) ---
export function createShimmerParticles(count = 500, bounds = { x: 50, y: 20, z: 50 }) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * bounds.x;
        positions[i * 3 + 1] = Math.random() * bounds.y + 2;
        positions[i * 3 + 2] = (Math.random() - 0.5) * bounds.z;

        sizes[i] = Math.random() * 0.2 + 0.1;
        offsets[i] = Math.random() * 100;

        // Pastel colors
        const hue = Math.random();
        colors[i * 3] = 0.7 + Math.random() * 0.3;
        colors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
        colors[i * 3 + 2] = 0.7 + Math.random() * 0.3;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    // TSL Animation
    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');
    const aColor = attribute('color', 'vec3');

    // Float animation
    const floatY = time.mul(0.3).add(aOffset).sin().mul(2.0);
    const driftX = time.mul(0.1).add(aOffset.mul(0.1)).sin().mul(0.5);
    const driftZ = time.mul(0.15).add(aOffset.mul(0.15)).cos().mul(0.5);

    const pos = positionLocal;
    material.positionNode = vec3(
        pos.x.add(driftX),
        pos.y.add(floatY),
        pos.z.add(driftZ)
    );

    // Twinkle effect
    const twinkle = time.mul(3.0).add(aOffset).sin().mul(0.5).add(0.5);
    material.sizeNode = aSize.mul(twinkle.add(0.3));

    // Color with sparkle
    const sparkle = time.mul(5.0).add(aOffset.mul(2.0)).sin().mul(0.3).add(0.7);
    material.colorNode = vec4(aColor.mul(sparkle), twinkle);

    const particles = new THREE.Points(geometry, material);
    particles.userData.type = 'shimmer';

    return particles;
}

// --- Bubble Stream Particles ---
export function createBubbleStream(position, count = 100) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        // Start at source position
        positions[i * 3] = position.x + (Math.random() - 0.5) * 0.5;
        positions[i * 3 + 1] = position.y;
        positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;

        sizes[i] = Math.random() * 0.3 + 0.2;
        offsets[i] = Math.random() * 10;

        // Upward velocity with slight random drift
        velocities[i * 3] = (Math.random() - 0.5) * 0.2;
        velocities[i * 3 + 1] = 1.0 + Math.random() * 0.5;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const material = new PointsNodeMaterial({
        transparent: true,
        opacity: 0.6,
        blending: THREE.NormalBlending,
        depthWrite: false
    });

    // TSL Animation
    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');
    const aVelocity = attribute('velocity', 'vec3');

    // Rising bubbles with wobble
    const riseHeight = time.mul(aVelocity.y).add(aOffset);
    const wobbleX = time.mul(2.0).add(aOffset).sin().mul(0.3);
    const wobbleZ = time.mul(2.5).add(aOffset).cos().mul(0.3);

    const pos = positionLocal;
    const newY = pos.y.add(riseHeight).mod(15.0); // Reset after rising 15 units

    material.positionNode = vec3(
        pos.x.add(wobbleX),
        newY,
        pos.z.add(wobbleZ)
    );

    // Size grows as bubble rises
    const growFactor = newY.div(15.0).mul(0.5).add(1.0);
    material.sizeNode = aSize.mul(growFactor);

    // Color: iridescent bubble effect
    const iridescence = time.add(aOffset).mul(0.5).sin();
    const bubbleColor = mix(
        color(0xADD8E6), // Light blue
        color(0xE6E6FA), // Lavender
        iridescence.mul(0.5).add(0.5)
    );
    material.colorNode = bubbleColor;

    const particles = new THREE.Points(geometry, material);
    particles.userData.type = 'bubbles';
    particles.position.copy(position);

    return particles;
}

// --- Pollen Cloud Particles ---
export function createPollenCloud(position, count = 200, pollenColor = 0xFFD700) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);

    const radius = 2.0;
    for (let i = 0; i < count; i++) {
        // Random positions in sphere
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = Math.random() * radius;

        positions[i * 3] = position.x + r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = position.y + r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = position.z + r * Math.cos(phi);

        sizes[i] = Math.random() * 0.15 + 0.05;
        offsets[i] = Math.random() * 100;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));

    const material = new PointsNodeMaterial({
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    // TSL Animation
    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');

    // Swirl motion around flower
    const swirl = time.mul(0.5).add(aOffset);
    const swirlRadius = time.mul(0.1).sin().mul(0.5).add(radius);

    const pos = positionLocal;
    const centerX = pos.x.sub(position.x);
    const centerZ = pos.z.sub(position.z);

    const rotatedX = centerX.mul(cos(swirl)).sub(centerZ.mul(sin(swirl)));
    const rotatedZ = centerX.mul(sin(swirl)).add(centerZ.mul(cos(swirl)));

    const floatY = time.mul(0.2).add(aOffset).sin().mul(0.5);

    material.positionNode = vec3(
        rotatedX.add(position.x),
        pos.y.add(floatY),
        rotatedZ.add(position.z)
    );

    // Pulsing size
    const pulse = time.mul(2.0).add(aOffset).sin().mul(0.3).add(0.7);
    material.sizeNode = aSize.mul(pulse);

    material.colorNode = color(pollenColor);

    const particles = new THREE.Points(geometry, material);
    particles.userData.type = 'pollen';
    particles.position.copy(position);

    return particles;
}

// --- Leaf Confetti Particles ---
export function createLeafConfetti(position, count = 150, leafColor = 0xFF69B4) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    const rotations = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        // Start above and spread out
        positions[i * 3] = position.x + (Math.random() - 0.5) * 5;
        positions[i * 3 + 1] = position.y + Math.random() * 10;
        positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 5;

        sizes[i] = Math.random() * 0.4 + 0.2;
        offsets[i] = Math.random() * 100;
        rotations[i] = Math.random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    geometry.setAttribute('rotation', new THREE.BufferAttribute(rotations, 1));

    const material = new PointsNodeMaterial({
        transparent: true,
        opacity: 0.8,
        blending: THREE.NormalBlending,
        depthWrite: false
    });

    // TSL Animation
    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');
    const aRotation = attribute('rotation', 'float');

    // Falling with wind drift
    const fall = time.mul(2.0).add(aOffset);
    const windX = time.mul(0.5).add(aOffset).sin().mul(2.0);
    const windZ = time.mul(0.7).add(aOffset).cos().mul(2.0);
    const tumbleRotation = fall.mul(3.0).add(aRotation);

    const pos = positionLocal;
    const newY = pos.y.sub(fall).mod(15.0).add(position.y - 5); // Loop falling

    material.positionNode = vec3(
        pos.x.add(windX),
        newY,
        pos.z.add(windZ)
    );

    // Tumbling size effect
    const tumble = tumbleRotation.sin().abs();
    material.sizeNode = aSize.mul(tumble.mul(0.5).add(0.5));

    // Color variation
    const colorShift = aOffset.mul(0.1).sin().mul(0.2).add(1.0);
    material.colorNode = color(leafColor).mul(colorShift);

    const particles = new THREE.Points(geometry, material);
    particles.userData.type = 'confetti';
    particles.position.copy(position);

    return particles;
}

// --- Audio-Reactive Pulse Ring ---
export const uPulseStrength = uniform(0.0);
export const uPulseColor = uniform(color(0xFFFFFF));

export function createPulseRing(position) {
    const geometry = new THREE.BufferGeometry();
    const count = 60;
    const positions = new Float32Array(count * 3);
    const angles = new Float32Array(count);

    const radius = 5.0;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = 0.1;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        angles[i] = angle;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('angle', new THREE.BufferAttribute(angles, 1));

    const material = new PointsNodeMaterial({
        size: 0.5,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    // TSL Animation
    const aAngle = attribute('angle', 'float');

    // Expanding ring on pulse
    const expansion = time.mul(2.0).mod(3.0);
    const fadeOut = expansion.div(3.0).oneMinus();

    const pos = positionLocal;
    const expandedRadius = expansion.mul(3.0).add(5.0);

    material.positionNode = vec3(
        cos(aAngle).mul(expandedRadius),
        pos.y.add(expansion.mul(0.5)),
        sin(aAngle).mul(expandedRadius)
    );

    // Size and opacity fade with expansion
    material.sizeNode = uPulseStrength.mul(2.0).mul(fadeOut).add(0.3);

    const finalColor = mix(color(0xFFFFFF), uPulseColor, uPulseStrength);
    material.colorNode = vec4(finalColor, fadeOut.mul(uPulseStrength));

    const particles = new THREE.Points(geometry, material);
    particles.userData.type = 'pulseRing';
    particles.position.copy(position);

    return particles;
}

// Helper: Add multiple particle systems to scene
export function addAmbientParticles(scene, bounds = { x: 100, y: 30, z: 100 }) {
    const systems = [];

    // Add shimmer particles
    const shimmer = createShimmerParticles(1000, bounds);
    scene.add(shimmer);
    systems.push(shimmer);

    return systems;
}
