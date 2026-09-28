import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import type { AudioData } from '../foliage/types.ts';
import { awakenedPersistence } from './awakened-persistence-api.ts';
import { LuminousPlantUniforms } from './biome-uniforms.ts';
import { SkyUniforms } from './biome-uniforms.ts';
import { MRState } from './music-reactivity-core.ts';
import { CHROMATIC_SCALE } from './music-reactivity-defaults.ts';
import { musicReactivitySystem } from './music-reactivity.ts';
    export function updateLuminousPlants(audioState: AudioData | null, isDay: boolean, _lastCameraPos: THREE.Vector3) {
        // ---------------------------------------------------------------
        // ⚡ LUMINOUS PLANTS (Scenic System)
        // Tracker channel defined in assets/music-bindings.json.
        // ---------------------------------------------------------------
        const channels = audioState?.channelData;
        if (channels && MRState.luminousPlantTrackerChannel < channels.length) {
            const lpData = channels[MRState.luminousPlantTrackerChannel];

            let dominantNote = 0;
            let maxAmp = 0.0;

            for (let i = 0; i < 12; i++) {
                if (lpData.notes && lpData.notes[i] > maxAmp) {
                    maxAmp = lpData.notes[i] || 0;
                    dominantNote = i;
                }
            }

            // Add a threshold
            const targetIntensity = maxAmp > 0.1 ? maxAmp * MRState.luminousIntensityScale : 0.0;

            // 1-pole IIR smoothing (Zero-allocation)
            LuminousPlantUniforms.intensity.value +=
                (targetIntensity - LuminousPlantUniforms.intensity.value) * 0.15;

            // Only snap note index when amplitude is high enough
            if (targetIntensity > 0.2) {
                // Map chromatic note index (0-11) across 128 LUT slots exactly like sky_moon
                LuminousPlantUniforms.noteIndex.value = Math.min(
                    Math.floor((dominantNote / 12) * 128),
                    127
                );

                // Awakened persistence: first music reaction near player awakens nearby luminous plants
                const noteName = CHROMATIC_SCALE[dominantNote];
                const noteColor =
                    CONFIG.noteColorMap.luminous_plants?.[noteName] ??
                    CONFIG.noteColorMap.global?.[noteName];
                awakenedPersistence.tryAwakenNearby(
                    'luminous_plant',
                    _lastCameraPos,
                    targetIntensity,
                    typeof noteColor === 'number' ? noteColor : undefined
                );
            }
        }
        // Day guard: clamp intensity to 0 when daytime so sky/moon are unchanged.
        SkyUniforms.intensity.value = !isDay ? Math.min(MRState.smoothedSkyIntensity, 1.0) : 0.0;
    }