import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, sin, time, mix, color } from 'three/tsl';

export function createFireflies(count = 80, areaSize = 100) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3); // NEW: dummy normals to satisfy TSL NormalNode
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * areaSize;
        positions[i * 3 + 1] = 0.5 + Math.random() * 4;
        positions[i * 3 + 2] = (Math.random() - 0.5) * areaSize;

        // Dummy normal pointing up
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

export function updateFireflies(fireflies, time, delta) {
    if (!fireflies || !fireflies.visible) return;

    const positions = fireflies.geometry.attributes.position.array;
    const phases = fireflies.geometry.attributes.phase.array;

    for (let i = 0; i < positions.length / 3; i++) {
        const idx = i * 3;
        const phase = phases[i];

        const driftX = Math.sin(time * 0.3 + phase) * 0.02;
        const driftY = Math.cos(time * 0.5 + phase * 1.3) * 0.01;
        const driftZ = Math.sin(time * 0.4 + phase * 0.7) * 0.02;

        positions[idx] += driftX;
        positions[idx + 1] += driftY;
        positions[idx + 2] += driftZ;

        if (positions[idx] > 50) positions[idx] = -50;
        if (positions[idx] < -50) positions[idx] = 50;
        if (positions[idx + 1] < 0.3) positions[idx + 1] = 0.3;
        if (positions[idx + 1] > 5) positions[idx + 1] = 5;
        if (positions[idx + 2] > 50) positions[idx + 2] = -50;
        if (positions[idx + 2] < -50) positions[idx + 2] = 50;
    }

    fireflies.geometry.attributes.position.needsUpdate = true;
}
