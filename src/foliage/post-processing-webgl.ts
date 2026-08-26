/**
 * Legacy EffectComposer post-FX. Only loaded when the renderer is not a
 * WebGPURenderer (today Candy World always is — this stays for the dual API).
 */
import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CONFIG, isDofEnabled } from '../core/config.ts';
import type { CandyRenderer } from '../core/init.ts';
import { isWebGPUMode } from '../core/init.ts';
import {
    uAberrationStrength,
    uAoStrength,
    uBloomRadius,
    uBloomStrength,
    uBloomThreshold,
    uColorContrast,
    uColorSaturation,
    uDofFocus,
    uDofMix,
    uShaftScatterBoost,
    uVignetteStrength,
} from './post-processing-uniforms.ts';

export function initWebGLPostProcessing(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
) {
    if (isWebGPUMode(renderer)) {
        throw new Error('Expected WebGL renderer for WebGL post-processing, got WebGPU');
    }
    const webglRenderer = renderer as THREE.WebGLRenderer;
    const composer = new EffectComposer(webglRenderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    let bokehPass: BokehPass | null = null;
    if (isDofEnabled()) {
        bokehPass = new BokehPass(scene, camera, {
            focus: CONFIG.postfx.dofFocusDistance,
            aperture: CONFIG.postfx.dofAperture,
            maxblur: CONFIG.postfx.dofMaxBlur,
        });
        bokehPass.enabled = false;
        composer.addPass(bokehPass);
        console.log('[PostFX] Depth of Field enabled (WebGL BokehPass)');
    }

    const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const bloomPass = new UnrealBloomPass(
        resolution,
        1.0,
        CONFIG.postfx.bloomRadius,
        CONFIG.postfx.bloomThreshold
    );
    composer.addPass(bloomPass);

    const handleResize = () => {
        composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return {
        render: () => {
            const scatter = uShaftScatterBoost.value || 0;
            bloomPass.strength = (uBloomStrength.value || 1.0) * (1.0 + scatter);
            bloomPass.threshold = uBloomThreshold.value;
            bloomPass.radius = uBloomRadius.value;
            if (bokehPass) {
                bokehPass.enabled = uDofMix.value > 0.01;
                (bokehPass.uniforms as { focus: { value: number } })['focus'].value =
                    uDofFocus.value;
            }
            composer.render();
        },
        syncSize: handleResize,
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
        bloomPass,
    };
}
