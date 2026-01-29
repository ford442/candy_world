/**
 * @file audio_reactive.ts
 * @description Audio integration for particle systems
 * 
 * Provides global uniforms and update functions for audio-reactive particles.
 */

import * as THREE from 'three';
import { uniform, color } from 'three/tsl';
import type { ParticleAudioState } from './particle_config.ts';

// =============================================================================
// GLOBAL AUDIO UNIFORMS FOR PARTICLES
// =============================================================================

/**
 * Global pulse strength uniform for audio-reactive particles
 * Range: 0.0 - 1.0
 */
export const uPulseStrength = uniform(0.0);

/**
 * Global pulse color uniform for audio-reactive particles
 */
export const uPulseColor = uniform(color(0xFFFFFF));

/**
 * Global beat phase uniform (0-1, cycles with beat)
 */
export const uBeatPhase = uniform(0.0);

/**
 * Global audio level uniform (overall volume)
 */
export const uAudioLevel = uniform(0.0);

// =============================================================================
// AUDIO UPDATE
// =============================================================================

/**
 * Updates global particle audio uniforms from audio state.
 * Call this in your animation loop with current audio analysis.
 * 
 * @param state - Current audio state from audio system
 * 
 * @example
 * ```ts
 * // In animation loop:
 * const visualState = audioSystem.update();
 * updateParticleAudioUniforms({
 *     kick: visualState.kickTrigger,
 *     level: visualState.grooveAmount,
 *     beatPhase: visualState.beatPhase,
 *     color: 0xFF00FF
 * });
 * ```
 */
export function updateParticleAudioUniforms(state: ParticleAudioState): void {
    if (state.kick !== undefined) {
        uPulseStrength.value = state.kick;
    }
    if (state.level !== undefined) {
        uAudioLevel.value = state.level;
    }
    if (state.beatPhase !== undefined) {
        uBeatPhase.value = state.beatPhase;
    }
    if (state.color !== undefined) {
        uPulseColor.value.setHex(state.color);
    }
}

/**
 * Gets the current audio uniform values.
 * Useful for debugging or custom integrations.
 */
export function getParticleAudioState(): ParticleAudioState {
    return {
        kick: uPulseStrength.value,
        level: uAudioLevel.value,
        beatPhase: uBeatPhase.value,
        color: (uPulseColor.value as THREE.Color).getHex()
    };
}

/**
 * Resets all audio uniforms to default values.
 */
export function resetParticleAudioUniforms(): void {
    uPulseStrength.value = 0.0;
    uAudioLevel.value = 0.0;
    uBeatPhase.value = 0.0;
    uPulseColor.value.setHex(0xFFFFFF);
}
