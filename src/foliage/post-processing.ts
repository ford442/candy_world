/**
 * Post-FX entry. SSR is deferred — see docs/POSTFX_STACK.md.
 * Graphs load via import() and must not import this app chunk (TLA deadlock).
 *
 * One TSL graph serves both backends: the renderer is always `WebGPURenderer`,
 * on WGSL or (under `forceWebGL`) on Three's GLSL node backend.
 */
import type * as THREE from 'three';
import {
    CONFIG,
    isAoEnabled,
    isDofEnabled,
    isDynamicResolutionAllowed,
    isPostStackBypassed,
    resolveAntialiasMode,
} from '../core/config.ts';
import type { CandyRenderer } from '../core/init.ts';
import { getPlatformCapabilities } from '../core/platform/capabilities.ts';
import {
    HDR_ROLLOFF_KNEE,
    onHdrPeakChange,
    readHdrPreference,
} from '../core/platform/hdr-preference.ts';
import { SCENE_PASS_SAMPLES } from '../rendering/gpu-context.ts';
import type { CompileTarget } from '../rendering/shader-warmup.ts';
import * as postFxUniforms from './post-processing-uniforms.ts';

/** What the frame loop, photo mode, warmup and the viewport use. */
export interface PostFxPipeline {
    render(): void;
    /** Called by rendering/viewport.ts after every resize / DPR change. */
    syncSize(): void;
    /** The target the world is drawn into; absent when it is the renderer's own. */
    compileTarget?: () => CompileTarget | null;
    /** GPU frame time (ms) from the timestamp timer; drives dynamic resolution. */
    onGpuFrameTime?: (ms: number) => void;
}

/** The backend records timestamps (timestamp-query requested and granted). */
function tracksGpuTimestamps(renderer: CandyRenderer): boolean {
    return (
        (renderer as { backend?: { trackTimestamp?: boolean } }).backend?.trackTimestamp === true
    );
}

let unbindHdrPeak: (() => void) | null = null;

/**
 * On an extended-range swap chain, seed `uHdrPeak` from the player's
 * preference and follow the accessibility slider live. Null on SDR, which
 * leaves the post graph exactly as it was without HDR. Also null when
 * `init.ts` could not select Display P3 and fell back to sRGB + ACES on the
 * extended swap chain: ACES already bounds the output there.
 */
function bindHdrPeak(renderer: CandyRenderer): { knee: number } | null {
    if (!getPlatformCapabilities().hdr.extendedRange) return null;
    if (renderer.outputColorSpace !== 'display-p3') return null;
    postFxUniforms.uHdrPeak.value = readHdrPreference().peak;
    unbindHdrPeak?.();
    unbindHdrPeak = onHdrPeakChange((peak) => {
        postFxUniforms.uHdrPeak.value = peak;
    });
    return { knee: HDR_ROLLOFF_KNEE };
}

function publishPostFxPasses(count: number): void {
    (globalThis as { __candyPostFxPasses?: number }).__candyPostFxPasses = count;
}

/**
 * WebGL2 draws the scene pass into `rgba16float`, which needs a float colour
 * attachment (`EXT_color_buffer_float`, or `EXT_color_buffer_half_float`).
 * Without one the framebuffer is incomplete and every frame is lost.
 */
function hasFloatColorTargets(renderer: CandyRenderer): boolean {
    const gl = (renderer as { backend?: { gl?: WebGL2RenderingContext } }).backend?.gl;
    if (!gl) return true;
    return (
        gl.getExtension('EXT_color_buffer_float') !== null ||
        gl.getExtension('EXT_color_buffer_half_float') !== null
    );
}

/**
 * No post graph: the world is drawn with `renderer.render()`. Under
 * `?postfx=off` the canvas MSAA `init.ts` enables antialiases it.
 */
function initDirectRender(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    why: string
): PostFxPipeline {
    publishPostFxPasses(0);
    console.log(`[PostFX] ${why} — rendering direct, no post graph`);
    return {
        render: () => renderer.render(scene, camera),
        syncSize: () => {},
    };
}

export async function initPostProcessing(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    mode: 'webgpu' | 'webgl'
): Promise<PostFxPipeline> {
    if (isPostStackBypassed()) return initDirectRender(renderer, scene, camera, '?postfx=off');
    if (mode === 'webgl' && !hasFloatColorTargets(renderer)) {
        return initDirectRender(renderer, scene, camera, 'WebGL2 without float colour targets');
    }

    const { initWebGPUPostProcessing } = await import('./post-processing-webgpu.ts');
    const aoEnabled = isAoEnabled() && mode === 'webgpu';
    const aa = resolveAntialiasMode(mode, aoEnabled);
    return initWebGPUPostProcessing(renderer, scene, camera, {
        aoEnabled,
        dofEnabled: isDofEnabled(),
        dofFocalLength: CONFIG.postfx.dofFocalLength,
        dofBokehScale: CONFIG.postfx.dofBokehScale,
        aoStrength: CONFIG.postfx.aoStrength,
        // Used in `msaa` mode only; WebGL2 defaults to FXAA (see resolveAntialiasMode).
        sceneSamples: SCENE_PASS_SAMPLES,
        aa,
        dynamicResolution:
            mode === 'webgpu' && isDynamicResolutionAllowed() && tracksGpuTimestamps(renderer),
        hdr: mode === 'webgpu' ? bindHdrPeak(renderer) : null,
        u: postFxUniforms,
    });
}
