// src/foliage/fireflies.js

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, sin, time, mix, color, float } from 'three/tsl';
import { updateParticles } from '../utils/wasm-loader.js';

export function createFireflies(count = 80, areaSize = 100) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3); // NEW
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * areaSize;
        positions[i * 3 + 1] = 0.5 + Math.random() * 4;
        positions[i * 3 + 2] = (Math.random() - 0.5) * areaSize;

        // Dummy Normals
        normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0;

        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.5 + Math.random() * 1.5;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); // NEW
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
    const blink = sin(time.mul(speedAttr).add(phaseAttr));

    const glowIntensity = blink.sub(float(0.7)).max(float(0.0)).mul(float(3.33));

    const fireflyColor = mix(
        color(0x88FF00),
        color(0xFFFF00),
        glowIntensity
    );

    mat.colorNode = fireflyColor.mul(glowIntensity.add(float(0.1)));
    mat.opacityNode = glowIntensity.add(float(0.05)).min(float(1.0));

    const fireflies = new THREE.Points(geo, mat);
    fireflies.userData.isFireflies = true;
    fireflies.visible = false;

    return fireflies;
}

export function updateFireflies(fireflies, time, delta) {
    if (!fireflies || !fireflies.visible) return;

    const positions = fireflies.geometry.attributes.position.array;
    const phases = fireflies.geometry.attributes.phase.array;
    const count = positions.length / 3;

    // Use WASM-optimized particle update
    updateParticles(positions, phases, count, time, 100);

    fireflies.geometry.attributes.position.needsUpdate = true;
}
