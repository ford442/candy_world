import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, vec2, Fn, uniform, sin, cos, time, positionLocal,
    uv, normalize, smoothstep, mix, abs, max, positionWorld
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
    // FIX: Removed array destructuring [pos]. Fn receives arguments directly.
    const waterDisplacement = Fn((pos) => {
        // Base rolling wave (Time dependent)
        const bigWave = sin(pos.x.mul(0.05).add(time.mul(0.5))).mul(2.0);

        // Bass-driven pulses (Low Freq)
        // Modulate amplitude with uAudioLow
        const bassWave = cos(pos.z.mul(0.1).sub(time.mul(1.0)))
            .mul(uAudioLow.mul(3.0).add(0.5)); // Base 0.5 + Audio impact

        // Treble ripples (High Freq)
        const rippleX = sin(pos.x.mul(0.5).add(time.mul(2.0)));
        const rippleZ = cos(pos.z.mul(0.4).sub(time.mul(2.5)));
        const trebleRipples = rippleX.mul(rippleZ)
            .mul(uAudioHigh.mul(1.5));

        // Combine
        return bigWave.add(bassWave).add(trebleRipples).mul(uWaveHeight);
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
    const newPos = vec3(pos.x, pos.y.add(displacement), pos.z);
    material.positionNode = newPos;

    // Recalculate Normals for correct lighting on waves
    // TSL doesn't auto-recalc normals from positionNode yet in all cases,
    // but MeshStandardNodeMaterial handles it reasonably well if the displacement is smooth.
    // Ideally we would compute analytical normals here, but for "Cute Clay", soft is fine.

    // Add Foam/Highlight at peaks
    // We can change color based on height
    const heightFactor = smoothstep(2.0, 5.0, displacement); // 0 at low, 1 at high peaks
    const foamColor = color(0xFFFFFF);
    const waterColor = material.colorNode; // The base color from SeaJelly

    // Mix foam into base color
    material.colorNode = mix(waterColor, foamColor, heightFactor.mul(0.5));

    // Optional: Add emission on beat
    const beatGlow = uAudioLow.mul(0.2); // Subtle glow on kick
    material.emissiveNode = vec3(0.1, 0.3, 0.6).mul(beatGlow);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.type = 'water';
    mesh.receiveShadow = true;

    // Optimization: Disable frustum culling if the water covers the whole world
    // or set a large bounding sphere.
    mesh.frustumCulled = false;

    return mesh;
}
