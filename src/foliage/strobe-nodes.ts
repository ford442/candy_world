import {
    vec3,
    float,
    uniform,
    time,
    sin,
    mix,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

// Global uniform for Strobe Sickness intensity
export const uStrobeIntensity = uniform(0.0);

/**
 * Mix a scene color toward a white flicker. Used by the WebGPU post graph
 * (no framebuffer copy) and the WebGL camera overlay.
 */
export function mixStrobeFlash(sceneRgb: Node<'vec3'>): Node<'vec3'> {
    const strobeFreq = float(40.0);
    const strobeOscillation = sin(time.mul(strobeFreq)).mul(0.5).add(0.5);
    const flashColor = vec3(1.0, 1.0, 1.0);
    const effectiveStrength = uStrobeIntensity.mul(strobeOscillation);
    return mix(sceneRgb, flashColor, effectiveStrength) as Node<'vec3'>;
}
