// src/foliage/panning-pads.js

import * as THREE from 'three';
import {
    createUnifiedMaterial,
    CandyPresets,
    registerReactiveMaterial,
    attachReactivity,
    sharedGeometries,
    createStandardNodeMaterial
} from './common.js';
import { color, float, mix, uv, distance, vec2, smoothstep, uniform } from 'three/tsl';

export function createPanningPad(options = {}) {
    const {
        radius = 1.0,
        baseColor = 0x2E8B57,
        glowColor = 0x00FFFF
    } = options;

    const group = new THREE.Group();

    // 1. The Pad (Flattened Cylinder)
    // We want a mercury/holographic look.
    // Use OilSlick preset but tweak for "mercury" (high metalness, high smoothness)
    const padMat = createUnifiedMaterial(0xCCCCCC, {
        roughness: 0.1,
        metalness: 0.9,
        iridescenceStrength: 0.8,
        iridescenceFresnelPower: 2.0,
        bumpStrength: 0.05,
        noiseScale: 4.0,
        sheen: 0.5,
        sheenColor: glowColor
    });
    registerReactiveMaterial(padMat);

    const pad = new THREE.Mesh(sharedGeometries.unitCylinder, padMat);
    pad.scale.set(radius, 0.1, radius);
    pad.position.y = 0; // Pivot at bottom
    pad.castShadow = true;
    pad.receiveShadow = true;
    group.add(pad);

    // 2. Radial Glow (Holographic Overlay)
    // Add a slightly larger disc on top with additive blending
    const glowMat = createStandardNodeMaterial({
        color: glowColor,
        roughness: 1.0,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    // TSL Shader logic for radial pulse
    // Distance from center UV (0.5, 0.5)
    const center = vec2(0.5, 0.5);
    const d = distance(uv(), center).mul(2.0); // 0 at center, 1 at edge
    const ring = smoothstep(0.8, 0.9, d).sub(smoothstep(0.9, 1.0, d)); // A ring at edge
    const core = float(1.0).sub(d); // Gradient from center

    // Mix them
    const uGlowOpacity = uniform(0.6); // Default 0.6
    glowMat.opacityNode = core.mul(0.3).add(ring).mul(uGlowOpacity);
    glowMat.emissiveNode = color(glowColor).mul(glowMat.opacityNode);

    const glowDisc = new THREE.Mesh(sharedGeometries.quad, glowMat);
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.y = 0.11; // Just above pad
    glowDisc.scale.set(radius * 2.2, radius * 2.2, 1); // Plane is 1x1, so scale to diameter
    pad.add(glowDisc);

    // Store reference to glow mat for pulsing intensity
    group.userData.glowMaterial = glowMat;
    group.userData.glowUniform = uGlowOpacity;

    // 3. Configuration
    group.userData.type = 'panningPad';
    group.userData.animationType = 'panningBob';
    group.userData.animationOffset = Math.random() * 100;

    // Reactivity: Map to specific channels for stereo effect
    // We will assign left/right bias in the generation step or randomly here
    // For now, let's assume random assignment if not provided
    const panBias = options.panBias !== undefined ? options.panBias : (Math.random() > 0.5 ? -1 : 1);
    group.userData.panBias = panBias; // -1 Left, 1 Right

    // Set reactivity ID: if left, map to channel 0/2; if right, map to 1/3 (simplified heuristic)
    // Or we let MusicReactivitySystem handle it.
    // Actually, `panningBob` animation logic will look at explicit pan values.

    // Attach standard reactivity (color shifts)
    attachReactivity(group, { minLight: 0.0, maxLight: 1.0 });

    return group;
}
