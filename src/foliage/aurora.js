// src/foliage/aurora.js

import * as THREE from 'three';
import {
    color, float, vec3, vec4, time, uv, sin, cos, mix, smoothstep, uniform, Fn, positionWorld,
    mul, add, sub 
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

export const uAuroraIntensity = uniform(0.0); 
export const uAuroraColor = uniform(new THREE.Color(0x00FF99)); 
export const uAuroraSpeed = uniform(0.2); 

export function createAurora() {
    const geometry = new THREE.CylinderGeometry(800, 800, 400, 64, 16, true);
    geometry.translate(0, 300, 0); 

    const mainAurora = Fn(() => {
        const vUv = uv();
        const timeScaled = mul(time, uAuroraSpeed);

        // FIX: Wrap all raw numbers in float()
        const wave1 = mul(sin(add(mul(vUv.x, float(20.0)), timeScaled)), float(0.1));
        const wave2 = mul(sin(sub(mul(vUv.x, float(45.0)), mul(timeScaled, float(1.5)))), float(0.05));
        const distortedX = add(add(vUv.x, wave1), wave2);

        const rayIntensity = add(mul(sin(mul(distortedX, float(60.0))), float(0.5)), float(0.5));
        
        // FIX: Wrap primitives in float() for smoothstep
        const verticalFade = mul(smoothstep(float(0.0), float(0.2), vUv.y), smoothstep(float(1.0), float(0.6), vUv.y));

        // FIX: Wrap primitives in float() for vec3 and mul
        const spectralShift = vec3(mul(vUv.y, float(0.5)), float(0.0), mul(vUv.y, float(0.2)).negate()); 
        
        // FIX: uAuroraColor is already a uniform node (contains THREE.Color), don't wrap in vec3()
        const baseColor = uAuroraColor; 
        const finalColor = add(baseColor, spectralShift);

        const finalAlpha = mul(mul(mul(rayIntensity, verticalFade), uAuroraIntensity), float(0.6)); 

        return vec4(finalColor, finalAlpha);
    });

    const material = new MeshBasicNodeMaterial();
    
    // FIX: Split the vec4 result into RGB and Alpha
    const auroraNode = mainAurora();
    material.colorNode = auroraNode.xyz;    // Use RGB for color
    material.opacityNode = auroraNode.w;    // Use Alpha for opacity
    
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
