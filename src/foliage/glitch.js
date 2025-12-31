
import * as THREE from 'three';
import {
    uv, vec3, Fn, uniform, positionLocal,
    sin, cos, float, mix, smoothstep,
    texture, floor, fract, vec2
} from 'three/tsl';
import { generateNoiseTexture } from './common.js';

// Global uniform for glitch intensity (0.0 to 1.0)
// This should be updated by MusicReactivitySystem when 9xx commands are detected.
export const uGlitchIntensity = uniform(0.0);

/**
 * TSL Function to apply a "Sample-Offset Glitch" effect.
 * It combines UV pixelation (sample offset) and vertex jitter.
 *
 * @param {Node} baseUV - The original UV coordinates.
 * @param {Node} basePosition - The original vertex position.
 * @param {Node} intensity - Glitch intensity (0-1).
 * @returns {Object} { uv: glitchedUV, position: glitchedPosition }
 */
export const applyGlitch = Fn(([baseUV, basePosition, intensity]) => {
    // 1. Pixelation / Blockiness (Sample Offset)
    // Reduce UV resolution based on intensity
    // As intensity increases, blocks get larger (resolution gets smaller)

    // Safety clamp to avoid division by zero or negative resolution
    const resolution = mix(float(100.0), float(10.0), intensity);

    // Pixelate UVs
    const pixelatedUV = floor(baseUV.mul(resolution)).div(resolution);

    // Mix between original and pixelated based on intensity threshold
    // We only glitch when intensity is significant (> 0.1)
    const isGlitchy = smoothstep(0.1, 0.3, intensity);
    const resultUV = mix(baseUV, pixelatedUV, isGlitchy);

    // 2. Vertex Jitter
    // Random offset based on position and time (using a simple hash-like logic)
    // In TSL, we can use noise or simple math.
    // Let's use a simple pseudo-random offset based on sine waves for now,
    // to avoid heavy texture lookups in vertex shader if possible.

    const jitterAmount = float(0.5).mul(intensity); // Max jitter distance

    // Pseudo-random offset
    // sin(x * big_number) creates high frequency oscillation
    const noiseX = sin(basePosition.y.mul(50.0).add(intensity.mul(100.0)));
    const noiseY = cos(basePosition.x.mul(50.0).add(intensity.mul(100.0)));
    const noiseZ = sin(basePosition.z.mul(50.0));

    const offset = vec3(noiseX, noiseY, noiseZ).mul(jitterAmount);

    // Apply jitter only when glitch is active
    const resultPos = basePosition.add(offset.mul(isGlitchy));

    return { uv: resultUV, position: resultPos };
});

/**
 * Helper to apply glitch to a material.
 * Note: This modifies the material's positionNode and colorNode (if texture based).
 *
 * @param {MeshStandardNodeMaterial} material
 */
export function enableGlitchOnMaterial(material) {
    // Backup original position logic if it exists (not trivial in TSL yet without specific structure)
    // For now, we assume we can overwrite or chain.

    // In a real pipeline, we'd mix this node into the existing positionNode.
    // Here we define a new positionNode that calls our glitch fn.

    const originalPos = material.positionNode || positionLocal;

    // We can't easily retrieve "original UV" if it's not explicit,
    // but typically `uv()` is what we want.

    // Define the glitch calculation
    const glitchResult = applyGlitch(uv(), originalPos, uGlitchIntensity);

    // Update Material Position
    material.positionNode = glitchResult.position;

    // Update UVs for textures?
    // MeshStandardNodeMaterial doesn't have a single "uvNode" for all maps.
    // Instead, we might need to modify the colorNode to sample using the new UV.
    // However, simply modifying geometry is often enough for a "glitch" feel.
    // Let's try to just modify geometry first, and maybe color shift.

    // Optional: RGB Split (Chromatic Aberration) on the object itself
    // This is expensive per-fragment, so maybe just a color shift.
    const glitchColor = vec3(1.0, 0.0, 1.0); // Magenta tint on glitch
    const mixColor = mix(material.colorNode || vec3(1.0), glitchColor, uGlitchIntensity.mul(0.5));
    material.colorNode = mixColor;
}
