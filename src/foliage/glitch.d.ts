import { Node } from 'three/tsl';

export interface GlitchResult {
  uv: Node;
  position: Node;
}

/**
 * Applies a sample-offset glitch effect to UVs and vertex positions.
 * @param baseUV - The original UV coordinates
 * @param basePosition - The original vertex position (usually positionLocal)
 * @param intensity - The glitch intensity (0.0 to 1.0)
 * @returns Object containing modified uv and position nodes
 */
export function applyGlitch(
  baseUV: Node,
  basePosition: Node,
  intensity: Node
): GlitchResult;
