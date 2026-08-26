/**
 * Candy World post-FX.
 *
 * WebGPU: scene pass + bloom + optional DoF + optional GTAO + color grade.
 * WebGL: EffectComposer + UnrealBloomPass (and optional BokehPass).
 *
 * SSR is **deferred**: mirrors already use `getDreamEnvTexture()` in
 * `src/foliage/mirrors.ts`. A screen-space reflection pass would add another
 * full-screen depth/normal fetch on top of GTAO + GI probes — skip on `low`,
 * and not in this PR. See docs/POSTFX_STACK.md.
 */
import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { pass, mix, vec3, uniform, Fn, float, uv, vec2, distance, smoothstep } from 'three/tsl';
import { PostProcessing } from 'three/webgpu';
import { CONFIG, isAoEnabled, isDofEnabled } from '../core/config.ts';
import type { CandyRenderer } from '../core/init.ts';
import { isWebGPUMode } from '../core/init.ts';

// Global uniforms for reactivity
export const uBloomStrength = uniform(1.0);
export const uBloomThreshold = uniform(CONFIG.postfx.bloomThreshold);
export const uBloomRadius = uniform(CONFIG.postfx.bloomRadius);
export const uAoStrength = uniform(0.0);
export const uColorSaturation = uniform(1.1); // Slightly boosted by default
export const uColorContrast = uniform(1.05);
export const uVignetteStrength = uniform(0.5);
export const uAberrationStrength = uniform(0.002); // Very subtle by default (harsh RGB split removed in favor of prettier candy glow)

// Depth-of-Field controls (read by both pipelines; driven per-frame from game-loop.ts).
//   uDofFocus — focal-plane distance in world units (follows the camera look vector)
//   uDofMix   — 0 = fully sharp, 1 = full bokeh. Lets us fade DoF in near flora and
//               snap back to a sharp world instantly without recompiling shaders.
export const uDofFocus = uniform(CONFIG.postfx.dofFocusDistance);
export const uDofMix = uniform(0.0);
/** 0–1 bloom swell driven by visible god-ray opacity (screen-space scatter companion). */
export const uShaftScatterBoost = uniform(0.0);

let _webglBloomPass: UnrealBloomPass | null = null;

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

/** Live bloom cutoff. Also syncs the WebGL UnrealBloomPass. */
export function setBloomThreshold(value: number): void {
    const n = clamp01(value);
    uBloomThreshold.value = n;
    if (_webglBloomPass) _webglBloomPass.threshold = n;
}

/** Live bloom spread. Also syncs the WebGL UnrealBloomPass. */
export function setBloomRadius(value: number): void {
    const n = clamp01(value);
    uBloomRadius.value = n;
    if (_webglBloomPass) _webglBloomPass.radius = n;
}

/** Live GTAO mix. No-op if the pass was not built this session. */
export function setAoStrength(value: number): void {
    uAoStrength.value = clamp01(value);
}

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
export function initPostProcessing(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    mode: 'webgpu' | 'webgl'
) {
    if (isWebGPUMode(renderer)) {
        return initWebGPUPostProcessing(renderer, scene, camera, mode);
    }
    return initWebGLPostProcessing(renderer, scene, camera);
}

/**
 * WebGPU-specific post-processing pipeline using TSL
 */
function initWebGPUPostProcessing(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    mode: 'webgpu' | 'webgl'
) {
    if (!isWebGPUMode(renderer)) {
        throw new Error('Expected WebGPU renderer for WebGPU post-processing');
    }

    // 1. Initialize PostProcessing
    const postProcessing = new PostProcessing(renderer);

    // 2. Base Pass
    const scenePass = pass(scene, camera);

    // 3. Bloom — knobs live in CONFIG.postfx; strength stays audio-driven.
    const bloomPass = bloom(
        scenePass,
        uBloomStrength as unknown as number,
        uBloomRadius as unknown as number,
        uBloomThreshold as unknown as number
    );

    // 3b. Depth of Field (bokeh) — only built into the graph when enabled at boot,
    // so the default `low` tier carries zero DoF cost. When present it is blended by
    // uDofMix, giving instant sharp↔blur transitions without a shader recompile.
    const dofActive = isDofEnabled();
    let dofColorNode: any = null;
    if (dofActive) {
        // viewZ drives the circle-of-confusion; aperture/maxblur kept subtle (candy bokeh).
        const viewZ = scenePass.getViewZNode();
        dofColorNode = dof(
            scenePass,
            viewZ,
            uDofFocus,
            uniform(CONFIG.postfx.dofAperture),
            uniform(CONFIG.postfx.dofMaxBlur)
        );
        console.log('[PostFX] Depth of Field enabled (WebGPU TSL bokeh)');
    }

    // GTAO — half-res, few samples, pastel cavity (not grey dirt). Off on low.
    // SSR is not in this graph (env-map mirrors; see file header).
    let aoPass: ReturnType<typeof ao> | null = null;
    if (isAoEnabled() && mode === 'webgpu' && camera instanceof THREE.PerspectiveCamera) {
        aoPass = ao(scenePass.getTextureNode('depth'), null as never, camera);
        aoPass.resolutionScale = 0.5;
        aoPass.samples.value = 8;
        aoPass.radius.value = 0.4;
        aoPass.scale.value = 0.65;
        uAoStrength.value = CONFIG.postfx.aoStrength;
        console.log('[PostFX] GTAO enabled (WebGPU, candy-soft, half-res)');
    } else {
        uAoStrength.value = 0;
    }

    // 4. Color Correction Logic
    const colorCorrection = Fn(() => {
        // Very subtle, soft chromatic aberration (mostly disabled by default for candy aesthetic)
        // The old hard RGB split has been replaced by the much prettier "Candy Glow Pulse" in chromatic.ts
        const caOffset = uAberrationStrength.mul(0.3); // even softer than before
        const uvNode = uv();
        // Sunrise-gated radial scatter companion (zero when shafts are hidden).
        const scatterAmt = uShaftScatterBoost.mul(0.018);
        const uvScatter = mix(uvNode, vec2(0.5, 0.5), scatterAmt);
        const uvR = uvScatter.add(vec2(caOffset, 0.0));
        const uvG = uvScatter;
        const uvB = uvScatter.sub(vec2(caOffset, 0.0));

        const sceneTex = scenePass.getTextureNode() as unknown as {
            uv: (coords: ReturnType<typeof vec2>) => ReturnType<typeof vec3>;
        };
        const r = sceneTex.uv(uvR).r;
        const g = sceneTex.uv(uvG).g;
        const b = sceneTex.uv(uvB).b;

        let caColor = vec3(r, g, b);

        // Blend in the bokeh result when DoF is built into the graph. uDofMix=0 keeps
        // the sharp (chromatic-aberrated) scene; uDofMix=1 is full DoF.
        if (dofColorNode) {
            caColor = mix(caColor, dofColorNode.rgb, uDofMix);
        }

        if (aoPass) {
            // Visual Impact: pink-cocoa cavity, keep chroma — never a grey SSAO wash
            const cavity = float(1.0).sub(aoPass.r).mul(uAoStrength);
            caColor = mix(caColor, caColor.mul(vec3(0.88, 0.74, 0.84)), cavity);
        }

        // Base color + Bloom (shaft scatter boost swells bloom when god rays are visible)
        const scatterMul = float(1.0).add(uShaftScatterBoost);
        const color = caColor.add(bloomPass.mul(scatterMul));

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
        satColor = satColor
            .sub(midPoint)
            .mul(uColorContrast)
            .add(midPoint) as unknown as ReturnType<typeof mix>;

        // Vignette
        const dist = distance(uvNode, vec2(0.5, 0.5));
        const vig = float(1.0).sub(smoothstep(0.2, 1.0, dist));
        const vignetteMultiplier = mix(float(1.0), vig, uVignetteStrength);
        satColor = satColor.mul(vignetteMultiplier) as unknown as ReturnType<typeof mix>;

        return satColor;
    });

    // 5. Set Final Output Node
    postProcessing.outputNode = colorCorrection();

    const syncSize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height);
        postProcessing.needsUpdate = true;
    };

    // Resize handler — PostProcessing does not auto-resize PassNode/Bloom internals.
    window.addEventListener('resize', syncSize);

    return {
        render: () => {
            // Note: renderer.render() should NOT be called before this if we want post processing to handle the main pass
            postProcessing.render();
        },
        syncSize,
        // Expose uniforms for manual tweaking if needed
        uniforms: {
            bloomStrength: uBloomStrength,
            bloomThreshold: uBloomThreshold,
            bloomRadius: uBloomRadius,
            aoStrength: uAoStrength,
            saturation: uColorSaturation,
            contrast: uColorContrast,
            vignetteStrength: uVignetteStrength,
            aberrationStrength: uAberrationStrength,
        },
    };
}

/**
 * WebGL-specific post-processing pipeline using EffectComposer
 */
function initWebGLPostProcessing(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
) {
    if (isWebGPUMode(renderer)) {
        throw new Error('Expected WebGL renderer for WebGL post-processing, got WebGPU');
    }
    const webglRenderer = renderer as THREE.WebGLRenderer;

    // 1. Initialize EffectComposer
    const composer = new EffectComposer(webglRenderer);

    // 2. Add Render Pass (base scene rendering)
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // 2b. Depth of Field (WebGL fallback) — degraded but functional bokeh.
    // Only added when DoF is enabled at boot. Toggled per-frame via pass.enabled
    // (uDofMix), so disabling returns to a sharp world instantly.
    let bokehPass: BokehPass | null = null;
    if (isDofEnabled()) {
        bokehPass = new BokehPass(scene, camera, {
            focus: CONFIG.postfx.dofFocusDistance,
            aperture: CONFIG.postfx.dofAperture,
            maxblur: CONFIG.postfx.dofMaxBlur,
        });
        bokehPass.enabled = false; // off until uDofMix rises
        composer.addPass(bokehPass);
        console.log('[PostFX] Depth of Field enabled (WebGL BokehPass)');
    }

    // 3. Add Bloom Pass
    // UnrealBloomPass parameters: (resolution, strength, radius, threshold)
    const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const bloomPass = new UnrealBloomPass(
        resolution,
        1.0, // strength (maps to uBloomStrength)
        CONFIG.postfx.bloomRadius,
        CONFIG.postfx.bloomThreshold
    );
    _webglBloomPass = bloomPass;
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
            const scatter = uShaftScatterBoost.value || 0;
            bloomPass.strength = (uBloomStrength.value || 1.0) * (1.0 + scatter);
            bloomPass.threshold = uBloomThreshold.value;
            bloomPass.radius = uBloomRadius.value;
            // Sync DoF: enable only while mixed in, and track the focal plane.
            if (bokehPass) {
                bokehPass.enabled = uDofMix.value > 0.01;
                (bokehPass.uniforms as any)['focus'].value = uDofFocus.value;
            }
            composer.render();
        },
        syncSize: handleResize,
        // Expose uniforms for compatibility
        uniforms: {
            bloomStrength: uBloomStrength, // Same uniform as WebGPU; manual sync required
            bloomThreshold: uBloomThreshold,
            bloomRadius: uBloomRadius,
            aoStrength: uAoStrength,
            saturation: uColorSaturation,
            contrast: uColorContrast,
            vignetteStrength: uVignetteStrength,
            aberrationStrength: uAberrationStrength,
        },
        // Expose bloom pass for manual control and synchronization
        bloomPass: bloomPass,
    };
}
