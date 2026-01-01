// src/foliage/aurora.js

import * as THREE from 'three';
import {
    color, float, vec3, vec4, time, uv, sin, cos, mix, smoothstep, uniform, Fn, positionWorld,
    mul, add, sub // Functional operators
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// Global uniforms for Aurora control
export const uAuroraIntensity = uniform(0.0); // 0.0 to 1.0
export const uAuroraColor = uniform(new THREE.Color(0x00FF99)); // Base color (Greenish default)
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
        const timeScaled = mul(time, uAuroraSpeed);

        // wave1 = sin(vUv.x * 20.0 + timeScaled) * 0.1
        const wave1 = mul(sin(add(mul(vUv.x, 20.0), timeScaled)), 0.1);

        // wave2 = sin(vUv.x * 45.0 - timeScaled * 1.5) * 0.05
        const wave2 = mul(sin(sub(mul(vUv.x, 45.0), mul(timeScaled, 1.5))), 0.05);

        // distortedX = vUv.x + wave1 + wave2
        const distortedX = add(add(vUv.x, wave1), wave2);

        // 2. Vertical Bands (The "Rays")
        // sin(distortedX * 60.0) * 0.5 + 0.5
        const rayIntensity = add(mul(sin(mul(distortedX, 60.0)), 0.5), 0.5);

        // 3. Vertical Fade (Soft top and bottom)
        // Fade out at bottom (0.0) and top (1.0)
        const verticalFade = mul(smoothstep(0.0, 0.2, vUv.y), smoothstep(1.0, 0.6, vUv.y));

        // 4. Spectral Color Shift
        // Shift color slightly based on height (vertical position) to simulate "pitch" mapping
        const spectralShift = vec3(mul(vUv.y, 0.5), 0.0, mul(vUv.y, 0.2).negate()); // Shift R up, B down slightly
        const baseColor = vec3(uAuroraColor.r, uAuroraColor.g, uAuroraColor.b);
        const finalColor = add(baseColor, spectralShift);

        // 5. Combine
        // Rays + Folds + Fade + Global Intensity
        const finalAlpha = mul(mul(mul(rayIntensity, verticalFade), uAuroraIntensity), 0.6); // Base 0.6 max opacity

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
