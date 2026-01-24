// src/foliage/stars.js

import * as THREE from 'three';
import { color, float, vec3, vec4, time, positionLocal, attribute, uniform, mix, length, sin, cos } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import { uAudioLow, uAudioHigh } from './common.js';

// Global uniforms
// Removed uStarPulse to fix unison pulsing bug and use direct audio reactivity
export const uStarColor = uniform(color(0xFFFFFF));
export const uStarOpacity = uniform(0.0); // Controls visibility (Day/Night)

export function createStars(count = 1500) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);

    const radius = 400;

    for (let i = 0; i < count; i++) {
        // Random point on sphere
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
        
        // Base natural star colors (White/Blueish/Yellowish)
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
        opacity: 0.0, // Driven by uStarOpacity in TSL
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
    });

    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');
    const aStarColor = attribute('starColor', 'vec3');

    // --- PALETTE: Juicy Star Logic ---

    // 1. Twinkle (High Frequency / Hi-Hats)
    // Driven by Time + Offset + AudioHigh
    // This creates the "glitter" effect
    const twinkleSpeed = time.mul(3.0).add(aOffset); // Faster twinkle
    const baseTwinkle = sin(twinkleSpeed).mul(0.5).add(0.5); // 0..1 sine wave

    // Scale twinkle intensity by Audio Highs (Cymbals/Melody)
    // When music is quiet, they twinkle softly. When loud, they flash.
    const activeTwinkle = baseTwinkle.mul(float(0.8).add(uAudioHigh.mul(4.0)));

    // 2. Pulse Wave (Low Frequency / Kick)
    // Decorrelated Pulse: A wave traveling across the sky
    // positionLocal is roughly sphere radius (400), so we scale it down
    const waveFreq = float(0.02);
    const wavePhase = positionLocal.x.mul(waveFreq).add(positionLocal.z.mul(waveFreq)).add(time.mul(0.5));
    const wave = sin(wavePhase).mul(0.5).add(0.5); // 0..1

    // Apply Kick energy to the wave
    // Stars in the "active" part of the wave boost significantly on Kick
    const kickPulse = uAudioLow.mul(wave).mul(1.5);

    // Total Intensity = Base + Twinkle + Pulse
    const intensity = float(0.5).add(activeTwinkle).add(kickPulse);

    // 3. Color Shift (Neon/Magic)
    // Shift towards Cyan/Magenta on high energy (Highs)
    const baseColorVec = vec3(aStarColor.x, aStarColor.y, aStarColor.z);

    // Magic colors
    const colorCyan = vec3(0.0, 1.0, 1.0);
    const colorMagenta = vec3(1.0, 0.0, 1.0);

    // Pick target color based on star's unique offset (50% cyan, 50% magenta)
    const targetColor = mix(colorCyan, colorMagenta, sin(aOffset).mul(0.5).add(0.5));

    // Mix based on audio high (energy)
    // Stronger highs = More neon color
    const finalRGB = mix(baseColorVec, targetColor, uAudioHigh.mul(0.8));

    // Final Output
    mat.colorNode = vec4(finalRGB, uStarOpacity).mul(mat.color);
    mat.sizeNode = aSize.mul(intensity.max(0.4)); // Keep min size 0.4 so they don't disappear

    // 4. Star Warp/Dance (Existing logic preserved but tuned)
    const pos = positionLocal;
    // Warp outwards on Kick (Low)
    const warpFactor = uAudioLow.mul(10.0);
    const warpedPos = pos.add(pos.normalize().mul(warpFactor));

    // Gentle Rotation
    const angle = time.mul(0.015); // Slightly slower rotation
    const rotatedX = warpedPos.x.mul(cos(angle)).sub(warpedPos.z.mul(sin(angle)));
    const rotatedZ = warpedPos.x.mul(sin(angle)).add(warpedPos.z.mul(cos(angle)));

    mat.positionNode = vec3(rotatedX, warpedPos.y, rotatedZ);

    const stars = new THREE.Points(geo, mat);
    stars.userData.isStars = true;

    return stars;
}
