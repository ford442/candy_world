import {
    vec3,
    float,
    floor,
    mx_noise_float,
    mix,
    Node
} from 'three/tsl';

export interface GlitchResult {
  uv: Node;
  position: Node;
}

/**
 * Applies a sample-offset glitch effect to UVs and vertex positions.
 * * NOTE: This is a JS helper that returns nodes, not a compiled TSL Fn.
 * * @param baseUV - The original UV coordinates.
 * @param basePosition - The original vertex position (usually positionLocal).
 * @param intensity - The glitch intensity (0.0 to 1.0).
 * @returns An object containing the modified `{ uv: uvNode, position: positionNode }`.
 */
export const applyGlitch = (baseUV: Node, basePosition: Node, intensity: Node): GlitchResult => {
    // 1. UV Pixelation / Quantization
    // At high intensity, UVs become blocky
    const pixels = mix(float(2048.0), float(32.0), intensity); // From smooth to blocky
    const glitchedUV = floor(baseUV.mul(pixels)).div(pixels);

    // 2. Vertex Jitter (Sample Offset)
    // Displace vertices randomly based on noise
    const noiseScale = float(10.0);

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
};
