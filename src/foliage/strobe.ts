import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    vec3,
    vec4,
    float,
    uniform,
    viewportSharedTexture,
    screenUV,
    time,
    sin,
    mix,
} from 'three/tsl';

// Global uniform for Strobe Sickness intensity
export const uStrobeIntensity = uniform(0.0);

/**
 * Creates a Strobe Sickness HUD Flicker effect.
 * This function returns a mesh that should be added to the camera or scene
 * to create a full-screen strobe effect (HUD flicker).
 *
 * It uses `viewportSharedTexture` to sample the scene behind the object.
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

        // Sample the viewport texture
        const baseColor = viewportSharedTexture(baseUV);

        // Calculate high-frequency flicker using time
        // sin(time * freq) gives a value between -1 and 1
        // We remap it to 0.0 -> 1.0
        const strobeFreq = float(40.0);
        const strobeOscillation = sin(time.mul(strobeFreq)).mul(0.5).add(0.5);

        // The target strobe color is white (intense flash)
        const flashColor = vec3(1.0, 1.0, 1.0);

        // The effective strength combines the global uStrobeIntensity and the oscillation
        const effectiveStrength = uStrobeIntensity.mul(strobeOscillation);

        // Mix the original color with the flash color
        const finalColor = mix(baseColor.xyz, flashColor, effectiveStrength);

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
