
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    vec3,
    vec4,
    float,
    uniform,
    viewportSharedTexture,
    screenUV,
    time,
    sin,
    cos,
    vec2,
    max,
    mix
} from 'three/tsl';
import { getBiomeUniforms } from '../systems/biome-uniforms.ts';

// Global uniform for Candy Impact / Glow Pulse intensity.
// Driven by dashes, impacts, strong beats, etc.
export const uChromaticIntensity = uniform(0.0);

/**
 * Creates a full-screen "Candy Glow Pulse" overlay.
 *
 * This replaces the old harsh RGB chromatic aberration split with a much
 * more aesthetically pleasing effect that fits the pastel candy world:
 * - Soft ethereal bloom / glow on bright areas
 * - Gentle warm pink "sugar rush" color shift on high intensity
 * - Zoom + light shake + soft barrel distortion for impact feedback
 * - Extra highlight sparkle on emissive candy surfaces
 *
 * Much softer and dreamier than raw RGB channel separation.
 *
 * @returns {THREE.Mesh} The full-screen quad mesh (attach to camera).
 */
export function createChromaticPulse(): THREE.Mesh {
    // Create a full-screen quad geometry
    const geometry = new THREE.PlaneGeometry(2, 2);

    // --- TSL Shader Logic ---
    const chromaticEffect = Fn(() => {
        // Base UVs for screen sampling
        const baseUV = screenUV;

        // 1. Zoom / Impact Punch (kept for strong "hit" feedback)
        const centeredUV = baseUV.sub(0.5);

        // 🎨 PALETTE: "Juice" Factor - Add Screen Shake (gentle, candy-like)
        const shakePhase = time.mul(42.0);
        const shakeAmount = uChromaticIntensity.mul(0.007); // softer than before
        const shakeX = sin(shakePhase).mul(shakeAmount);
        const shakeY = cos(shakePhase.mul(1.15)).mul(shakeAmount);
        const shakeOffset = vec2(shakeX, shakeY);

        // Apply zoom (max ~12% at full intensity) + shake
        const zoomFactor = float(1.0).sub(uChromaticIntensity.mul(0.12));
        const zoomedUV = centeredUV.mul(zoomFactor).add(shakeOffset);

        const dist = zoomedUV.length();

        // 2. Gentle Barrel Distortion (soft "sugar rush" lens feel)
        const distortionStrength = uChromaticIntensity.mul(0.35);
        const distortion = float(1.0).add(dist.mul(dist).mul(distortionStrength));
        const distortedUV = zoomedUV.mul(distortion).add(0.5);

        // 3. --- IMPROVED AESTHETIC: "Candy Glow Pulse" instead of harsh RGB split ---
        // Sample main scene
        const baseColor = viewportSharedTexture(distortedUV);

        // Soft multi-sample "ethereal bloom" approximation (dreamy glossy glow)
        const glowOffset = uChromaticIntensity.mul(0.004);
        const glow1 = viewportSharedTexture(distortedUV.add(vec2(glowOffset, 0.0)));
        const glow2 = viewportSharedTexture(distortedUV.add(vec2(glowOffset.mul(-0.7), glowOffset.mul(1.1))));
        const glow3 = viewportSharedTexture(distortedUV.add(vec2(0.0, glowOffset.mul(-0.9))));

        // Chain max calls (more TSL-type friendly)
        const glowA = max(baseColor, glow1);
        const glowB = max(glowA, glow2);
        const glow = max(glowB, glow3);

        // Add extra brightness on highlights (makes emissive candy surfaces "pop" more)
        const brightness = glow.x.mul(0.3).add(glow.y.mul(0.59)).add(glow.z.mul(0.11));
        const highlightBoost = max(brightness.sub(0.6), 0.0).mul(uChromaticIntensity.mul(1.8));
        const glowed = glow.add(vec3(highlightBoost).mul(0.6));

        // 🎨 PALETTE: Soft candy color shift (pastel pink/magenta bias on impact)
        // This feels like a "sugar high" or "candy rush" rather than a glitch
        const candyPink = vec3(1.08, 0.88, 0.98); // soft warm pink
        const candyShift = mix(vec3(1.0), candyPink, uChromaticIntensity.mul(0.35));

        let finalColor = glowed.mul(candyShift);

        // Gentle extra saturation on high intensity (makes pastels more vivid without breaking)
        const satAmount = uChromaticIntensity.mul(0.25).add(1.0);
        const lum = finalColor.dot(vec3(0.299, 0.587, 0.114));
        const saturated = mix(vec3(lum), finalColor, satAmount);

        // Very subtle vignette glow on edges during strong pulses (dreamy feel)
        const edgeVig = max(float(1.0).sub(dist.mul(0.9)), 0.0);
        const vigBoost = edgeVig.mul(uChromaticIntensity).mul(0.25);
        const withVig = saturated.add(vec3(vigBoost).mul(0.4));

        // Music Impact: global noteColor tint on high chromatic intensity
        const globalUniforms = getBiomeUniforms('global');
        const musicTint = globalUniforms.noteColor.mul(globalUniforms.shimmer).mul(uChromaticIntensity).mul(0.15);
        const withMusic = withVig.add(musicTint);

        return vec4(withMusic, 1.0);
    });

    // Use MeshBasicNodeMaterial to ensure the overlay is unlit and displays exactly as calculated
    const material = new MeshBasicNodeMaterial();
    material.colorNode = chromaticEffect();

    // The effect is intentionally named "Chromatic Pulse" in the API for backward compatibility
    // with all the gameplay systems that drive uChromaticIntensity, but the visual is now a
    // soft, juicy "Candy Glow Pulse" that matches the pastel aesthetic.

    // Ensure it renders on top of everything else (Post-Processing simulation)
    // We set depthTest/depthWrite to false so it doesn't mess with depth buffer
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true; // Technically opaque output, but good for overlay behavior

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // Always render
    mesh.renderOrder = 9999; // Render last
    mesh.userData.isFullScreenEffect = true;

    // Position in front of camera (assuming attached to camera)
    // z = -1.0 is comfortably inside the frustum (near usually 0.1)
    mesh.position.set(0, 0, -1.0);

    // Scale up to cover screen even at ultra-wide aspect ratios
    // At z=-1, height coverage is ~1.5 (for FOV 75).
    // Width coverage for 32:9 aspect (super ultrawide) is ~5.3.
    // Scale by 10 is excessively safe.
    mesh.scale.set(10, 10, 1);

    return mesh;
}
