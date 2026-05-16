import * as THREE from 'three';
import {
    color, float, vec3, Fn, uniform, sin, time, positionLocal,
    smoothstep, mix, positionWorld, mx_noise_float, normalLocal,
    distance, max, uv, texture
} from 'three/tsl';
import { CandyPresets, uAudioLow, uAudioHigh, createRimLight, uPlayerPosition } from './index.ts';

/**
 * Creates an audio-reactive Terrain Material.
 * Uses TSL for vertex displacement (Breathing) and "Magic Dust" sparkles.
 *
 * @param {number | string | THREE.Color} hexColor - Base color of the terrain.
 * @param {any} options - Material options (roughness, bumpStrength, etc.)
 * @returns {MeshStandardNodeMaterial}
 */
export function createTerrainMaterial(
    hexColor: number | string | THREE.Color,
    options: any = {},
    heightMap?: THREE.DataTexture,
    normalMap?: THREE.DataTexture
): MeshStandardNodeMaterial {
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

    // Static Heightmap Displacement
    let finalPos = currentPos;
    if (heightMap) {
        // Create uniforms for textures
        const heightTexNode = texture(heightMap, uv());

        // Add height displacement (height is in the red channel)
        // Since geometry is rotated -90 on X, the displacement should be on Z in object space
        finalPos = vec3(currentPos.x, currentPos.y, currentPos.z.add(heightTexNode.r));
    }

    // Audio-reactive breathing displacement on top
    // Note: dispY applies to World Y
    const dispY = displacementLogic(positionWorld);

    // Apply displacement
    material.positionNode = vec3(finalPos.x, finalPos.y, finalPos.z.add(dispY));

    // Static Normal Map
    if (normalMap) {
        // Read normal from texture (RGB)
        const normalTexNode = texture(normalMap, uv());
        // Normal textures are typically mapped 0-1, but our generator outputs -1 to 1 directly since we use FloatType
        material.normalNode = normalTexNode.rgb;
    }


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

    // --- PALETTE: Juicy Proximity Glow ---
    // Make the ground light up under the player's feet, pulsing to the beat!
    const proximityLogic = Fn(() => {
        // Calculate horizontal distance from player to ground vertex
        const dist = distance(positionWorld.xz, uPlayerPosition.xz);

        // Interaction Radius
        const glowRadius = float(4.0);
        const innerRadius = float(1.0);

        // Smoothly fade the glow as distance increases
        // 1.0 at center, 0.0 at edge
        const glowFactor = float(1.0).sub(smoothstep(innerRadius, glowRadius, dist));

        // Audio-reactive pulse on the glow (Juice!)
        // The glow expands and brightens with the kick drum
        const audioPulse = uAudioLow.mul(1.5).add(1.0);

        // Neon Magic Color (Cyan <-> Magenta mix based on time and position)
        const magicPhase = time.mul(2.0).add(positionWorld.x.mul(0.5)).add(positionWorld.z.mul(0.5));
        const colorMix = sin(magicPhase).mul(0.5).add(0.5);
        const neonColor = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 1.0), colorMix);

        // Final proximity emissive contribution
        return neonColor.mul(glowFactor).mul(audioPulse).mul(0.8); // 0.8 base intensity
    });

    // Combine emissive sources
    material.emissiveNode = sparkleLogic().add(rim).add(proximityLogic());

    material.userData.type = 'terrain';
    return material;
}
