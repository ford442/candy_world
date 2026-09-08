import * as THREE from 'three';
import {
    Fn,
    vec4,
    viewportSharedTexture,
    screenUV,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { uStrobeIntensity, mixStrobeFlash } from './strobe-nodes.ts';

export { uStrobeIntensity, mixStrobeFlash };

/**
 * Creates a Strobe Sickness HUD Flicker effect.
 * WebGL / GLSL-node path only — WebGPU applies `mixStrobeFlash` in the TSL
 * post graph to avoid rgba16float → rgba8unorm framebuffer copies.
 *
 * @returns {THREE.Mesh} The full-screen quad mesh.
 */
export function createStrobePulse(): THREE.Mesh {
    // Create a full-screen quad geometry
    const geometry = new THREE.PlaneGeometry(2, 2);

    // --- TSL Shader Logic ---
    const strobeEffect = Fn(() => {
        // Base UVs for screen sampling
        const baseUV = screenUV; // Use screenUV for viewport-correct sampling

        const baseColor = viewportSharedTexture(baseUV as any);
        const finalColor = mixStrobeFlash(baseColor.xyz as any);
        return vec4(finalColor, 1.0);
    });

    // Use MeshBasicNodeMaterial to ensure the overlay is unlit and displays exactly as calculated
    const material = new MeshBasicNodeMaterial();
    material.colorNode = strobeEffect();

    // Ensure it renders on top of everything else (Post-Processing simulation)
    // We set depthTest/depthWrite to false so it doesn't mess with depth buffer
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true; // Technically opaque output, but good for overlay behavior

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // Always render
    mesh.renderOrder = 9998; // Render just before chromatic pulse if both exist, or similar order
    mesh.userData.isFullScreenEffect = true;

    // Position in front of camera (assuming attached to camera)
    // z = -1.0 is comfortably inside the frustum (near usually 0.1)
    mesh.position.set(0, 0, -1.0);

    // Scale up to cover screen even at ultra-wide aspect ratios
    mesh.scale.set(10, 10, 1);

    return mesh;
}
