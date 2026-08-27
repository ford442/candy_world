/**
 * Post-FX entry. SSR is deferred — see docs/POSTFX_STACK.md.
 * Graphs load via import() and must not import this app chunk (TLA deadlock).
 */
import type * as THREE from 'three';
import { CONFIG, isAoEnabled, isDofEnabled } from '../core/config.ts';
import type { CandyRenderer } from '../core/init.ts';
import { isWebGPUMode } from '../core/init.ts';
import * as postFxUniforms from './post-processing-uniforms.ts';

export async function initPostProcessing(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    mode: 'webgpu' | 'webgl'
) {
    if (isWebGPUMode(renderer)) {
        const { initWebGPUPostProcessing } = await import('./post-processing-webgpu.ts');
        return initWebGPUPostProcessing(renderer, scene, camera, {
            aoEnabled: isAoEnabled() && mode === 'webgpu',
            dofEnabled: isDofEnabled(),
            dofAperture: CONFIG.postfx.dofAperture,
            dofMaxBlur: CONFIG.postfx.dofMaxBlur,
            aoStrength: CONFIG.postfx.aoStrength,
            u: postFxUniforms,
        });
    }
    const { initWebGLPostProcessing } = await import('./post-processing-webgl.ts');
    return initWebGLPostProcessing(renderer as unknown as THREE.WebGLRenderer, scene, camera, {
        dofEnabled: isDofEnabled(),
        dofFocusDistance: CONFIG.postfx.dofFocusDistance,
        dofAperture: CONFIG.postfx.dofAperture,
        dofMaxBlur: CONFIG.postfx.dofMaxBlur,
        bloomRadius: CONFIG.postfx.bloomRadius,
        bloomThreshold: CONFIG.postfx.bloomThreshold,
        u: postFxUniforms,
    });
}
