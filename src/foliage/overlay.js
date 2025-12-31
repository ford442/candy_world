
import * as THREE from 'three';
import {
    float, vec3, Fn, uniform, uv,
    mix, sin, cos, positionLocal
} from 'three/tsl';
import { CandyPresets } from './common.js';

// Global uniform for Kick Intensity (driven by BeatSync in main.js)
export const uKickIntensity = uniform(0.0);

/**
 * Creates a "Kick Overlay" - a lens in front of the camera that distorts the view
 * on heavy kicks, simulating Chromatic Aberration Pulse.
 *
 * Strategy:
 * Use a Mesh with Transmission (Glass).
 * Use IOR ~1.0 (air) normally.
 * On Kick, increase Thickness or modify Normal to bend light.
 * Ideally, we'd split RGB, but Transmission usually just refracts the whole image.
 * To get RGB split (Chromatic Aberration), we need 'iridescence' or dispersion.
 * Three.js standard transmission doesn't support dispersion (yet).
 *
 * Alternative:
 * Use the 'Iridescence' parameter of MeshStandardNodeMaterial to add rainbow fringes.
 * And 'Thickness' distortion to warp the image.
 */
export function createKickOverlay(camera) {
    // 1. Create a plane that covers the camera view
    // Placed at z = -1 (in front of camera).
    // Size needs to cover the frustum at that distance.
    // Tan(FOV/2) logic.
    const fov = camera.fov * (Math.PI / 180);
    const height = 2 * Math.tan(fov / 2) * 1.1; // * distance (1.0)
    const width = height * camera.aspect;

    const geometry = new THREE.PlaneGeometry(width * 2, height * 2); // Oversize to be safe

    // 2. Material: Invisible Glass that warps
    // We use 'CandyPresets.Crystal' but tweaked for invisibility
    const mat = CandyPresets.Crystal(0xFFFFFF, {
        transmission: 1.0,  // Fully transparent glass
        roughness: 0.0,
        ior: 1.0,           // No refraction by default (Air)
        thickness: 0.0,     // No thickness
        iridescenceStrength: 0.0, // No rainbows by default
    });

    // 3. Bind Reactivity to uKickIntensity

    // A) Refraction Pulse (Warp)
    // We modulate IOR or Thickness.
    // Modulating IOR from 1.0 to 1.1 on kick.
    // Using TSL to bind uniform.
    // Note: 'ior' in createUnifiedMaterial is a float, but we can assign a Node if we modify it.
    // CandyPresets returns a material with .iorNode set.

    // Warping IOR based on radial distance from center?
    // Let's just warp the whole thing or use a normal map.
    // Better: Perturb Normal based on UV distance from center + Kick.

    const centeredUV = uv().sub(0.5);
    const dist = centeredUV.length();

    // Radial distortion strength: stronger at edges
    const warpStrength = dist.mul(uKickIntensity).mul(0.5);

    // Perturb normal away from center
    // Normal is (0,0,1) in local space. We add (x, y, 0).
    const warpDir = vec3(centeredUV.x, centeredUV.y, 0.0);
    // mat.normalNode is usually in Tangent or World space depending on context?
    // UnifiedMaterial uses 'normalNode' assigned to 'perturbNormal' result (World Space typically).
    // Let's override normalNode carefully.

    // We add a wobble to the existing normal (which is flat for a plane).
    // Local Normal: (0, 0, 1)
    // Distorted: (x*k, y*k, 1)
    // We can use 'normalMap' logic essentially.

    // Since we are parented to camera, World Normal is mostly -Z (or +Z depending on look).
    // Let's operate in View Space or just assume planar.

    // Simpler: Just modulate IOR.
    // Kick 0 -> IOR 1.0
    // Kick 1 -> IOR 1.2
    mat.iorNode = float(1.0).add(uKickIntensity.mul(0.3));

    // B) Chromatic Aberration (Iridescence)
    // Kick 0 -> Iridescence 0.0
    // Kick 1 -> Iridescence 1.0
    mat.iridescenceNode = uKickIntensity;
    mat.iridescenceIORNode = float(1.5);
    mat.iridescenceThicknessNode = float(400); // Thin film

    // C) Thickness for absorption/distortion
    mat.thicknessNode = uKickIntensity.mul(2.0);

    // D) Color Tint (Red/Magenta on kick)
    // Mix white (transparent) with Red based on Kick
    // But transmission absorbs color.
    // We want the glass itself to be clear.

    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(0, 0, -1); // 1 meter in front of camera
    mesh.renderOrder = 9999; // Render last (on top)

    // Parenting:
    camera.add(mesh);

    return mesh;
}
