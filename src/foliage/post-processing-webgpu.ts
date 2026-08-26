/**
 * WebGPU TSL post graph (bloom, optional DoF, optional GTAO).
 * Loaded via dynamic import so GTAO/Bloom nodes stay out of the app chunk.
 */
import * as THREE from 'three';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { pass, mix, vec3, uniform, Fn, float, uv, vec2, distance, smoothstep } from 'three/tsl';
import { PostProcessing } from 'three/webgpu';
import { CONFIG, isAoEnabled, isDofEnabled } from '../core/config.ts';
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

export function initWebGPUPostProcessing(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    mode: 'webgpu' | 'webgl'
) {
    if (!isWebGPUMode(renderer)) {
        throw new Error('Expected WebGPU renderer for WebGPU post-processing');
    }

    const postProcessing = new PostProcessing(renderer);
    const scenePass = pass(scene, camera);

    const bloomPass = bloom(
        scenePass,
        uBloomStrength as unknown as number,
        uBloomRadius as unknown as number,
        uBloomThreshold as unknown as number
    );

    const dofActive = isDofEnabled();
    let dofColorNode: ReturnType<typeof dof> | null = null;
    if (dofActive) {
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
    // SSR is not in this graph (env-map mirrors; see docs/POSTFX_STACK.md).
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

    const colorCorrection = Fn(() => {
        const caOffset = uAberrationStrength.mul(0.3);
        const uvNode = uv();
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

        if (dofColorNode) {
            caColor = mix(caColor, dofColorNode.rgb, uDofMix);
        }

        if (aoPass) {
            // Visual Impact: pink-cocoa cavity, keep chroma — never a grey SSAO wash
            const cavity = float(1.0).sub(aoPass.r).mul(uAoStrength);
            caColor = mix(caColor, caColor.mul(vec3(0.88, 0.74, 0.84)), cavity);
        }

        const scatterMul = float(1.0).add(uShaftScatterBoost);
        const color = caColor.add(bloomPass.mul(scatterMul));

        const luminanceWeight = vec3(0.299, 0.587, 0.114);
        const lum = color.xyz.dot(luminanceWeight);
        const grayscale = vec3(lum);
        let satColor = mix(grayscale, color.xyz, uColorSaturation);

        const midPoint = vec3(0.5);
        satColor = satColor
            .sub(midPoint)
            .mul(uColorContrast)
            .add(midPoint) as unknown as ReturnType<typeof mix>;

        const dist = distance(uvNode, vec2(0.5, 0.5));
        const vig = float(1.0).sub(smoothstep(0.2, 1.0, dist));
        const vignetteMultiplier = mix(float(1.0), vig, uVignetteStrength);
        satColor = satColor.mul(vignetteMultiplier) as unknown as ReturnType<typeof mix>;

        return satColor;
    });

    postProcessing.outputNode = colorCorrection();

    const syncSize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        postProcessing.needsUpdate = true;
    };

    window.addEventListener('resize', syncSize);

    return {
        render: () => {
            postProcessing.render();
        },
        syncSize,
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
