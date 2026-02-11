// src/foliage/aurora.ts

import * as THREE from 'three';
import { color, float, vec3, vec4, uv, mix, smoothstep, uniform, Fn, time, mx_noise_float } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { uAudioLow, uAudioHigh } from './common.ts';

// Global uniforms for Aurora control
export const uAuroraIntensity = uniform(0.0); // 0.0 to 1.0
export const uAuroraColor = uniform(color(0x00FF99)); // Base color (Greenish default)
export const uAuroraSpeed = uniform(0.2); // Speed of the wave movement

export function createAurora(): THREE.Mesh {
    // Create a tall cylinder for the aurora curtain
    // Radius ~800, Height ~500, High segment count for smooth waves
    const geometry = new THREE.CylinderGeometry(800, 800, 500, 128, 32, true);
    geometry.translate(0, 300, 0); // Lift it up into the sky

    // TSL Shader Logic
    const mainAurora = Fn(() => {
        const vUv = uv();

        // 1. Organic Curtain Movement (Noise-based)
        // Displace UVs with noise to create "folds"
        // Bass boosts speed slightly
        const timeScaled = time.mul(uAuroraSpeed.add(uAudioLow.mul(0.1)));

        // Large slow wave
        const noise1 = mx_noise_float(vec3(vUv.x.mul(5.0), timeScaled.mul(0.5), float(0.0)));
        // Smaller fast ripple
        const noise2 = mx_noise_float(vec3(vUv.x.mul(15.0).add(noise1), timeScaled.mul(1.5), float(0.0)));

        const distortedX = vUv.x.add(noise1.mul(0.2)).add(noise2.mul(0.1));

        // 2. Vertical Rays
        // High frequency noise for the "curtain rays"
        const rayNoise = mx_noise_float(vec3(distortedX.mul(30.0), float(0.0), float(0.0)));
        const rayIntensity = smoothstep(0.3, 0.7, rayNoise).mul(0.8).add(0.2);

        // 3. Audio Reactivity (Juice)
        // Bass pushes the curtain "up" (modulates vertical fade)
        const bassLift = uAudioLow.mul(0.2);

        // Treble adds "sparkle" or "shimmer" to the rays
        const shimmer = uAudioHigh.mul(mx_noise_float(vec3(vUv.x.mul(100.0), time.mul(5.0), vUv.y)));

        // 4. Vertical Fade (Soft top and bottom)
        const bottomFade = smoothstep(0.0, 0.3, vUv.y.add(bassLift));
        const topFade = float(1.0).sub(smoothstep(0.7, 1.0, vUv.y));
        const verticalFade = bottomFade.mul(topFade);

        // 5. Spectral Color Shift
        // Base color mixed with a "Magic" color (Purple/Pink) based on height and Audio
        const magicColor = color(0x9933FF);
        // More purple when bass hits or at top
        const colorMix = vUv.y.mul(0.5).add(uAudioLow.mul(0.4)).min(1.0);

        const finalColorRGB = mix(uAuroraColor, magicColor, colorMix);

        // 6. Combine
        // Rays + Shimmer + Fade + Global Intensity
        const combinedIntensity = rayIntensity.add(shimmer).mul(verticalFade).mul(uAuroraIntensity);

        return vec4(finalColorRGB, combinedIntensity);
    });

    const material = new MeshBasicNodeMaterial();
    material.colorNode = mainAurora();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.fog = false; // Aurora glows through fog

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.type = 'aurora';
    mesh.frustumCulled = false; // Always visible in sky

    return mesh;
}
