/**
 * WebGPU TSL post graph (bloom, optional DoF, optional GTAO).
 * No imports from the app chunk — bootstrap TLA would deadlock.
 * SSR is not in this graph (env-map mirrors; see docs/POSTFX_STACK.md).
 */
import * as THREE from 'three';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { pass, mix, vec3, uniform, Fn, float, uv, vec2, distance, smoothstep } from 'three/tsl';
import { PostProcessing, WebGPURenderer } from 'three/webgpu';
import { candyPulseWarpUv, gradeCandyGlowPulse } from './chromatic.ts';
import type * as postFxUniforms from './post-processing-uniforms.ts';
import { mixStrobeFlash } from './strobe.ts';

type U = typeof postFxUniforms;

export function initWebGPUPostProcessing(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: {
        aoEnabled: boolean;
        dofEnabled: boolean;
        dofAperture: number;
        dofMaxBlur: number;
        aoStrength: number;
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

    const postProcessing = new PostProcessing(renderer);
    const scenePass = pass(scene, camera);

    const bloomPass = bloom(
        scenePass,
        uBloomStrength as unknown as number,
        uBloomRadius as unknown as number,
        uBloomThreshold as unknown as number
    );

    let dofColorNode: ReturnType<typeof dof> | null = null;
    if (opts.dofEnabled) {
        const viewZ = scenePass.getViewZNode();
        dofColorNode = dof(
            scenePass,
            viewZ,
            uDofFocus,
            uniform(opts.dofAperture),
            uniform(opts.dofMaxBlur)
        );
        console.log('[PostFX] Depth of Field enabled (WebGPU TSL bokeh)');
    }

    let aoPass: ReturnType<typeof ao> | null = null;
    if (opts.aoEnabled && camera instanceof THREE.PerspectiveCamera) {
        aoPass = ao(scenePass.getTextureNode('depth'), null as never, camera);
        aoPass.resolutionScale = 0.5;
        aoPass.samples.value = 8;
        aoPass.radius.value = 0.4;
        aoPass.scale.value = 0.65;
        uAoStrength.value = opts.aoStrength;
        console.log('[PostFX] GTAO enabled (WebGPU, candy-soft, half-res)');
    } else {
        uAoStrength.value = 0;
    }

    const colorCorrection = Fn(() => {
        const caOffset = uAberrationStrength.mul(0.3);
        const uvNode = uv();
        const warpedUV = candyPulseWarpUv(uvNode as ReturnType<typeof vec2>);
        const scatterAmt = uShaftScatterBoost.mul(0.018);

        const sceneTex = scenePass.getTextureNode() as unknown as {
            uv: (coords: ReturnType<typeof vec2>) => ReturnType<typeof vec3>;
        };
        const sampleScene = (coords: ReturnType<typeof vec2>) => {
            const uvScatter = mix(coords, vec2(0.5, 0.5), scatterAmt);
            const sampledR = sceneTex.uv(uvScatter.add(vec2(caOffset, 0.0)) as ReturnType<typeof vec2>).r;
            const sampledG = sceneTex.uv(uvScatter as ReturnType<typeof vec2>).g;
            const sampledB = sceneTex.uv(
                uvScatter.sub(vec2(caOffset, 0.0)) as ReturnType<typeof vec2>
            ).b;
            return vec3(sampledR, sampledG, sampledB);
        };

        const pulseDist = warpedUV.sub(0.5).length();
        let caColor = gradeCandyGlowPulse(
            sampleScene,
            warpedUV,
            pulseDist as ReturnType<typeof float>
        );

        if (dofColorNode) {
            caColor = mix(caColor, dofColorNode.rgb, uDofMix);
        }

        if (aoPass) {
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

        return mixStrobeFlash(satColor as ReturnType<typeof vec3>);
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
