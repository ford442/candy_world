import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, color } from 'three/tsl';
import { uAudioHigh, createJuicyRimLight, CandyPresets } from '../foliage/common.ts';

// Reusable scratch variables to avoid GC
const _scratchVec = new THREE.Vector3();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);

export function createHarpoonLine(): THREE.Mesh {
    // Thin cylinder for the harpoon line
    const geometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 8);

    // Rotate so it aligns with Z axis (useful for lookAt)
    geometry.rotateX(Math.PI / 2);

    // Using MeshStandardNodeMaterial for TSL integration and consistency
    const material = new MeshStandardNodeMaterial({
        color: 0x44AAFF,
        roughness: 0.2,
        metalness: 0.8,
        transparent: true,
        opacity: 0.8
    });

    // Emissive node driven by audio for a pulsing energy feel
    const baseColor = color(0x44AAFF);
    const glowColor = color(0xFFFFFF);
    // Pulse based on audio high
    const pulseIntensity = uAudioHigh.mul(float(2.0));

    // Combine base glow, pulse, and rim light
    material.emissiveNode = baseColor.mul(pulseIntensity).add(
        createJuicyRimLight(glowColor, float(1.0), float(3.0), null)
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false; // Hidden by default
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    // Disable frustum culling since it's a dynamic line that might stretch across screen
    mesh.frustumCulled = false;

    return mesh;
}

export function updateHarpoonLine(
    line: THREE.Mesh,
    playerPos: THREE.Vector3,
    anchor: THREE.Vector3,
    active: boolean
) {
    if (!active) {
        line.visible = false;
        return;
    }

    line.visible = true;

    // Calculate distance and midpoint
    const distance = playerPos.distanceTo(anchor);

    // Start slightly below player center for visual alignment
    _scratchPos.copy(playerPos);
    _scratchPos.y -= 0.5;

    // Midpoint
    _scratchVec.addVectors(_scratchPos, anchor).multiplyScalar(0.5);
    line.position.copy(_scratchVec);

    // Look at anchor
    line.lookAt(anchor);

    // Scale Z to distance
    line.scale.set(1, 1, distance);
}
