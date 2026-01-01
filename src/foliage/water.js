// src/foliage/water.js

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, Fn, uniform, sin, cos, time, positionLocal,
    smoothstep, mix,
    mul, add, sub // Functional operators
} from 'three/tsl';
import { CandyPresets } from './common.js';

// Global Audio Uniforms for Water Reactivity
export const uAudioLow = uniform(0.0);   // Bass energy (Kick)
export const uAudioHigh = uniform(0.0);  // Treble energy (Hi-hats/Cymbals)
export const uWaveHeight = uniform(1.0); // Base wave height scaler

/**
 * Creates an audio-reactive Waveform Water surface.
 * Uses TSL for vertex displacement and "Cute Clay" shading (SeaJelly preset).
 *
 * @param {number} width
 * @param {number} depth
 * @returns {THREE.Mesh}
 */
export function createWaveformWater(width = 400, depth = 400) {
    // High segment count for smooth vertex displacement
    const geometry = new THREE.PlaneGeometry(width, depth, 128, 128);
    geometry.rotateX(-Math.PI / 2); // Lay flat

    // --- TSL Displacement Logic ---
    const waterDisplacement = Fn((pos) => {
        // Base rolling wave (Time dependent)
        // sin(pos.x * 0.05 + time * 0.5) * 2.0
        const bigWave = mul(sin(add(mul(pos.x, float(0.05)), mul(time, float(0.5)))), float(2.0));

        // Bass-driven pulses (Low Freq)
        // Modulate amplitude with uAudioLow
        // cos(pos.z * 0.1 - time * 1.0) * (uAudioLow * 3.0 + 0.5)
        const bassWave = mul(
            cos(sub(mul(pos.z, float(0.1)), mul(time, float(1.0)))),
            add(mul(uAudioLow, float(3.0)), float(0.5))
        );

        // Treble ripples (High Freq)
        // rippleX * rippleZ * (uAudioHigh * 1.5)
        const rippleX = sin(add(mul(pos.x, float(0.5)), mul(time, float(2.0))));
        const rippleZ = cos(sub(mul(pos.z, float(0.4)), mul(time, float(2.5))));
        const trebleRipples = mul(
            mul(rippleX, rippleZ),
            mul(uAudioHigh, float(1.5))
        );

        // Combine
        return mul(add(add(bigWave, bassWave), trebleRipples), uWaveHeight);
    });

    // --- Material Setup ---
    // Use SeaJelly preset for the "Cute Clay" water look
    // Wobbly, wet, very translucent, high transmission
    const material = CandyPresets.SeaJelly(0x44AAFF, {
        roughness: 0.1,
        metalness: 0.1,
        transmission: 0.9,
        ior: 1.33,
        thickness: 2.0,
        animateMoisture: true // Adds scrolling noise to roughness
    });

    // Inject Vertex Displacement
    const pos = positionLocal;
    const displacement = waterDisplacement(pos);

    // Update Y position
    const newPos = vec3(pos.x, add(pos.y, displacement), pos.z);
    material.positionNode = newPos;

    // Recalculate Normals for correct lighting on waves
    // TSL doesn't auto-recalc normals from positionNode yet in all cases,
    // but MeshStandardNodeMaterial handles it reasonably well if the displacement is smooth.
    // Ideally we would compute analytical normals here, but for "Cute Clay", soft is fine.

    // Add Foam/Highlight at peaks
    // We can change color based on height
    const heightFactor = smoothstep(float(2.0), float(5.0), displacement); // 0 at low, 1 at high peaks
    const foamColor = color(0xFFFFFF);
    const waterColor = material.colorNode; // The base color from SeaJelly

    // Mix foam into base color
    material.colorNode = mix(waterColor, foamColor, mul(heightFactor, float(0.5)));

    // Optional: Add emission on beat
    const beatGlow = mul(uAudioLow, float(0.2)); // Subtle glow on kick
    material.emissiveNode = mul(vec3(0.1, 0.3, 0.6), beatGlow);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.type = 'water';
    mesh.receiveShadow = true;

    // Optimization: Disable frustum culling if the water covers the whole world
    // or set a large bounding sphere.
    mesh.frustumCulled = false;

    return mesh;
}
