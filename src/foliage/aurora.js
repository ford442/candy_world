// src/foliage/aurora.js

import * as THREE from 'three';
import { color, float, vec3, vec4, time, uv, sin, cos, mix, smoothstep, uniform, Fn, positionWorld } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// Global uniforms for Aurora control
export const uAuroraIntensity = uniform(0.0); // 0.0 to 1.0
export const uAuroraColor = uniform(color(0x00FF99)); // Base color (Greenish default)
export const uAuroraSpeed = uniform(0.2); // Speed of the wave movement

export function createAurora() {
    // Create a tall cylinder for the aurora curtain
    // Radius ~800, Height ~400
    const geometry = new THREE.CylinderGeometry(800, 800, 400, 64, 16, true);
    geometry.translate(0, 300, 0); // Lift it up into the sky

    // TSL Shader Logic
    const mainAurora = Fn(() => {
        const vUv = uv();

        // 1. Curtains / Folds Effect
        // Distort UV.x with sine waves based on time to create "moving folds"
        const timeScaled = time.mul(uAuroraSpeed);

        const wave1 = sin(vUv.x.mul(20.0).add(timeScaled)).mul(0.1);
        const wave2 = sin(vUv.x.mul(45.0).sub(timeScaled.mul(1.5))).mul(0.05);

        const distortedX = vUv.x.add(wave1).add(wave2);

        // 2. Vertical Bands (The "Rays")
        const rayIntensity = sin(distortedX.mul(60.0)).mul(0.5).add(0.5);

        // 3. Vertical Fade (Soft top and bottom)
        // Fade out at bottom (0.0) and top (1.0)
        const verticalFade = smoothstep(0.0, 0.2, vUv.y).mul(smoothstep(1.0, 0.6, vUv.y));

        // 4. Spectral Color Shift
        // Shift color slightly based on height (vertical position) to simulate "pitch" mapping
        const spectralShift = vec3(vUv.y.mul(0.5), 0.0, vUv.y.mul(0.2).negate()); // Shift R up, B down slightly
        const baseColor = vec3(uAuroraColor.r, uAuroraColor.g, uAuroraColor.b);
        const finalColor = baseColor.add(spectralShift);

        // 5. Combine
        // Rays + Folds + Fade + Global Intensity
        const finalAlpha = rayIntensity.mul(verticalFade).mul(uAuroraIntensity).mul(0.6); // Base 0.6 max opacity

        return vec4(finalColor, finalAlpha);
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = mainAurora();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.fog = false; // Aurora usually sits "above" fog or glows through it

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.type = 'aurora';
    mesh.userData.isAurora = true; // Tag for potential specific lookups

    // Disable frustum culling to ensure it's always visible when looking up
    mesh.frustumCulled = false;

    return mesh;
}
