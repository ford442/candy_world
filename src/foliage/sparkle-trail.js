import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, color, vec3, smoothstep, sin } from 'three/tsl';
import { uTime } from './common.js';

const TRAIL_SIZE = 500;

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
        size: 0.3,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const birthTime = attribute('birthTime');
    const lifeSpan = attribute('lifeSpan');

    const age = uTime.sub(birthTime);
    const lifeProgress = age.div(lifeSpan);

    // Opacity: Fade in quickly, fade out slowly
    // Logic: smoothstep(0, 0.2, p) * (1.0 - smoothstep(0.5, 1.0, p))
    // We use float(1.0).sub(...) for 1 - x
    const opacity = smoothstep(0.0, 0.2, lifeProgress).mul(float(1.0).sub(smoothstep(0.5, 1.0, lifeProgress)));

    // Size: Shrink over time
    // Logic: 0.3 * (1.0 - lifeProgress)
    const sizeNode = float(0.3).mul(float(1.0).sub(lifeProgress));
    mat.sizeNode = sizeNode;

    // Color: Cycle or Random?
    // Let's use a nice gold/purple gradient that twinkles
    const colorA = color(0xFFD700); // Gold
    const colorB = color(0xFF00FF); // Magenta
    const twinkle = sin(age.mul(20.0)).mul(0.5).add(0.5);

    // Boost emission by multiplying color
    mat.colorNode = mix(colorA, colorB, twinkle).mul(2.0);
    mat.opacityNode = opacity;

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false; // Always render as it moves with player

    // Custom data for JS update loop
    points.userData.head = 0;
    points.userData.isSparkleTrail = true;

    return points;
}

const _offset = new THREE.Vector3();

export function updateSparkleTrail(trail, playerPos, playerVel, time) {
    if (!trail || !trail.userData.isSparkleTrail) return;

    const speed = playerVel.length();
    // Only spawn if moving fast (run speed is ~15.0, sneak is 5.0)
    // Threshold 8.0 means normal running triggers it, sneaking doesn't.
    if (speed < 8.0) return;

    // Scale particle count by speed (more speed = more particles)
    const count = Math.min(Math.floor(speed / 3.0), 10);

    const positions = trail.geometry.attributes.position;
    const birthTimes = trail.geometry.attributes.birthTime;
    const lifeSpans = trail.geometry.attributes.lifeSpan;

    const head = trail.userData.head;
    let currentHead = head;

    for (let i = 0; i < count; i++) {
        // Random offset behind player (opposite to velocity would be better but random is okay for cloud)
        _offset.set(
            (Math.random() - 0.5) * 0.8,
            0.1 + Math.random() * 0.8,
            (Math.random() - 0.5) * 0.8
        );

        positions.setXYZ(currentHead,
            playerPos.x + _offset.x,
            playerPos.y + _offset.y,
            playerPos.z + _offset.z
        );

        birthTimes.setX(currentHead, time);
        lifeSpans.setX(currentHead, 0.4 + Math.random() * 0.4); // 0.4s to 0.8s life

        currentHead = (currentHead + 1) % TRAIL_SIZE;
    }

    trail.userData.head = currentHead;

    positions.needsUpdate = true;
    birthTimes.needsUpdate = true;
    lifeSpans.needsUpdate = true;
}
