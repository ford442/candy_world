import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, Fn, uniform, sin, time, positionLocal,
    smoothstep, mix, positionWorld, mx_noise_float, normalLocal
} from 'three/tsl';
import { CandyPresets, uAudioLow, uAudioHigh, createRimLight } from './common.ts';

/**
 * Creates an audio-reactive Terrain Material.
 * Uses TSL for vertex displacement (Breathing) and "Magic Dust" sparkles.
 *
 * @param {number | string | THREE.Color} hexColor - Base color of the terrain.
 * @param {any} options - Material options (roughness, bumpStrength, etc.)
 * @returns {MeshStandardNodeMaterial}
 */
export function createTerrainMaterial(hexColor: number | string | THREE.Color, options: any = {}): MeshStandardNodeMaterial {
    // 1. Base Material: Clay preset for the "Cute Clay" look
    // Override with options to match existing ground physics material properties
    const material = CandyPresets.Clay(hexColor, {
        roughness: 0.9, // Matte clay
        bumpStrength: 0.15, // Subtle bump for texture
        noiseScale: 20.0, // Texture scale
        triplanar: true, // Avoid UV stretching on large plane
        ...options
    });

    // 2. Vertex Displacement (Audio Reactive Breathing)
    // We want the ground to heave slowly with the bass to feel alive.
    const displacementLogic = Fn(([pos]: any) => {
        // Large, slow noise for "breathing" terrain
        // Scale down position for large features (world scale is 400x400)
        const noisePos = pos.mul(0.02).add(time.mul(0.2));
        const breathe = mx_noise_float(noisePos).mul(2.0); // -1 to 1 approx

        // Audio influence: Bass makes the ground swell
        // Use a smoothed pulse, scaled for visibility but not nausea
        const pulse = uAudioLow.mul(1.5);

        // Displacement is up (Y) - modulated by breathe pattern
        return breathe.mul(pulse);
    });

    const currentPos = material.positionNode || positionLocal;
    // Use positionWorld for consistent noise across chunks if we had chunks
    // For a single large plane, it works fine too.
    const dispY = displacementLogic(positionWorld);

    // Apply displacement to Y (Height)
    material.positionNode = vec3(currentPos.x, currentPos.y.add(dispY), currentPos.z);

    // 3. Emissive "Magic Dust" (Audio Reactive Sparkles)
    // High frequency audio triggers sparkles on the ground, visualizing the melody.
    const sparkleLogic = Fn(() => {
        // High frequency noise for dust grains
        const scale = positionWorld.mul(0.8);
        const t = time.mul(0.5);
        const noiseVal = mx_noise_float(scale.add(t));

        // Threshold for sparse sparkles (only top 40% of noise peaks)
        const mask = smoothstep(0.6, 1.0, noiseVal);

        // Audio drive (Highs) - Boost intensity on cymbals/melody
        const intensity = uAudioHigh.mul(2.0);

        // Color: Gold/Cyan dust mix based on noise
        // Gold (1.0, 0.8, 0.4) mixed with Cyan (0.0, 1.0, 1.0)
        const dustColor = mix(vec3(1.0, 0.8, 0.4), vec3(0.0, 1.0, 1.0), noiseVal);

        return dustColor.mul(mask).mul(intensity);
    });

    // 4. Rim Light for definition (Subtle edge glow)
    const rim = createRimLight(color(0x444444), float(0.2), float(4.0), normalLocal);

    // Combine emissive sources
    material.emissiveNode = sparkleLogic().add(rim);

    material.userData.type = 'terrain';
    return material;
}
