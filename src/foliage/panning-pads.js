// src/foliage/panning-pads.js

import * as THREE from 'three';
import {
    createUnifiedMaterial,
    CandyPresets,
    registerReactiveMaterial,
    attachReactivity,
    sharedGeometries,
    createStandardNodeMaterial,
    uPlayerPosition,
    uTime
} from './common.ts';
import { spawnImpact } from './impacts.js';
import {
    color, float, mix, uv, distance, vec2, smoothstep, uniform,
    positionLocal, positionWorld, vec3
} from 'three/tsl';

export function createPanningPad(options = {}) {
    const {
        radius = 1.0,
        baseColor = 0x2E8B57,
        glowColor = 0x00FFFF
    } = options;

    const group = new THREE.Group();

    // --- TSL: Player Interaction (Squash) ---
    // Calculate distance in world space (XZ plane only for cylindrical interaction)
    // We use a safe Z-up/Y-up check assuming standard world coordinates
    const playerPosXZ = vec3(uPlayerPosition.x, float(0.0), uPlayerPosition.z);
    const myPosXZ = vec3(positionWorld.x, float(0.0), positionWorld.z);
    const distToPlayer = distance(myPosXZ, playerPosXZ);

    // Interaction Radius (1.5x pad radius)
    // When player is within this radius, squash begins
    const interactRadius = float(radius * 1.5);

    // Squash Factor: 0.0 (Far) -> 0.5 (Center)
    // smoothstep(max, min, val) returns 0 at max, 1 at min.
    const squashFactor = smoothstep(interactRadius, float(0.0), distToPlayer).mul(0.5);

    // Deform Y: Scale down to (1.0 - 0.5) = 0.5 at center
    // We start from 1.0 (unscaled)
    const scaleY = float(1.0).sub(squashFactor);

    // Bulge XZ: Preserve volume (Volume ~ r^2 * h)
    // new_r = old_r / sqrt(new_h)
    // We use scaleY.sqrt() as divisor. safe since min scaleY is 0.5
    const scaleXZ = float(1.0).div(scaleY.sqrt());

    // Apply deformation to local position
    // Note: This deforms the mesh geometry itself on the GPU
    const squashDeformation = positionLocal.mul(vec3(scaleXZ, scaleY, scaleXZ));

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
        sheenColor: glowColor,
        deformationNode: squashDeformation // ⚡ JUICE: Apply TSL Squash
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
    const center = vec2(0.5, 0.5);
    const d = distance(uv(), center).mul(2.0); // 0 at center, 1 at edge
    const ring = smoothstep(0.8, 0.9, d).sub(smoothstep(0.9, 1.0, d)); // A ring at edge
    const core = float(1.0).sub(d); // Gradient from center

    const uGlowOpacity = uniform(0.6); // Default 0.6

    // ⚡ JUICE: Proximity Boost for Glow
    // Re-calculate distance in this material's context
    const glowPlayerDist = distance(vec3(positionWorld.x, float(0.0), positionWorld.z), playerPosXZ);
    const proximityBoost = smoothstep(interactRadius, float(0.0), glowPlayerDist).mul(0.5); // Add up to 0.5 opacity

    // Mix opacity + boost
    glowMat.opacityNode = core.mul(0.3).add(ring).mul(uGlowOpacity.add(proximityBoost));
    glowMat.emissiveNode = color(glowColor).mul(glowMat.opacityNode);

    const glowDisc = new THREE.Mesh(sharedGeometries.quad, glowMat);
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.y = 0.11; // Just above pad
    glowDisc.scale.set(radius * 2.2, radius * 2.2, 1); // Plane is 1x1, so scale to diameter
    pad.add(glowDisc);

    // Store reference to glow mat for pulsing intensity (used in animateFoliage)
    group.userData.glowMaterial = glowMat;
    group.userData.glowUniform = uGlowOpacity;

    // 3. Configuration
    group.userData.type = 'panningPad';
    group.userData.animationType = 'panningBob';
    group.userData.animationOffset = Math.random() * 100;

    // Reactivity: Map to specific channels for stereo effect
    const panBias = options.panBias !== undefined ? options.panBias : (Math.random() > 0.5 ? -1 : 1);
    group.userData.panBias = panBias; // -1 Left, 1 Right

    // ⚡ JUICE: Interaction Callbacks (Logic Layer)
    // InteractionSystem will call these when player enters proximity or clicks
    group.userData.onProximityEnter = () => {
        // Trigger "Land" dust particles
        spawnImpact(group.position, 'land');
    };

    group.userData.onInteract = () => {
        // Trigger "Jump" burst particles (e.g. if player clicks/activates it)
        spawnImpact(group.position, 'jump');
    };

    // Attach standard reactivity (color shifts)
    attachReactivity(group, { minLight: 0.0, maxLight: 1.0 });

    return group;
}
