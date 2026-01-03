// src/foliage/glitch.js

import {
    Fn,
    vec2,
    vec3,
    float,
    uv,
    floor,
    fract,
    mx_noise_float,
    positionLocal,
    positionWorld,
    uniform,
    mix
} from 'three/tsl';

/**
 * Applies a sample-offset glitch effect to UVs and vertex positions.
 *
 * @param {Node} baseUV - The original UV coordinates.
 * @param {Node} basePosition - The original vertex position (usually positionLocal).
 * @param {Node} intensity - The glitch intensity (0.0 to 1.0).
 * @returns {Object} An object containing the modified `{ uv: uvNode, position: positionNode }`.
 */
export const applyGlitch = Fn(([baseUV, basePosition, intensity]) => {
    // 1. UV Pixelation / Quantization
    // At high intensity, UVs become blocky
    const pixels = mix(float(2048.0), float(32.0), intensity); // From smooth to blocky
    const glitchedUV = floor(baseUV.mul(pixels)).div(pixels);

    // 2. Vertex Jitter (Sample Offset)
    // Displace vertices randomly based on noise
    const noiseScale = float(10.0);
    // Use position itself as seed for "static" jitter that moves with the object
    // But to make it "glitchy", we should probably quantize the noise input too or use intensity as an offset

    // Create a stepped noise input for "digital" look
    const steppedPos = floor(basePosition.mul(float(5.0))).div(float(5.0));
    const noiseInput = steppedPos.add(intensity.mul(float(100.0)));

    const jitterX = mx_noise_float(noiseInput.mul(noiseScale));
    const jitterY = mx_noise_float(noiseInput.mul(noiseScale).add(vec3(12.3, 4.5, 6.7)));
    const jitterZ = mx_noise_float(noiseInput.mul(noiseScale).add(vec3(7.8, 9.0, 1.2)));

    const displacement = vec3(jitterX, jitterY, jitterZ).sub(0.5).mul(intensity).mul(0.5); // 0.5 units max displacement

    const glitchedPosition = basePosition.add(displacement);

    return {
        uv: glitchedUV,
        position: glitchedPosition
    };
});
