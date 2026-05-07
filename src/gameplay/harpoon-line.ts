import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, color, positionLocal, sin, cos, vec3 } from 'three/tsl';
import { uAudioHigh, createJuicyRimLight, uTime } from '../foliage/material-core.ts';

// Reusable scratch variables to avoid GC
const _scratchVec = new THREE.Vector3();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);

export function createHarpoonLine(): THREE.Mesh {
    // Thin cylinder for the harpoon line, many segments to allow smooth deformation
    const geometry = new THREE.CylinderGeometry(0.05, 0.05, 1, 8, 32);

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

    // --- PALETTE UPGRADE: TSL Audio Waveform Deformation ---

    // 1. Calculate envelope (0 at ends, 1 in middle)
    // The geometry was rotated X by 90 deg, so the length is now along the local Z axis.
    // Z goes from -0.5 to 0.5. Map to [0, 1] then use sin(pi * x) for a smooth curve.
    const normalizedZ = positionLocal.z.add(0.5);
    const envelope = sin(normalizedZ.mul(Math.PI));

    // 2. Sine Wave (Audio reactive frequency and amplitude)
    // Higher audio makes the wave faster and taller
    const waveFreq = float(20.0).add(uAudioHigh.mul(10.0));
    const waveSpeed = uTime.mul(float(15.0));

    // 3. Wiggle displacement on X and Y axes (perpendicular to Z)
    // We create a spiral/wave effect using sine and cosine along the length (Z axis).
    const phase = positionLocal.z.mul(waveFreq).sub(waveSpeed);

    // Amplitude reacts to music highs, smoothed out
    const baseAmp = float(0.2);
    const audioAmp = uAudioHigh.mul(0.6);
    const amplitude = baseAmp.add(audioAmp).mul(envelope);

    const deformX = sin(phase).mul(amplitude);
    const deformY = cos(phase).mul(amplitude);

    // Apply deformation (displace X and Y, leave Z alone)
    material.positionNode = positionLocal.add(vec3(deformX, deformY, 0));

    // Emissive node driven by audio for a pulsing energy feel
    const baseColor = color(0x44AAFF);
    const glowColor = color(0xFFFFFF);

    // 🎨 PALETTE: Make it pulse intensely with the music
    const pulseIntensity = float(1.0).add(uAudioHigh.mul(float(3.0)));

    // Combine base glow, pulse, and rim light
    material.emissiveNode = baseColor.mul(pulseIntensity).add(
        createJuicyRimLight(glowColor, float(1.5), float(3.0), null)
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
    // ⚡ OPTIMIZATION: Avoid .distanceTo() to prevent intermediate allocations.
    const distance = Math.sqrt(playerPos.distanceToSquared(anchor));

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
