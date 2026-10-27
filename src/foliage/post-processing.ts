/**
 * Post-FX entry. SSR is deferred — see docs/POSTFX_STACK.md.
 * Graphs load via import() and must not import this app chunk (TLA deadlock).
 *
 * One TSL graph serves both backends: the renderer is always `WebGPURenderer`,
 * on WGSL or (under `forceWebGL`) on Three's GLSL node backend.
 */
import type * as THREE from 'three';
import { CONFIG, isAoEnabled, isDofEnabled, isPostStackBypassed } from '../core/config.ts';
import type { CandyRenderer } from '../core/init.ts';
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
}

function publishPostFxPasses(count: number): void {
    (globalThis as { __candyPostFxPasses?: number }).__candyPostFxPasses = count;
}

/**
 * `?postfx=off`: no post graph. The world is drawn with `renderer.render()`,
 * antialiased by the canvas MSAA `init.ts` enables for this case.
 */
function initDirectRender(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
): PostFxPipeline {
    publishPostFxPasses(0);
    console.log('[PostFX] ?postfx=off — rendering direct, no post graph');
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
    if (isPostStackBypassed()) return initDirectRender(renderer, scene, camera);

    const { initWebGPUPostProcessing } = await import('./post-processing-webgpu.ts');
    return initWebGPUPostProcessing(renderer, scene, camera, {
        aoEnabled: isAoEnabled() && mode === 'webgpu',
        dofEnabled: isDofEnabled(),
        dofAperture: CONFIG.postfx.dofAperture,
        dofMaxBlur: CONFIG.postfx.dofMaxBlur,
        aoStrength: CONFIG.postfx.aoStrength,
        sceneSamples: SCENE_PASS_SAMPLES,
        u: postFxUniforms,
    });
}
