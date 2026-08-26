/**
 * Legacy EffectComposer post-FX. No app-chunk imports (TLA deadlock).
 */
import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type * as postFxUniforms from './post-processing-uniforms.ts';

type U = typeof postFxUniforms;

export function initWebGLPostProcessing(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: {
        dofEnabled: boolean;
        dofFocusDistance: number;
        dofAperture: number;
        dofMaxBlur: number;
        bloomRadius: number;
        bloomThreshold: number;
        u: U;
    }
) {
    const {
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
    } = opts.u;

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    let bokehPass: BokehPass | null = null;
    if (opts.dofEnabled) {
        bokehPass = new BokehPass(scene, camera, {
            focus: opts.dofFocusDistance,
            aperture: opts.dofAperture,
            maxblur: opts.dofMaxBlur,
        });
        bokehPass.enabled = false;
        composer.addPass(bokehPass);
        console.log('[PostFX] Depth of Field enabled (WebGL BokehPass)');
    }

    const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const bloomPass = new UnrealBloomPass(resolution, 1.0, opts.bloomRadius, opts.bloomThreshold);
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
