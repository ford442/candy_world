// src/foliage/stars.js

import * as THREE from 'three';
import { color, float, vec3, vec4, time, positionLocal, attribute, uniform, mix, length, sin, cos } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';

// Global uniform for star pulse (driven by music)
export const uStarPulse = uniform(0.0); // 0 to 1
export const uStarColor = uniform(new THREE.Color(0xFFFFFF));
export const uStarOpacity = uniform(0.0); 

// TSL-FIXED
export function createStars(count = 1500) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);

    const radius = 400;

    for (let i = 0; i < count; i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);

        const r = radius * (0.9 + Math.random() * 0.2);
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        positions[i * 3] = x;
        positions[i * 3 + 1] = Math.abs(y);
        positions[i * 3 + 2] = z;

        normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0;

        sizes[i] = Math.random() * 2.5 + 0.3;
        offsets[i] = Math.random() * 100;
        
        const colorType = Math.random();
        if (colorType < 0.7) {
            colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 1.0;
        } else if (colorType < 0.85) {
            colors[i * 3] = 0.8; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 1.0;
        } else {
            colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 0.7;
        }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('starColor', new THREE.BufferAttribute(colors, 3));

    const mat = new PointsNodeMaterial({
        size: 1.5,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
    });

    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');
    // Attribute 'starColor' is already a vec3 node
    const aStarColor = attribute('starColor', 'vec3');

    // Twinkle logic
    // FIX: Wrap numbers in float()
    const twinkle1 = time.add(aOffset).sin().mul(float(0.3)).add(float(0.5));
    const twinkle2 = time.mul(float(2.3)).add(aOffset.mul(float(0.7))).sin().mul(float(0.2)).add(float(0.5));
    const twinkle = twinkle1.mul(twinkle2);

    const intensity = twinkle.add(uStarPulse.mul(float(1.5))); 

    // Use nodes directly - uStarColor is already a uniform node
    const musicColorVec3 = uStarColor; 

    // Mix factor
    const finalRGB = mix(aStarColor, musicColorVec3, uStarPulse.mul(float(0.8)));

    // FIX: Don't multiply vec4 by color node - just use finalRGB directly with opacity
    // mat.color is a THREE.Color used for fallback/multiplier, already handled by PointsNodeMaterial
    mat.colorNode = finalRGB;
    mat.opacityNode = uStarOpacity;
    
    // FIX: Wrap 0.3 in float()
    mat.sizeNode = aSize.mul(intensity.max(float(0.3)));

    // Star Warp
    const pos = positionLocal;
    const warpFactor = uStarPulse.mul(float(20.0)); 
    const warpedPos = pos.add(pos.normalize().mul(warpFactor));

    // Rotation
    const angle = time.mul(float(0.02));
    const rotatedX = warpedPos.x.mul(cos(angle)).sub(warpedPos.z.mul(sin(angle)));
    const rotatedZ = warpedPos.x.mul(sin(angle)).add(warpedPos.z.mul(cos(angle)));

    mat.positionNode = vec3(rotatedX, warpedPos.y, rotatedZ);

    const stars = new THREE.Points(geo, mat);
    stars.userData.isStars = true;

    return stars;
}
