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
    const geometry = new THREE.CylinderGeometry(800, 800, 400, 64, 16, true);
    geometry.translate(0, 300, 0); // Lift it up into the sky

    // TSL Shader Logic
    const mainAurora = Fn(() => {
        const vUv = uv();

        // 1. Curtains / Folds Effect
        const timeScaled = mul(time, uAuroraSpeed);

        const wave1 = mul(sin(add(mul(vUv.x, 20.0), timeScaled)), 0.1);
        const wave2 = mul(sin(sub(mul(vUv.x, 45.0), mul(timeScaled, 1.5))), 0.05);

        const distortedX = add(add(vUv.x, wave1), wave2);

        // 2. Vertical Bands (The "Rays")
        const rayIntensity = add(mul(sin(mul(distortedX, 60.0)), 0.5), 0.5);

        // 3. Vertical Fade (Soft top and bottom)
        const verticalFade = mul(smoothstep(0.0, 0.2, vUv.y), smoothstep(1.0, 0.6, vUv.y));

        // 4. Spectral Color Shift
        // FIX: Wrap 0.0 in float(0.0). TSL vec3 cannot mix Nodes and raw numbers.
        const spectralShift = vec3(mul(vUv.y, 0.5), float(0.0), mul(vUv.y, 0.2).negate()); 
        
        // Use uniform directly as vec3 node
        const baseColor = vec3(uAuroraColor);
        const finalColor = add(baseColor, spectralShift);

        // 5. Combine
        const finalAlpha = mul(mul(mul(rayIntensity, verticalFade), uAuroraIntensity), 0.6); 

        return vec4(finalColor, finalAlpha);
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = mainAurora();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.fog = false; 

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.type = 'aurora';
    mesh.userData.isAurora = true; 
    mesh.frustumCulled = false;

    return mesh;
}
