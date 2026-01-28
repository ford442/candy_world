import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, color, vec3, smoothstep, sin, positionLocal, pointUV, length, exp } from 'three/tsl';
import { uTime, uAudioHigh } from './common.ts';

const MAX_PARTICLES = 1500;
let _impactMesh = null;
let _head = 0;

const IMPACT_CONFIG = {
    jump: { count: 20 },
    land: { count: 40 },
    dash: { count: 30 },
    berry: { count: 15 },
    snare: { count: 25 }
};

export function createImpactSystem() {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const velocities = new Float32Array(MAX_PARTICLES * 3);
    const birthTimes = new Float32Array(MAX_PARTICLES);
    const lifeSpans = new Float32Array(MAX_PARTICLES);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);

    birthTimes.fill(-1000);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('birthTime', new THREE.BufferAttribute(birthTimes, 1));
    geo.setAttribute('lifeSpan', new THREE.BufferAttribute(lifeSpans, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new PointsNodeMaterial({
        size: 1.0,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    // TSL Logic
    const birthTime = attribute('birthTime');
    const lifeSpanAttr = attribute('lifeSpan');
    const velocity = attribute('velocity');
    const colorAttr = attribute('color');
    const sizeAttr = attribute('size');

    // Calculate Age
    const age = uTime.sub(birthTime);
    const lifeProgress = age.div(lifeSpanAttr);

    // Is Alive? (0.0 to 1.0)
    const isAlive = lifeProgress.greaterThan(0.0).and(lifeProgress.lessThan(1.0));

    // Explosive Drag Physics
    const drag = float(2.0);
    // Integral of v*exp(-drag*t) -> (v/drag)*(1 - exp(-drag*t))
    const explosiveDist = velocity.mul(float(1.0).sub(exp(age.mul(drag).negate()))).div(drag);

    // Gravity: standard 0.5 * g * t^2
    const gravity = vec3(0.0, -10.0, 0.0);
    const gravityDrop = gravity.mul(age.mul(age).mul(0.5));

    const movement = explosiveDist.add(gravityDrop);

    // Position
    mat.positionNode = positionLocal.add(movement);

    // Shape: Soft Circle (Juice)
    const dist = length(pointUV.sub(0.5));
    const circle = float(1.0).sub(smoothstep(0.3, 0.5, dist));

    // Opacity: Fade out linearly or with a curve
    const opacity = float(1.0).sub(smoothstep(0.0, 1.0, lifeProgress));
    mat.opacityNode = opacity.mul(isAlive).mul(circle);

    // Shimmer (Audio Reactivity)
    const shimmer = sin(age.mul(20.0).add(uAudioHigh.mul(10.0))).mul(0.2).add(1.0);

    // Color
    mat.colorNode = colorAttr.mul(shimmer);

    // Size: Shrink over time
    mat.sizeNode = sizeAttr.mul(float(1.0).sub(lifeProgress));

    _impactMesh = new THREE.Points(geo, mat);
    _impactMesh.frustumCulled = false;
    _impactMesh.userData.isImpactSystem = true;

    return _impactMesh;
}

export function spawnImpact(pos, type = 'jump') {
    if (!_impactMesh) return;

    const geo = _impactMesh.geometry;
    const posAttr = geo.attributes.position;
    const velAttr = geo.attributes.velocity;
    const birthAttr = geo.attributes.birthTime;
    const lifeAttr = geo.attributes.lifeSpan;
    const colAttr = geo.attributes.color;
    const sizeAttr = geo.attributes.size;

    const config = IMPACT_CONFIG[type] || IMPACT_CONFIG.jump;
    const count = config.count;
    const now = uTime.value;

    for (let i = 0; i < count; i++) {
        const idx = _head;
        _head = (_head + 1) % MAX_PARTICLES;

        // Position (Start)
        // Add slight randomness to start position so they don't all come from exact center
        const ox = (Math.random() - 0.5) * 0.5;
        const oy = (Math.random() - 0.5) * 0.2;
        const oz = (Math.random() - 0.5) * 0.5;
        posAttr.setXYZ(idx, pos.x + ox, pos.y + oy, pos.z + oz);

        // Velocity
        let vx, vy, vz;
        if (type === 'jump') {
             // Upward burst
             const theta = Math.random() * Math.PI * 2;
             const r = Math.random() * 1.5;
             vx = Math.cos(theta) * r;
             vy = 2.0 + Math.random() * 3.0;
             vz = Math.sin(theta) * r;
        } else if (type === 'land') {
             // Horizontal spread (Ground slam)
             const theta = Math.random() * Math.PI * 2;
             const r = 3.0 + Math.random() * 4.0;
             vx = Math.cos(theta) * r;
             vy = Math.random() * 2.0; // Mild upward pop
             vz = Math.sin(theta) * r;
        } else if (type === 'dash') {
             // Sphere burst for dash air-pop
             const theta = Math.random() * Math.PI * 2;
             const phi = Math.random() * Math.PI;
             const speed = 2.0 + Math.random() * 5.0;
             vx = Math.sin(phi) * Math.cos(theta) * speed;
             vy = Math.cos(phi) * speed;
             vz = Math.sin(phi) * Math.sin(theta) * speed;
        } else if (type === 'berry') {
             // Small implosion-then-explosion feel (simulated by just explosion for now)
             const theta = Math.random() * Math.PI * 2;
             const phi = Math.random() * Math.PI;
             const speed = 1.0 + Math.random() * 3.0;
             vx = Math.sin(phi) * Math.cos(theta) * speed;
             vy = Math.cos(phi) * speed;
             vz = Math.sin(phi) * Math.sin(theta) * speed;
        } else if (type === 'snare') {
            // Aggressive snap burst
            // Ring shape + Upward spike
            const theta = Math.random() * Math.PI * 2;
            const r = 1.5 + Math.random() * 2.0;
            // Mostly horizontal
            vx = Math.cos(theta) * r;
            vy = 1.0 + Math.random() * 4.0; // Strong upward spike
            vz = Math.sin(theta) * r;
        }

        velAttr.setXYZ(idx, vx, vy, vz);

        // Time
        birthAttr.setX(idx, now);
        lifeAttr.setX(idx, 0.4 + Math.random() * 0.4);

        // Color
        if (type === 'jump') {
            colAttr.setXYZ(idx, 1.0, 0.9, 0.5); // Gold
        } else if (type === 'land') {
            colAttr.setXYZ(idx, 0.9, 0.85, 0.8); // Dust
        } else if (type === 'dash') {
            colAttr.setXYZ(idx, 0.0, 1.0, 1.0); // Cyan
        } else if (type === 'berry') {
            // Juicy Orange/Magenta mix
            if (Math.random() > 0.5) {
                colAttr.setXYZ(idx, 1.0, 0.4, 0.0); // Orange
            } else {
                colAttr.setXYZ(idx, 1.0, 0.0, 0.5); // Red-Pink
            }
        } else if (type === 'snare') {
            // Danger Red/Orange
            colAttr.setXYZ(idx, 1.0, 0.2, 0.0);
        }

        // Size
        sizeAttr.setX(idx, 0.3 + Math.random() * 0.4);
    }

    posAttr.needsUpdate = true;
    velAttr.needsUpdate = true;
    birthAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
}
