/**
 * TSL post graph (bloom, optional DoF, optional GTAO), on the WGSL backend and
 * on the GLSL node backend (`forceWebGL`) alike.
 * No imports from the app chunk — bootstrap TLA would deadlock.
 * SSR is not in this graph (env-map mirrors; see docs/POSTFX_STACK.md).
 */
import * as THREE from 'three';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { pass, mix, vec3, uniform, Fn, float, uv, vec2, distance, smoothstep } from 'three/tsl';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { candyPulseWarpUv, gradeCandyGlowPulse } from './chromatic-nodes.ts';
import type * as postFxUniforms from './post-processing-uniforms.ts';
import { mixStrobeFlash } from './strobe-nodes.ts';
import type { Node } from 'three/webgpu';

type U = typeof postFxUniforms;

function publishPostFxPasses(count: number): void {
    (globalThis as { __candyPostFxPasses?: number }).__candyPostFxPasses = count;
}

export function initWebGPUPostProcessing(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: {
        aoEnabled: boolean;
        dofEnabled: boolean;
        dofFocalLength: number;
        dofBokehScale: number;
        aoStrength: number;
        /** MSAA on the scene pass (the caller passes 0 on the GLSL backend). */
        sceneSamples: number;
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

    const postProcessing = new RenderPipeline(renderer);
    // Samples are set here, not inherited from `renderer.samples`: the canvas
    // is created without MSAA because only the post quad is drawn into it.
    const scenePass = pass(scene, camera, { samples: opts.sceneSamples });

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
            uniform(opts.dofFocalLength),
            uniform(opts.dofBokehScale)
        );
        console.log('[PostFX] Depth of Field enabled (WebGPU TSL bokeh)');
    }

    // Pass count for the ?debug=1 systems-budget readout (scene + bloom are
    // always present; DoF / GTAO are tier-gated).
    publishPostFxPasses(2 + (opts.dofEnabled ? 1 : 0) + (opts.aoEnabled ? 1 : 0));

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
        const warpedUV = candyPulseWarpUv(uvNode as Node<'vec2'>);
        const scatterAmt = uShaftScatterBoost.mul(0.018);

        const sceneTex = scenePass.getTextureNode();
        const sampleScene = (coords: Node<'vec2'>) => {
            const uvScatter = mix(coords, vec2(0.5, 0.5), scatterAmt);
            const sampledR = sceneTex.sample(uvScatter.add(vec2(caOffset, 0.0)) as Node<'vec2'>).r;
            const sampledG = sceneTex.sample(uvScatter as Node<'vec2'>).g;
            const sampledB = sceneTex.sample(uvScatter.sub(vec2(caOffset, 0.0)) as Node<'vec2'>).b;
            return vec3(sampledR, sampledG, sampledB);
        };

        const pulseDist = warpedUV.sub(0.5).length();
        let caColor = gradeCandyGlowPulse(
            sampleScene,
            warpedUV,
            pulseDist as Node<'float'>,
            opts.u.uPulseNoteColor as any,
            opts.u.uPulseShimmer as any
        );

        if (dofColorNode) {
            // dof() returns the effect node; it outputs the blurred colour (vec4).
            caColor = mix(caColor, (dofColorNode as unknown as Node<'vec4'>).rgb, uDofMix);
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
            .add(midPoint) as unknown as Node<'vec3'>;

        const dist = distance(uvNode, vec2(0.5, 0.5));
        const vig = float(1.0).sub(smoothstep(0.2, 1.0, dist));
        const vignetteMultiplier = mix(float(1.0), vig, uVignetteStrength);
        satColor = satColor.mul(vignetteMultiplier) as unknown as Node<'vec3'>;

        return mixStrobeFlash(satColor as Node<'vec3'>);
    });

    postProcessing.outputNode = colorCorrection();

    // Renderer size and pixel ratio belong to rendering/viewport.ts, which
    // calls this after every resize (scene-pipeline subscribes it).
    const syncSize = () => {
        postProcessing.needsUpdate = true;
    };

    /**
     * The target (and MRT) the scene pass draws the world into, for
     * `compileSceneProgressively`. Samples mirror `PassNode.setup()`, which
     * only runs on the first post-FX render: compiling before it with the
     * target's default 0 samples would build pipelines the frame cannot use.
     */
    const compileTarget = () => {
        const passNode = scenePass as unknown as {
            renderTarget: THREE.RenderTarget;
            options: { samples?: number };
            getMRT(): unknown;
        };
        const target = passNode.renderTarget;
        target.samples = passNode.options.samples ?? 0;
        return { renderTarget: target, mrt: passNode.getMRT() };
    };

    return {
        render: () => {
            postProcessing.render();
        },
        syncSize,
        compileTarget,
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
