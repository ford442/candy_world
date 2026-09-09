
import * as THREE from 'three';
import {
    Fn,
    vec4,
    viewportSharedTexture,
    screenUV,
    vec2
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { getBiomeUniforms } from '../systems/biome-uniforms.ts';
import { uChromaticIntensity, candyPulseWarpUv, gradeCandyGlowPulse } from './chromatic-nodes.ts';

export { uChromaticIntensity, candyPulseWarpUv, gradeCandyGlowPulse };

// Global uniform for Candy Impact / Glow Pulse intensity.
// Driven by dashes, impacts, strong beats, etc.

type UvNode = ReturnType<typeof vec2>;


/**
 * Creates a full-screen "Candy Glow Pulse" overlay.
 *
 * WebGL / GLSL-node path only. WebGPU composites this in the TSL post graph
 * (`post-processing-webgpu.ts`) so we never `copyFramebufferToTexture` from
 * an HDR rgba16float pass into Three's default rgba8unorm FramebufferTexture.
 *
 * @returns {THREE.Mesh} The full-screen quad mesh (attach to camera).
 */
export function createChromaticPulse(): THREE.Mesh {
    // Create a full-screen quad geometry
    const geometry = new THREE.PlaneGeometry(2, 2);

    const chromaticEffect = Fn(() => {
        const baseUV = screenUV;
        const warpedUV = candyPulseWarpUv(baseUV as UvNode);
        const centered = warpedUV.sub(0.5);
        const dist = centered.length();
        const sample = (coords: UvNode) => viewportSharedTexture(coords).rgb;
        const globalUniforms = getBiomeUniforms('global');
        const withMusic = gradeCandyGlowPulse(sample, warpedUV, dist, globalUniforms.noteColor, globalUniforms.shimmer);
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
