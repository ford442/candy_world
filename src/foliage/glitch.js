import * as THREE from 'three';
import {
    uv, vec3, uniform, positionLocal,
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
 * NOTE: This is a standard JS function (not wrapped in Fn) because it returns
 * a JS object containing multiple Nodes { uv, position }, which Fn cannot handle.
 *
 * @param {Node} baseUV - The original UV coordinates.
 * @param {Node} basePosition - The original vertex position.
 * @param {Node} intensity - Glitch intensity (0-1).
 * @returns {Object} { uv: glitchedUV, position: glitchedPosition }
 */
export const applyGlitch = (baseUV, basePosition, intensity) => {
    // 1. Pixelation / Blockiness (Sample Offset)
    // Reduce UV resolution based on intensity
    // As intensity increases, blocks get larger (resolution gets smaller)

    // Safety clamp to avoid division by zero or negative resolution
    const resolution = mix(float(100.0), float(10.0), intensity);

    // Pixelate UVs
    const pixelatedUV = floor(baseUV.mul(resolution)).div(resolution);

    // Mix between original and pixelated based on intensity threshold
    // We only glitch when intensity is significant (> 0.1)
    const isGlitchy = smoothstep(float(0.1), float(0.3), intensity);
    const resultUV = mix(baseUV, pixelatedUV, isGlitchy);

    // 2. Vertex Jitter
    // Random offset based on position and time (using a simple hash-like logic)
    
    const jitterAmount = float(0.5).mul(intensity); // Max jitter distance

    // Pseudo-random offset
    // sin(x * big_number) creates high frequency oscillation
    // Explicit float() wrapping for safety
    const noiseX = sin(basePosition.y.mul(float(50.0)).add(intensity.mul(float(100.0))));
    const noiseY = cos(basePosition.x.mul(float(50.0)).add(intensity.mul(float(100.0))));
    const noiseZ = sin(basePosition.z.mul(float(50.0)));

    const offset = vec3(noiseX, noiseY, noiseZ).mul(jitterAmount);

    // Apply jitter only when glitch is active
    const resultPos = basePosition.add(offset.mul(isGlitchy));

    return { uv: resultUV, position: resultPos };
};

/**
 * Helper to apply glitch to a material.
 * Note: This modifies the material's positionNode and colorNode (if texture based).
 *
 * @param {MeshStandardNodeMaterial} material
 */
export function enableGlitchOnMaterial(material) {
    // Backup original position logic if it exists
    const originalPos = material.positionNode || positionLocal;

    // Define the glitch calculation
    const glitchResult = applyGlitch(uv(), originalPos, uGlitchIntensity);

    // Update Material Position
    material.positionNode = glitchResult.position;

    // Optional: Color shift on glitch
    const glitchColor = vec3(1.0, 0.0, 1.0); // Magenta tint on glitch
    const mixColor = mix(material.colorNode || vec3(1.0), glitchColor, uGlitchIntensity.mul(float(0.5)));
    material.colorNode = mixColor;
}
