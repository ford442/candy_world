/**
 * Post-FX entry. SSR is deferred — see docs/POSTFX_STACK.md.
 * CandyRenderer is always WebGPURenderer; `mode` only gates GTAO (not the graph).
 */
import type * as THREE from 'three';
import type { CandyRenderer } from '../core/init.ts';
import { isWebGPUMode } from '../core/init.ts';

export async function initPostProcessing(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    mode: 'webgpu' | 'webgl'
) {
    if (isWebGPUMode(renderer)) {
        const { initWebGPUPostProcessing } = await import('./post-processing-webgpu.ts');
        return initWebGPUPostProcessing(renderer, scene, camera, mode);
    }
    const { initWebGLPostProcessing } = await import('./post-processing-webgl.ts');
    return initWebGLPostProcessing(renderer, scene, camera);
}
