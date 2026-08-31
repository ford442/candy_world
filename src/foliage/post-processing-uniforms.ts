import { uniform } from 'three/tsl';
import { CONFIG } from '../core/config.ts';

export const uBloomStrength = uniform(1.0);
export const uBloomThreshold = uniform(CONFIG.postfx.bloomThreshold);
export const uBloomRadius = uniform(CONFIG.postfx.bloomRadius);
export const uAoStrength = uniform(0.0);
export const uColorSaturation = uniform(1.1);
export const uColorContrast = uniform(1.05);
export const uVignetteStrength = uniform(0.5);
export const uAberrationStrength = uniform(0.002);
export const uDofFocus = uniform(CONFIG.postfx.dofFocusDistance);
export const uDofMix = uniform(0.0);
export const uShaftScatterBoost = uniform(0.0);
