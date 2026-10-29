/**
 * TSL post graph (bloom, optional DoF, optional GTAO, antialiasing, dynamic
 * resolution), on the WGSL backend and on the GLSL node backend (`forceWebGL`)
 * alike. No imports from the app chunk — bootstrap TLA would deadlock.
 * SSR is not in this graph (env-map mirrors; see docs/POSTFX_STACK.md).
 */
import * as THREE from 'three';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { fsr1 } from 'three/addons/tsl/display/FSR1Node.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import {
    pass,
    mix,
    vec3,
    uniform,
    Fn,
    float,
    uv,
    vec2,
    distance,
    smoothstep,
    mrt,
    output,
    velocity,
    normalView,
    renderOutput,
} from 'three/tsl';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { AntialiasMode } from '../core/config/postfx.ts';
import {
    createDynamicResolution,
    defaultDynamicResolutionConfig,
    type DynamicResolution,
} from '../rendering/dynamic-resolution.ts';
import { candyPulseWarpUv, gradeCandyGlowPulse } from './chromatic-nodes.ts';
import type * as postFxUniforms from './post-processing-uniforms.ts';
import { mixStrobeFlash } from './strobe-nodes.ts';

type U = typeof postFxUniforms;

/** What the ?debug=1 systems-budget row and the walk-around harness read. */
export interface PostFxState {
    passes: number;
    aa: AntialiasMode;
    /** Scene-pass resolution scale (1 unless dynamic resolution dropped it). */
    renderScale: number;
    dynamicResolution: boolean;
    /** Last GPU frame time fed to dynamic resolution, ms. */
    gpuMs: number | null;
}

function publishPostFx(state: PostFxState): void {
    const g = globalThis as { __candyPostFxPasses?: number; __candyPostFx?: PostFxState };
    g.__candyPostFxPasses = state.passes;
    g.__candyPostFx = state;
}

/**
 * The texture an effect node renders into, to sample at arbitrary UVs (the
 * composite's chromatic offsets). TRAA / TAA-U / FSR 1 have `getTextureNode()`;
 * three's types omit it.
 */
function textureOf(effect: unknown): Node {
    return (effect as { getTextureNode(): Node }).getTextureNode();
}

/** Extra fullscreen passes each AA mode adds (for the pass-count readout). */
const AA_PASSES: Readonly<Record<AntialiasMode, number>> = {
    off: 0,
    msaa: 0,
    fxaa: 2, // the tone-mapped composite to a texture, then FXAA
    smaa: 4, // the composite, then edges, weights, blend
    traa: 1,
};

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
        /** MSAA samples for `msaa` mode (the scene pass gets 0 in every other mode). */
        sceneSamples: number;
        aa: AntialiasMode;
        /** Scale the scene pass from GPU frame times (needs timestamp-query). */
        dynamicResolution: boolean;
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
    const { aa } = opts;
    // Samples are set here, not inherited from `renderer.samples`: the canvas
    // is created without MSAA because only the post quad is drawn into it.
    // TRAA reprojects a jittered, single-sample image; MSAA under it is waste.
    const scenePass = pass(scene, camera, { samples: aa === 'msaa' ? opts.sceneSamples : 0 });

    // TRAA (and TAA-U) reproject with per-pixel motion. The same MRT carries
    // view normals, so GTAO samples them instead of rebuilding them from depth.
    const temporal = aa === 'traa';
    if (temporal) {
        scenePass.setMRT(mrt({ output, velocity, normal: normalView }));
    }

    // The colour the composite samples: the scene pass, its temporal resolve,
    // or (dynamic resolution) its FSR 1 upscale to the drawing buffer.
    let sceneColor: Node = scenePass.getTextureNode();
    let extraPasses = AA_PASSES[aa];
    if (temporal) {
        const resolve = opts.dynamicResolution ? taau : traa;
        sceneColor = textureOf(
            resolve(
                scenePass.getTextureNode(),
                scenePass.getTextureNode('depth'),
                scenePass.getTextureNode('velocity'),
                camera
            )
        );
    } else if (opts.dynamicResolution) {
        sceneColor = textureOf(fsr1(scenePass));
        extraPasses += 2; // EASU + RCAS
    }

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
    // always present; DoF / GTAO are tier-gated, AA / upscaling by mode).
    const state: PostFxState = {
        passes: 2 + (opts.dofEnabled ? 1 : 0) + (opts.aoEnabled ? 1 : 0) + extraPasses,
        aa,
        renderScale: 1,
        dynamicResolution: opts.dynamicResolution,
        gpuMs: null,
    };
    publishPostFx(state);

    let aoPass: ReturnType<typeof ao> | null = null;
    if (opts.aoEnabled && camera instanceof THREE.PerspectiveCamera) {
        // With the temporal MRT, view normals come from the scene pass; without
        // it GTAO reconstructs them from depth (normalNode null).
        const normals = temporal ? scenePass.getTextureNode('normal') : null;
        aoPass = ao(scenePass.getTextureNode('depth'), normals as never, camera);
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

        const sceneTex = sceneColor as Node<'vec4'> & { sample(uv: Node<'vec2'>): Node<'vec4'> };
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

    const composite = colorCorrection();
    if (aa === 'fxaa' || aa === 'smaa') {
        // Post-AA works on the display image: tone map and convert first, then
        // antialias, and do not let the pipeline convert a second time.
        postProcessing.outputColorTransform = false;
        const display = renderOutput(composite);
        postProcessing.outputNode = aa === 'fxaa' ? fxaa(display) : smaa(display);
    } else {
        postProcessing.outputNode = composite;
    }

    // Dynamic resolution: GPU frame times in, scene-pass resolution scale out.
    let dynamicResolution: DynamicResolution | null = null;
    if (opts.dynamicResolution) {
        dynamicResolution = createDynamicResolution((scale) => {
            scenePass.setResolutionScale(scale);
            state.renderScale = scale;
            publishPostFx(state);
        }, defaultDynamicResolutionConfig());
        console.log(
            `[PostFX] Dynamic resolution on: scene pass ${dynamicResolution.config.minScale}–1×, ` +
                `GPU budget ${dynamicResolution.config.budgetMs} ms, upscale ${temporal ? 'TAA-U' : 'FSR 1'}`
        );
    }
    console.log(`[PostFX] Antialiasing: ${aa}`);

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
     *
     * None under TRAA. r186 builds node materials asynchronously, and each
     * build reads `renderer.getMRT()` when it gets to `NodeMaterial.setup()`;
     * the warmup hands the frame its own target back before those builds
     * finish (holding it would send the frames in between to the wrong
     * target), so the later ones came out single-output and were cached for
     * the MRT context: their pipelines failed for the whole session. The MRT
     * variants compile on first draw instead.
     */
    const compileTarget = () => {
        if (temporal) return null;
        const passNode = scenePass as unknown as {
            renderTarget: THREE.RenderTarget;
            options: { samples?: number };
            getMRT(): unknown;
        };
        const target = passNode.renderTarget;
        target.samples = passNode.options.samples ?? 0;
        return { renderTarget: target, mrt: passNode.getMRT() };
    };

    /** GPU frame time from the frame timer; drives dynamic resolution. */
    const onGpuFrameTime = (ms: number) => {
        state.gpuMs = ms;
        dynamicResolution?.sample(ms);
    };

    return {
        render: () => {
            postProcessing.render();
        },
        syncSize,
        compileTarget,
        onGpuFrameTime,
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
