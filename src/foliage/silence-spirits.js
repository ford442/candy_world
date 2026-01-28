// src/foliage/silence-spirits.js

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, mix, sin, cos, positionLocal, positionWorld, vec3, normalWorld,
    mx_noise_float, distance, smoothstep, max, min
} from 'three/tsl';
import {
    sharedGeometries,
    registerReactiveMaterial,
    attachReactivity,
    uTime,
    uPlayerPosition
} from './common.js';

export function createSilenceSpirit(options = {}) {
    const group = new THREE.Group();
    const { scale = 1.0 } = options;

    // PALETTE UPDATE: Ethereal Stardust Material (TSL)
    // Replaces JS-driven opacity animation
    const mat = new MeshStandardNodeMaterial({
        color: 0xEEFFFF,
        transparent: true,
        blending: THREE.AdditiveBlending, // Glowy
        depthWrite: false,
        roughness: 0.2,
        side: THREE.DoubleSide
    });

    // TSL Logic

    // 1. Proximity Dissolve (Flee behavior)
    // Spirit fades away when player approaches (shy/silent)
    const dist = distance(positionWorld, uPlayerPosition);
    // Fully invisible at 3.0 units, fully visible at 8.0 units
    const proximityAlpha = smoothstep(3.0, 8.0, dist);

    // 2. Stardust Noise (Internal motion)
    // Flowing noise texture
    const noiseScale = float(3.0);
    const flowSpeed = vec3(0.0, uTime.mul(0.4), 0.0); // Rising spirit
    const noisePos = positionLocal.mul(noiseScale).sub(flowSpeed);
    const stardust = mx_noise_float(noisePos); // -1 to 1

    // Remap noise to soft clouds (0.2 to 0.8)
    const cloudDensity = stardust.mul(0.3).add(0.5);

    // 3. Pulse (Heartbeat of silence)
    const pulse = sin(uTime.mul(1.5)).mul(0.1).add(0.9);

    // Combine Alpha
    const alpha = cloudDensity.mul(proximityAlpha).mul(pulse).mul(0.8);

    mat.opacityNode = alpha;

    // Emissive Glow
    // Blue-ish core, White edges
    const glowColor = color(0x88CCFF);
    mat.emissiveNode = glowColor.mul(alpha).mul(2.0); // Bright glow
    mat.colorNode = color(0xEEFFFF);

    // 1. Ghost Body
    const bodyGeo = new THREE.CapsuleGeometry(0.3 * scale, 1.0 * scale, 4, 8);
    bodyGeo.translate(0, 0.8 * scale, 0);
    // Ensure UVs/Normals for TSL (Capsule usually has them)

    const body = new THREE.Mesh(bodyGeo, mat);
    group.add(body);

    // Antlers / Head (Same material, visual unity)
    const headGeo = new THREE.SphereGeometry(0.25 * scale, 8, 8);
    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 1.4 * scale;
    body.add(head);

    // 2. State
    group.userData.type = 'silenceSpirit';
    // Removed 'spiritFade' animationType as logic is now in TSL
    group.userData.isVisible = true;

    // Register for reactivity (maybe for light level checks if needed later)
    // But purely visual fading is now GPU-side.

    return group;
}
