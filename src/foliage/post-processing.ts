import * as THREE from 'three';
import { PostProcessing } from 'three/webgpu';
import { pass, mix, vec3, uniform, Fn, float, uv, vec2, distance, smoothstep } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { CandyRenderer } from '../core/init.ts';
import { isWebGPUMode } from '../core/init.ts';

// Global uniforms for reactivity
export const uBloomStrength = uniform(1.0);
export const uColorSaturation = uniform(1.1); // Slightly boosted by default
export const uColorContrast = uniform(1.05);
export const uVignetteStrength = uniform(0.5);
export const uAberrationStrength = uniform(0.005);

/**
 * Initializes the Post-Processing pipeline for Candy World.
 * Automatically selects WebGPU TSL pipeline or WebGL EffectComposer based on renderer.
 * 
 * Features:
 * - Base Scene Render
 * - Bloom (Audio-reactive via uBloomStrength)
 * - Color Correction (Saturation & Contrast)
 *
 * @param renderer The renderer (WebGPU or WebGL)
 * @param scene The main scene
 * @param camera The main camera
 * @param mode The renderer mode ('webgpu' or 'webgl')
 * @returns An object to manage and render the post-processing pipeline
 */
export function initPostProcessing(renderer: CandyRenderer, scene: THREE.Scene, camera: THREE.Camera, mode: 'webgpu' | 'webgl') {
    if (mode === 'webgpu') {
        return initWebGPUPostProcessing(renderer, scene, camera);
    } else {
        return initWebGLPostProcessing(renderer, scene, camera);
    }
}

/**
 * WebGPU-specific post-processing pipeline using TSL
 */
function initWebGPUPostProcessing(renderer: CandyRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!isWebGPUMode(renderer)) {
        throw new Error('Expected WebGPU renderer for WebGPU post-processing');
    }
    
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
        // Chromatic Aberration on base scene
        const caOffset = uAberrationStrength;
        const uvNode = uv();
        const uvR = uvNode.add(vec2(caOffset, 0.0));
        const uvG = uvNode;
        const uvB = uvNode.sub(vec2(caOffset, 0.0));

        const sceneTex = scenePass.getTextureNode();
        const r = sceneTex.uv(uvR).r;
        const g = sceneTex.uv(uvG).g;
        const b = sceneTex.uv(uvB).b;

        const caColor = vec3(r, g, b);

        // Base color + Bloom
        const color = caColor.add(bloomPass);

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

        // Vignette
        const dist = distance(uvNode, vec2(0.5, 0.5));
        const vig = float(1.0).sub(smoothstep(0.2, 1.0, dist));
        const vignetteMultiplier = mix(float(1.0), vig, uVignetteStrength);
        satColor = satColor.mul(vignetteMultiplier);

        return satColor;
    });

    // 5. Set Final Output Node
    postProcessing.outputNode = colorCorrection();

    // Resize handler
    window.addEventListener('resize', () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        // PostProcessing handles resizing internally
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
            contrast: uColorContrast,
            vignetteStrength: uVignetteStrength,
            aberrationStrength: uAberrationStrength
        }
    };
}

/**
 * WebGL-specific post-processing pipeline using EffectComposer
 */
function initWebGLPostProcessing(renderer: CandyRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (isWebGPUMode(renderer)) {
        throw new Error('Expected WebGL renderer for WebGL post-processing, got WebGPU');
    }
    const webglRenderer = renderer as THREE.WebGLRenderer;
    
    // 1. Initialize EffectComposer
    const composer = new EffectComposer(webglRenderer);

    // 2. Add Render Pass (base scene rendering)
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // 3. Add Bloom Pass
    // UnrealBloomPass parameters: (resolution, strength, radius, threshold)
    const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const bloomPass = new UnrealBloomPass(
        resolution,
        1.0,    // strength (maps to uBloomStrength)
        0.5,    // radius (soft glow spread)
        0.85    // threshold (only bright spots bloom)
    );
    composer.addPass(bloomPass);

    // Resize handler
    const handleResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        composer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Return interface compatible with WebGPU version
    return {
        render: () => {
            // Sync bloom strength: This per-frame read is necessary for audio reactivity.
            // Performance note: Uniforms are reactive in WebGPU mode (TSL), but WebGL requires
            // manual synchronization on every frame. This is an acceptable trade-off for fallback support.
            // TODO: Consider implementing an automatic sync mechanism to improve efficiency.
            bloomPass.strength = uBloomStrength.value || 1.0;
            composer.render();
        },
        // Expose uniforms for compatibility
        uniforms: {
            bloomStrength: uBloomStrength,  // Same uniform as WebGPU; manual sync required
            saturation: uColorSaturation,
            contrast: uColorContrast,
            vignetteStrength: uVignetteStrength,
            aberrationStrength: uAberrationStrength
        },
        // Expose bloom pass for manual control and synchronization
        bloomPass: bloomPass
    };
}
