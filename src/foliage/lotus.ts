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
} from './index.ts';
import { BiomeUniforms } from '../systems/biome-uniforms.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { discoverySystem } from '../systems/discovery.ts';
import { showToast } from '../utils/toast.js';
import { spawnImpact } from './impacts.ts';

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

    // Pulse Amplitude driven by Bass + Glitch + Crystalline Nebula amplitude scale
    // 'uAudioLow' represents the bass kick intensity (0 to ~1). We scale it to define the maximum upward stretch.
    // BiomeUniforms.crystallineNebula.amplitudeScale amplifies the pulse when the bound channels are active.
    const bassPulse = uAudioLow.mul(0.8).mul(BiomeUniforms.crystallineNebula.amplitudeScale);

    // Glitch Distortion: Random jerky movement
    // 'mx_noise_float' generates procedural noise. We feed it 'uTime' scaled rapidly (20.0) to create a frantic 1D signal.
    // This is then scaled by 'uGlitchIntensity' so the shake only occurs during glitch events.
    const glitchShake = mx_noise_float(vec3(uTime.mul(20.0), float(0.0), float(0.0))).mul(uGlitchIntensity).mul(0.5);

    // Total vertical displacement
    // The final displacement is the smooth bass pulse augmented by the chaotic glitch shake.
    const displacement = bassPulse.add(glitchShake);

    // Color: White normally, turns Purple/Pink during Glitch
    // 'mix' linearly interpolates between normal white and glitch purple based on the current 'uGlitchIntensity'.
    const normalColor = vec3(1.0, 1.0, 1.0);
    const glitchColor = vec3(0.8, 0.0, 1.0); // Purple
    const finalColor = mix(normalColor, glitchColor, uGlitchIntensity);

    // Emission: Pulse brightness with Bass + Crystalline Nebula shimmer
    // The emissive glow scales up with the bass pulse, maintaining a minimum baseline glow (0.2).
    // Crystalline Nebula shimmer adds a violet-cyan sparkle driven by the bound tracker channels.
    const shimmerTint = vec3(0.4, 0.0, 1.0); // Violet shimmer colour
    const shimmerGlow = BiomeUniforms.crystallineNebula.shimmer.mul(shimmerTint).mul(2.5);
    const emission = finalColor.mul(bassPulse.add(0.2)).add(shimmerGlow);

    ringMat.colorNode = finalColor;
    ringMat.emissiveNode = emission;

    // Vertex Displacement
    // By modifying 'positionNode', we displace the mesh's vertices dynamically on the GPU.
    // We add the computed 1D 'displacement' strictly to the Y-axis of the local vertex position.
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
    // Standard UVs are [0, 1]. Subtracting 0.5 and multiplying by 2 centers them at [0, 0] with range [-1, 1].
    const vUv = uv().sub(0.5).mul(2.0);
    // 'length' gets the distance from the center (radius), converting our Cartesian UVs towards Polar coordinates.
    const len = length(vUv);

    // Vortex Spin
    // The base spin is driven by 'uTime', but spikes aggressively during a glitch ('uGlitchIntensity' * 20.0).
    const spinSpeed = uTime.mul(5.0).add(uGlitchIntensity.mul(20.0));

    // 'atan2(y, x)' returns the angle (theta) of the pixel relative to the center.
    // We add the 'spinSpeed' to rotate it, but multiply the speed by '(1.0 - len)' so the center spins faster than the edges, creating a vortex.
    const angle = float(atan2(vUv.y, vUv.x)).add(spinSpeed.mul(float(1.0).sub(len)));

    // Pattern
    // The 'sin' function creates the alternating arms of the spiral.
    // 'angle * 5' determines the number of arms. 'len * 10' twists the arms as they move outward.
    const spiral = sin(angle.mul(5.0).sub(len.mul(10.0)));

    // Visibility: Only visible if Glitch > 0.1 OR Bass > 0.8 (Super loud)
    // 'smoothstep' creates a smooth transition from 0 to 1 across the given thresholds.
    // 'max' is used as a logical OR to activate the portal if either the glitch or the bass is sufficiently high.
    const active = max(smoothstep(0.1, 0.5, uGlitchIntensity), smoothstep(0.7, 1.0, uAudioLow));

    // Colors
    const portalColor = vec3(0.0, 0.0, 0.0); // Black hole base
    const swirlColor = vec3(0.5, 0.0, 1.0);  // Purple swirl
    const hotColor = vec3(1.0, 0.0, 0.5);    // Hot Pink center

    // 'mix' uses the calculated 'spiral' pattern (masked by 'active') to blend between the black base and the purple swirl.
    const finalPortal = mix(portalColor, swirlColor, spiral.mul(active));
    // A glowing pink center dot created by inverting distance ('smoothstep(0.2, 0.0, len)') and masking by 'active'.
    const hotCenter = smoothstep(0.2, 0.0, len).mul(hotColor).mul(active);

    centerMat.colorNode = vec3(0.0); // Black surface absorbs light
    centerMat.emissiveNode = finalPortal.add(hotCenter); // Emissive channel projects the glowing portal

    const center = new THREE.Mesh(centerGeo, centerMat);
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.6; // Top of the stack
    pad.add(center);


    // 4. Metadata & Reactivity
    group.userData.animationType = 'sway';
    group.userData.type = 'subwoofer_lotus';

    // 5. Interaction (Bass Portal Secret)
    makeInteractive(group);
    group.userData.interactionText = "Commune";
    group.userData.onInteract = () => {
        // If glitch intensity is high, reveal the secret Bass Portal
        if (uGlitchIntensity.value > 0.5) {
            const newlyDiscovered = discoverySystem.discover('bass_portal', 'Bass Portal', '🌀');
            if (newlyDiscovered) {
                showToast("Hidden Bass Portal Revealed!", "🌀");
            } else {
                showToast("The Bass Portal is unstable...", "🌀");
            }

            // Visual feedback
            spawnImpact(group.position, 'dash');

            // Additional 'juice' could be added here later (e.g. teleporting the player)
        } else {
            // Normal interaction
            showToast("The Lotus hums with latent energy...", "🔊");
        }
    };

    // It reacts to Glitch (Logic handled in material) and Bass (Material).
    return attachReactivity(group, { minLight: 0.0, maxLight: 1.0 });
}
