// src/foliage/fireflies.js

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, sin, cos, mix, color, positionLocal, vec3 } from 'three/tsl';
import { uTime } from './common.js';

export function createFireflies(count = 80, areaSize = 100) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * areaSize;
        positions[i * 3 + 1] = 0.5 + Math.random() * 4;
        positions[i * 3 + 2] = (Math.random() - 0.5) * areaSize;

        // Dummy Normals (required for some TSL nodes)
        normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0;

        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.5 + Math.random() * 1.5;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));

    const mat = new PointsNodeMaterial({
        size: 0.2,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const phaseAttr = attribute('phase');
    const speedAttr = attribute('speed');

    // ⚡ OPTIMIZATION: Moved animation from CPU (JS) to GPU (TSL)
    // Replicates the "sway" behavior with approximate amplitude
    // Old JS: integrated sin(t) -> approx 4.0 amplitude at 60fps

    // Sway X
    const driftX = sin(uTime.mul(0.3).add(phaseAttr)).mul(4.0);
    // Sway Y (smaller, avoid hitting ground)
    const driftY = cos(uTime.mul(0.5).add(phaseAttr.mul(1.3))).mul(1.0);
    // Sway Z
    const driftZ = sin(uTime.mul(0.4).add(phaseAttr.mul(0.7))).mul(4.0);

    const animatedPos = positionLocal.add(vec3(driftX, driftY, driftZ));

    // Y-Constraint: Keep above ground (approximate soft floor at 0.3)
    // We can't use 'if' easily, so we use max()
    const constrainedY = animatedPos.y.max(0.3).min(6.0);

    mat.positionNode = vec3(animatedPos.x, constrainedY, animatedPos.z);

    // Blink Logic
    const blink = sin(uTime.mul(speedAttr).add(phaseAttr));
    const glowIntensity = blink.sub(0.7).max(0.0).mul(3.33);

    const fireflyColor = mix(
        color(0x88FF00),
        color(0xFFFF00),
        glowIntensity
    );

    mat.colorNode = fireflyColor.mul(glowIntensity.add(0.1));
    mat.opacityNode = glowIntensity.add(0.05).min(1.0);

    const fireflies = new THREE.Points(geo, mat);
    fireflies.userData.isFireflies = true;
    fireflies.visible = false;

    return fireflies;
}

// ⚡ OPTIMIZATION: Logic moved to TSL shader. Function retained for API compatibility.
export function updateFireflies(fireflies, time, delta) {
    // No-op: Animation is now handled entirely on GPU
}
