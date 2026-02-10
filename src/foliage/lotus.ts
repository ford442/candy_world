import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, vec2, positionLocal, normalWorld,
    mix, sin, cos, abs, smoothstep, uniform,
    mx_noise_float, uv, length, atan2, max
} from 'three/tsl';
import {
    createClayMaterial,
    sharedGeometries,
    registerReactiveMaterial,
    attachReactivity,
    uAudioLow,
    uGlitchIntensity,
    uTime
} from './common.ts';

interface LotusOptions {
    color?: number | string | THREE.Color;
    scale?: number;
}

/**
 * Creates a "Subwoofer Lotus" - A bass-reactive flora with a "Speaker" center.
 *
 * Visuals:
 * - Base Pad: Dark Green Clay.
 * - Rings: "Speaker Cone" rings that pulse vertically with Bass (uAudioLow).
 * - Center: A "Portal" that activates when Glitched (uGlitchIntensity > 0.5).
 */
export function createSubwooferLotus(options: LotusOptions = {}): THREE.Group {
    const { color: hexColor = 0x2E8B57, scale = 1.0 } = options;
    const group = new THREE.Group();
    group.scale.setScalar(scale);

    // 1. Base Pad (The Leaf/Body)
    const padMat = createClayMaterial(hexColor);
    const pad = new THREE.Mesh(sharedGeometries.unitCylinder, padMat);
    pad.scale.set(1.5, 0.2, 1.5);
    pad.position.y = 0;
    pad.castShadow = true;
    pad.receiveShadow = true;
    group.add(pad);

    // 2. The "Speaker" Rings (Bass Reactive)
    // We create a custom TSL material for the rings that displaces them vertically based on uAudioLow.

    const ringMat = new MeshStandardNodeMaterial();
    ringMat.colorNode = color(0xFFFFFF); // Base white
    ringMat.roughnessNode = float(0.2);
    ringMat.metalnessNode = float(0.5);

    // --- TSL Logic for Rings ---

    // Pulse Amplitude driven by Bass + Glitch
    const bassPulse = uAudioLow.mul(0.8); // 0.0 to 0.8

    // Glitch Distortion: Random jerky movement
    const glitchShake = mx_noise_float(vec3(uTime.mul(20.0), float(0.0), float(0.0))).mul(uGlitchIntensity).mul(0.5);

    // Total vertical displacement
    const displacement = bassPulse.add(glitchShake);

    // Color: White normally, turns Purple/Pink during Glitch
    const normalColor = vec3(1.0, 1.0, 1.0);
    const glitchColor = vec3(0.8, 0.0, 1.0); // Purple
    const finalColor = mix(normalColor, glitchColor, uGlitchIntensity);

    // Emission: Pulse brightness with Bass
    const emission = finalColor.mul(bassPulse.add(0.2));

    ringMat.colorNode = finalColor;
    ringMat.emissiveNode = emission;

    // Vertex Displacement (in World Space via positionNode usually, but we are local here)
    const newPos = positionLocal.add(vec3(0.0, displacement, 0.0));
    ringMat.positionNode = newPos;

    registerReactiveMaterial(ringMat);

    // Create 3 Rings
    for (let i = 1; i <= 3; i++) {
        const radius = i * 0.35;
        const ringGeo = new THREE.TorusGeometry(radius, 0.06, 8, 32);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.3;

        // Manual offset for "cone" shape resting state
        ring.position.y += (3 - i) * 0.1;

        pad.add(ring);
    }

    // 3. The "Portal" Center (Glitch Reactive)
    // A flat disk in the center
    const centerGeo = new THREE.CircleGeometry(0.25, 32);
    const centerMat = new MeshStandardNodeMaterial();
    centerMat.roughnessNode = float(0.0);

    // --- TSL Portal Logic ---
    // UV centered
    const vUv = uv().sub(0.5).mul(2.0); // -1 to 1
    const len = length(vUv);

    // Vortex Spin
    const spinSpeed = uTime.mul(5.0).add(uGlitchIntensity.mul(20.0));
    // FIXED: Use TSL atan2 instead of Math.atan2
    const angle = float(atan2(vUv.y, vUv.x)).add(spinSpeed.mul(float(1.0).sub(len))); // Spin faster at center

    // Pattern
    const spiral = sin(angle.mul(5.0).sub(len.mul(10.0)));

    // Visibility: Only visible if Glitch > 0.1 OR Bass > 0.8 (Super loud)
    // FIXED: Use max() to prevent overflow
    const active = max(smoothstep(0.1, 0.5, uGlitchIntensity), smoothstep(0.7, 1.0, uAudioLow));

    // Colors
    const portalColor = vec3(0.0, 0.0, 0.0); // Black hole base
    const swirlColor = vec3(0.5, 0.0, 1.0); // Purple swirl
    const hotColor = vec3(1.0, 0.0, 0.5); // Hot Pink center

    const finalPortal = mix(portalColor, swirlColor, spiral.mul(active));
    const hotCenter = smoothstep(0.2, 0.0, len).mul(hotColor).mul(active); // Glowing dot in center

    centerMat.colorNode = vec3(0.0); // Black surface
    centerMat.emissiveNode = finalPortal.add(hotCenter);

    const center = new THREE.Mesh(centerGeo, centerMat);
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.6; // Top of the stack
    pad.add(center);


    // 4. Metadata & Reactivity
    group.userData.animationType = 'sway';
    group.userData.type = 'subwoofer_lotus';

    // It reacts to Glitch (Logic handled in material) and Bass (Material).
    return attachReactivity(group, { minLight: 0.0, maxLight: 1.0 });
}
