import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    attribute, float, mix, color, vec3, smoothstep, sin, positionLocal,
    exp, rotate, normalize, time, vec4
} from 'three/tsl';
import { uTime, uAudioHigh } from './common.ts';

const MAX_PARTICLES = 4000; // Increased capacity for juice
let _impactMesh = null;
let _head = 0;

const IMPACT_CONFIG = {
    jump: { count: 20 },
    land: { count: 40 },
    dash: { count: 30 },
    berry: { count: 15 },
    snare: { count: 25 },
    mist: { count: 20 },
    rain: { count: 30 },
    trail: { count: 1 },
    muzzle: { count: 10 },
    spore: { count: 12 }
};

export function createImpactSystem() {
    // 1. Geometry: "Candy Crumb" (Low Poly Sphere)
    // Icosahedron with detail 0 = 20 faces. Perfect for crunchy particles.
    const geometry = new THREE.IcosahedronGeometry(0.15, 0);

    // 2. Instanced Attributes
    const spawnPositions = new Float32Array(MAX_PARTICLES * 3);
    const velocities = new Float32Array(MAX_PARTICLES * 3);
    const birthTimes = new Float32Array(MAX_PARTICLES);
    const lifeSpans = new Float32Array(MAX_PARTICLES);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    const rotationAxes = new Float32Array(MAX_PARTICLES * 3);
    const gravityScales = new Float32Array(MAX_PARTICLES);

    birthTimes.fill(-1000);

    // Register Instanced Attributes
    geometry.setAttribute('spawnPosition', new THREE.InstancedBufferAttribute(spawnPositions, 3));
    geometry.setAttribute('velocity', new THREE.InstancedBufferAttribute(velocities, 3));
    geometry.setAttribute('birthTime', new THREE.InstancedBufferAttribute(birthTimes, 1));
    geometry.setAttribute('lifeSpan', new THREE.InstancedBufferAttribute(lifeSpans, 1));
    geometry.setAttribute('color', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.InstancedBufferAttribute(sizes, 1));
    geometry.setAttribute('rotationAxis', new THREE.InstancedBufferAttribute(rotationAxes, 3));
    geometry.setAttribute('gravityScale', new THREE.InstancedBufferAttribute(gravityScales, 1));

    // 3. Material (TSL)
    const mat = new MeshStandardNodeMaterial({
        color: 0xFFFFFF,
        roughness: 0.4,
        metalness: 0.1,
        transparent: true,
        depthWrite: false, // Particles don't occlude
        // blending: THREE.AdditiveBlending // Additive is nice for glow, but Normal is better for "Chunks"
    });

    // --- TSL LOGIC ---
    const spawnPos = attribute('spawnPosition', 'vec3');
    const velocity = attribute('velocity', 'vec3');
    const birthTime = attribute('birthTime', 'float');
    const lifeSpan = attribute('lifeSpan', 'float');
    const colorAttr = attribute('color', 'vec3');
    const sizeAttr = attribute('size', 'float');
    const rotAxis = attribute('rotationAxis', 'vec3');
    const gravityScale = attribute('gravityScale', 'float');

    // Age & Progress
    const age = uTime.sub(birthTime);
    const lifeProgress = age.div(lifeSpan);
    const isAlive = lifeProgress.greaterThan(0.0).and(lifeProgress.lessThan(1.0));

    // 1. Physics: Explosive Drag + Gravity
    const drag = float(2.0);
    // Integral of v*exp(-drag*t)
    const explosiveDist = velocity.mul(float(1.0).sub(exp(age.mul(drag).negate()))).div(drag);

    const gravity = vec3(0.0, -12.0, 0.0); // Slightly heavier gravity for chunks
    const gravityDrop = gravity.mul(gravityScale).mul(age.mul(age).mul(0.5));

    const particleWorldPos = spawnPos.add(explosiveDist).add(gravityDrop);

    // 2. Rotation (Spin)
    // Rotate vertices around the random axis based on speed and time
    // Spin slows down as drag kicks in? Or just constant tumble.
    // Let's do constant tumble for fun.
    const spinSpeed = float(10.0);
    const rotationAngle = age.mul(spinSpeed);
    const rotatedLocal = rotate(positionLocal, normalize(rotAxis), rotationAngle);

    // 3. Scaling (Pop in, Shrink out)
    // Pop in very fast, then linear shrink
    const scale = sizeAttr.mul(float(1.0).sub(lifeProgress));
    // Apply scale to rotated local vertex
    const scaledLocal = rotatedLocal.mul(scale);

    // Final Position Node
    // Move the instance to world position + local offset
    mat.positionNode = particleWorldPos.add(scaledLocal);

    // 4. Color & Juice
    // Audio Shimmer
    const shimmer = sin(age.mul(20.0).add(uAudioHigh.mul(10.0))).mul(0.2).add(1.0);

    // Fade Out
    const opacity = float(1.0).sub(smoothstep(0.7, 1.0, lifeProgress));

    mat.colorNode = colorAttr.mul(shimmer);
    mat.opacityNode = opacity.mul(isAlive); // .mul(0.0) if dead? TSL handles transparent clip usually?
    // Actually if opacity is 0, it's invisible.

    // 5. Mesh Creation
    _impactMesh = new THREE.InstancedMesh(geometry, mat, MAX_PARTICLES);
    _impactMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // Standard requirement, though we don't update it
    _impactMesh.count = MAX_PARTICLES; // We draw all, relying on isAlive/opacity to hide unused
    _impactMesh.castShadow = false;
    _impactMesh.receiveShadow = false;
    _impactMesh.frustumCulled = false; // Always update
    _impactMesh.userData.isImpactSystem = true;

    return _impactMesh;
}

export function spawnImpact(pos, type = 'jump', options = {}) {
    if (!_impactMesh) return;

    const geo = _impactMesh.geometry;
    const spawnAttr = geo.attributes.spawnPosition;
    const velAttr = geo.attributes.velocity;
    const birthAttr = geo.attributes.birthTime;
    const lifeAttr = geo.attributes.lifeSpan;
    const colAttr = geo.attributes.color;
    const sizeAttr = geo.attributes.size;
    const rotAttr = geo.attributes.rotationAxis;
    const gravAttr = geo.attributes.gravityScale;

    const config = IMPACT_CONFIG[type] || IMPACT_CONFIG.jump;
    const count = config.count;
    const now = (uTime.value !== undefined) ? uTime.value : performance.now() / 1000;

    const colorOverride = options.color;
    const direction = options.direction;

    for (let i = 0; i < count; i++) {
        const idx = _head;
        _head = (_head + 1) % MAX_PARTICLES;

        // Spawn Position (Randomized slightly)
        const ox = (Math.random() - 0.5) * 0.5;
        const oy = (Math.random() - 0.5) * 0.5;
        const oz = (Math.random() - 0.5) * 0.5;
        spawnAttr.setXYZ(idx, pos.x + ox, pos.y + oy, pos.z + oz);

        // Velocity Logic
        let vx, vy, vz;
        let gScale = 1.0;

        if (type === 'jump') {
             const theta = Math.random() * Math.PI * 2;
             const r = Math.random() * 2.0;
             vx = Math.cos(theta) * r;
             vy = 3.0 + Math.random() * 4.0;
             vz = Math.sin(theta) * r;
        } else if (type === 'land') {
             const theta = Math.random() * Math.PI * 2;
             const r = 4.0 + Math.random() * 3.0;
             vx = Math.cos(theta) * r;
             vy = 1.0 + Math.random() * 2.0;
             vz = Math.sin(theta) * r;
        } else if (type === 'dash') {
             const theta = Math.random() * Math.PI * 2;
             const phi = Math.random() * Math.PI;
             const speed = 4.0 + Math.random() * 6.0;
             vx = Math.sin(phi) * Math.cos(theta) * speed;
             vy = Math.cos(phi) * speed;
             vz = Math.sin(phi) * Math.sin(theta) * speed;
        } else if (type === 'berry') {
             // Explosion
             const theta = Math.random() * Math.PI * 2;
             const phi = Math.random() * Math.PI;
             const speed = 2.0 + Math.random() * 4.0;
             vx = Math.sin(phi) * Math.cos(theta) * speed;
             vy = Math.cos(phi) * speed;
             vz = Math.sin(phi) * Math.sin(theta) * speed;
        } else if (type === 'snare') {
            // Ring
            const theta = Math.random() * Math.PI * 2;
            const r = 2.0 + Math.random() * 3.0;
            vx = Math.cos(theta) * r;
            vy = 2.0 + Math.random() * 5.0; // Upward spike
            vz = Math.sin(theta) * r;
        } else if (type === 'mist') {
            // Float up
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * 1.5;
            vx = Math.cos(theta) * r;
            vy = 2.0 + Math.random() * 3.0; // Float up
            vz = Math.sin(theta) * r;
            gScale = -0.5; // Negative gravity (float)
        } else if (type === 'rain') {
            // Fall down fast
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * 1.0;
            vx = Math.cos(theta) * r;
            vy = -5.0 - Math.random() * 5.0; // Slam down
            vz = Math.sin(theta) * r;
            gScale = 2.0; // Heavy gravity
        } else if (type === 'spore') {
            // Floaty, swirl
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * 2.0;
            vx = Math.cos(theta) * r;
            vy = 1.0 + Math.random() * 2.0; // Drift up
            vz = Math.sin(theta) * r;
            gScale = -0.2; // Slight upward float (negative gravity)
        } else if (type === 'trail') {
            // Stationary relative to spawn (drag), floaty
            vx = (Math.random() - 0.5) * 0.5;
            vy = (Math.random() - 0.5) * 0.5;
            vz = (Math.random() - 0.5) * 0.5;
            gScale = 0.0;
        } else if (type === 'muzzle') {
            // Directional or Radial
            if (direction) {
                // Cone spray along direction
                // Add some randomness
                const speed = 10.0 + Math.random() * 5.0;
                const spread = 2.0;
                vx = direction.x * speed + (Math.random() - 0.5) * spread;
                vy = direction.y * speed + (Math.random() - 0.5) * spread;
                vz = direction.z * speed + (Math.random() - 0.5) * spread;
            } else {
                // Radial
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.random() * Math.PI;
                const speed = 5.0 + Math.random() * 5.0;
                vx = Math.sin(phi) * Math.cos(theta) * speed;
                vy = Math.cos(phi) * speed;
                vz = Math.sin(phi) * Math.sin(theta) * speed;
            }
            gScale = 0.5;
        }

        velAttr.setXYZ(idx, vx, vy, vz);
        gravAttr.setX(idx, gScale);

        // Rotation Axis (Random)
        rotAttr.setXYZ(idx, Math.random()-0.5, Math.random()-0.5, Math.random()-0.5);

        // Time
        birthAttr.setX(idx, now);

        // Life
        if (type === 'trail') {
            lifeAttr.setX(idx, 0.3 + Math.random() * 0.2); // Short life
        } else if (type === 'muzzle') {
            lifeAttr.setX(idx, 0.15 + Math.random() * 0.15); // Very short flash
        } else if (type === 'spore') {
            lifeAttr.setX(idx, 1.5 + Math.random() * 1.5); // Long floaty life
        } else {
            lifeAttr.setX(idx, 0.5 + Math.random() * 0.5);
        }

        // Color
        if (colorOverride) {
            colAttr.setXYZ(idx, colorOverride.r, colorOverride.g, colorOverride.b);
        } else if (type === 'jump') {
            colAttr.setXYZ(idx, 1.0, 0.8, 0.2); // Gold
        } else if (type === 'land') {
            colAttr.setXYZ(idx, 0.6, 0.5, 0.4); // Dust
        } else if (type === 'dash') {
            colAttr.setXYZ(idx, 0.0, 1.0, 1.0); // Cyan
        } else if (type === 'berry') {
            // Juice
            if (Math.random() > 0.5) colAttr.setXYZ(idx, 1.0, 0.2, 0.5); // Pink
            else colAttr.setXYZ(idx, 1.0, 0.6, 0.0); // Orange
        } else if (type === 'snare') {
            colAttr.setXYZ(idx, 1.0, 0.1, 0.1); // Red
        } else if (type === 'mist') {
            colAttr.setXYZ(idx, 0.9, 0.9, 1.0); // Pale Blue/White
        } else if (type === 'rain') {
            colAttr.setXYZ(idx, 0.2, 0.2, 1.0); // Deep Blue
        } else if (type === 'spore') {
            // Neon Random
            const rand = Math.random();
            if (rand < 0.33) colAttr.setXYZ(idx, 0.0, 1.0, 1.0); // Cyan
            else if (rand < 0.66) colAttr.setXYZ(idx, 1.0, 0.0, 1.0); // Magenta
            else colAttr.setXYZ(idx, 0.5, 1.0, 0.0); // Lime
        }

        // Size scale (Attribute mult)
        // Icosahedron radius 0.15 is base.
        // We want range 0.5x to 1.5x of that.
        if (type === 'trail') {
            sizeAttr.setX(idx, 0.3 + Math.random() * 0.2); // Small
        } else if (type === 'muzzle') {
            sizeAttr.setX(idx, 0.5 + Math.random() * 0.5); // Medium
        } else if (type === 'spore') {
            sizeAttr.setX(idx, 0.2 + Math.random() * 0.3); // Tiny specks
        } else {
            sizeAttr.setX(idx, 0.5 + Math.random() * 1.0);
        }
    }

    // Flag Updates
    spawnAttr.needsUpdate = true;
    velAttr.needsUpdate = true;
    birthAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    rotAttr.needsUpdate = true;
    gravAttr.needsUpdate = true;
}
