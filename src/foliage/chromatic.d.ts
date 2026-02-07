import * as THREE from 'three';
import { Node } from 'three/tsl';

/**
 * Global uniform for Chromatic Aberration Pulse intensity
 */
export const uChromaticIntensity: Node;

/**
 * Creates a Chromatic Aberration Pulse effect.
 * Returns a full-screen quad mesh that should be added to the camera.
 */
export function createChromaticPulse(): THREE.Mesh;
