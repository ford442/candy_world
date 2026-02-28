import * as THREE from 'three';
import { PostProcessing } from 'three/webgpu';
import { pass, mix, vec3, uniform, Fn, float } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

// Global uniforms for reactivity
export const uBloomStrength = uniform(1.0);
export const uColorSaturation = uniform(1.1); // Slightly boosted by default
export const uColorContrast = uniform(1.05);

/**
 * Initializes the WebGPU Post-Processing pipeline for Candy World.
 * Features:
 * - Base Scene Render (pass)
 * - TSL Bloom (Audio-reactive via uBloomStrength)
 * - Color Correction (Saturation & Contrast)
 *
 * @param renderer The WebGPURenderer
 * @param scene The main scene
 * @param camera The main camera
 * @returns An object to manage and render the post-processing pipeline
 */
export function initPostProcessing(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
    // 1. Initialize PostProcessing
    const postProcessing = new PostProcessing(renderer);

    // 2. Base Pass
    const scenePass = pass(scene, camera);

    // 3. Bloom Pass
    // threshold: 0.85 - only bright spots (neon/emissive) bloom
    // radius: 0.5 - smooth, wide spread for "Cute Clay" soft glow
    const threshold = uniform(0.85);
    const radius = uniform(0.5);

    const bloomPass = bloom(scenePass, uBloomStrength, radius, threshold);

    // 4. Color Correction Logic
    const colorCorrection = Fn(() => {
        // Base color + Bloom
        const color = scenePass.add(bloomPass);

        // Saturation
        // Simple luminance dot product
        const luminanceWeight = vec3(0.299, 0.587, 0.114);
        const lum = color.xyz.dot(luminanceWeight);
        const grayscale = vec3(lum);

        // mix(grayscale, original, saturation)
        let satColor = mix(grayscale, color.xyz, uColorSaturation);

        // Contrast
        // smoothstep-like contrast adjustment or simple centering
        const midPoint = vec3(0.5);
        satColor = satColor.sub(midPoint).mul(uColorContrast).add(midPoint);

        return satColor;
    });

    // 5. Set Final Output Node
    postProcessing.outputNode = colorCorrection();

    // Resize handler
    window.addEventListener('resize', () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        // PostProcessing handles resizing internally, but we can call it explicitly if needed
        // postProcessing.setSize(width, height);
        // PostProcessing doesn't have a direct setSize, it uses renderer size.
    });

    return {
        render: () => {
            // Note: renderer.render() should NOT be called before this if we want post processing to handle the main pass
            postProcessing.render();
        },
        // Expose uniforms for manual tweaking if needed
        uniforms: {
            bloomStrength: uBloomStrength,
            saturation: uColorSaturation,
            contrast: uColorContrast
        }
    };
}
