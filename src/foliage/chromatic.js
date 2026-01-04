
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    vec2,
    vec3,
    vec4,
    float,
    uv,
    mix,
    sin,
    cos,
    uniform,
    viewportSharedTexture,
    screenUV,
    positionLocal,
    positionWorld,
    cameraPosition
} from 'three/tsl';

// Global uniform for Chromatic Pulse intensity
export const uChromaticIntensity = uniform(0.0);

/**
 * Creates a Chromatic Aberration Pulse effect.
 * This function returns a mesh that should be added to the camera or scene
 * to create a full-screen distortion effect.
 *
 * It uses `viewportSharedTexture` to sample the scene behind the object.
 *
 * @returns {THREE.Mesh} The full-screen quad mesh.
 */
export function createChromaticPulse() {
    // Create a full-screen quad geometry
    const geometry = new THREE.PlaneGeometry(2, 2);

    // --- TSL Shader Logic ---
    const chromaticEffect = Fn(() => {
        // Base UVs for screen sampling
        const baseUV = screenUV; // Use screenUV for viewport-correct sampling

        // 1. Barrel Distortion based on intensity
        // Center UVs around (0,0) for distortion
        const centeredUV = baseUV.sub(0.5);
        const dist = centeredUV.length();

        // Barrel distortion formula: uv = uv * (1 + k * r^2)
        // We modulate 'k' with intensity
        const distortionStrength = uChromaticIntensity.mul(0.5); // Max distortion factor
        const distortion = float(1.0).add(dist.mul(dist).mul(distortionStrength));

        const distortedUV = centeredUV.mul(distortion).add(0.5);

        // 2. Chromatic Aberration (RGB Split)
        // Offset Red and Blue channels in opposite directions relative to the center
        const offsetDir = centeredUV.normalize();
        const aberrationAmount = uChromaticIntensity.mul(0.02); // 2% screen width max offset

        const redUV = distortedUV.sub(offsetDir.mul(aberrationAmount));
        const blueUV = distortedUV.add(offsetDir.mul(aberrationAmount));
        const greenUV = distortedUV; // Green stays center

        // Sample the viewport texture
        // Note: viewportSharedTexture takes UVs as input if provided?
        // Checking docs/usage: viewportSharedTexture( uv )
        const r = viewportSharedTexture(redUV).r;
        const g = viewportSharedTexture(greenUV).g;
        const b = viewportSharedTexture(blueUV).b;

        // Combine channels
        const finalColor = vec3(r, g, b);

        return vec4(finalColor, 1.0);
    });

    // Use MeshBasicNodeMaterial to ensure the overlay is unlit and displays exactly as calculated
    const material = new MeshBasicNodeMaterial();
    material.colorNode = chromaticEffect();

    // Ensure it renders on top of everything else (Post-Processing simulation)
    // We set depthTest/depthWrite to false so it doesn't mess with depth buffer
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true; // Technically opaque output, but good for overlay behavior

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // Always render
    mesh.renderOrder = 9999; // Render last
    mesh.userData.isFullScreenEffect = true;

    // Position in front of camera (assuming attached to camera)
    // z = -1.0 is comfortably inside the frustum (near usually 0.1)
    mesh.position.set(0, 0, -1.0);

    // Scale up to cover screen even at ultra-wide aspect ratios
    // At z=-1, height coverage is ~1.5 (for FOV 75).
    // Width coverage for 32:9 aspect (super ultrawide) is ~5.3.
    // Scale by 10 is excessively safe.
    mesh.scale.set(10, 10, 1);

    return mesh;
}
