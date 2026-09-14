import * as THREE from 'three';
import { WEATHER_TARGET_DECAY_RATE } from './music-reactivity.ts';

import { uTwilight } from '../foliage/sky.ts';
import { CONFIG } from '../core/config.ts';
import { WeatherMusicTargets } from './music-reactivity-core.ts';

import { MRState, _whiteColor, getActiveWave, setActiveWave } from './music-reactivity-core.ts';
import { skyWaveUniformMap } from './music-reactivity-defaults.ts';
import { computeWaveDistSq } from './music-wave.ts';
import type { AudioData } from '../foliage/types.ts';

    export function updateSkyWavePropagation(
        audioState: AudioData | null,
        isDay: boolean,
        cameraPosition?: THREE.Vector3,
        deltaTime: number = 0.016
    ) {
        const nightGate = isDay ? 0.0 : 1.0;
        // ---------------------------------------------------------------
        // ⚡ SKY WAVE — Per-channel MOD note-color wave propagation
        // When a sky/moon note fires on the beat (via BeatSync), its hue cascades
        // to the noteColor uniforms listed in music-bindings.json sky_wave.target_biomes.
        // Order in the array controls stagger (earlier targets receive the color first).
        // Foliage that already .mul() one of the hub noteColors (arpeggioGrove or crystallineNebula)
        // — e.g. portamento-pine, wisteria-cluster, many trees/mushrooms — get the sky hue automatically.
        // Zero allocations: all state is module-level.
        // Music Impact: the primary "sky talks to ground" visual sync mechanism.
        // ---------------------------------------------------------------
        const twilightVal = uTwilight.value;
        if (twilightVal > 0.1) {
            if (MRState.activeWave) {
                const elapsed =
                    (performance.now() - MRState.activeWave.timestamp) /
                    MRState.skyWavePropagationMs;
                const targets: readonly string[] = MRState.skyWaveTargets;

                let allComplete = true;
                for (let i = 0; i < targets.length; i++) {
                    const key = targets[i];
                    const uni = skyWaveUniformMap[key];
                    if (!uni) continue;

                    // Stagger arrival: ~0.22 of propagation per step in the list
                    const phaseStart = i * 0.22;
                    if (elapsed > phaseStart) {
                        const localT = Math.min((elapsed - phaseStart) / 0.68, 1.0);
                        // Gentle influence so it feels like a traveling wave, not a hard cut
                        uni.value.lerp(MRState.activeWave.color, localT * 0.32);
                        allComplete = false;
                    }
                }

                if (elapsed >= 1.0 || allComplete) {
                    MRState.activeWave = null;
                    setActiveWave(null);
                    MRState.waveDecayStartTime = performance.now();
                }
            } else if (MRState.waveDecayStartTime > 0) {
                const decayElapsed = performance.now() - MRState.waveDecayStartTime;
                const targets: readonly string[] = MRState.skyWaveTargets;

                if (decayElapsed < MRState.skyWaveDecayMs) {
                    for (const key of targets) {
                        const uni = skyWaveUniformMap[key];
                        if (uni) uni.value.lerp(_whiteColor, 0.06);
                    }
                } else {
                    MRState.waveDecayStartTime = 0;
                    for (const key of targets) {
                        const uni = skyWaveUniformMap[key];
                        if (uni) uni.value.copy(_whiteColor);
                    }
                }
            }
        } else {
            // Dawn guard: clear active wave and decay to white for every targeted uniform
            if (MRState.activeWave) {
                MRState.activeWave = null;
                setActiveWave(null);
                MRState.waveDecayStartTime = performance.now();
            }
            // Also gently clear any lingering wave color on targets (defensive)
            const targets: readonly string[] = MRState.skyWaveTargets;
            for (const key of targets) {
                const uni = skyWaveUniformMap[key];
                if (uni) uni.value.lerp(_whiteColor, 0.04);
            }
        }

        // ---------------------------------------------------------------
        // ⚡ WEATHER MUSIC REACTIVITY — channel amplitude → weather targets
        // Data-driven: channel indices come from assets/music-bindings.json weatherReactivity.
        // Exponential moving average keyed to deltaTime for frame-rate independence.
        // Targets decay to zero when disabled so mid-game toggle leaves no stuck state.
        // ---------------------------------------------------------------
        if (CONFIG.weather.musicReactivity.enabled && audioState?.channelData) {
            const ch = audioState.channelData;
            const smooth = (current: number, target: number, k: number) =>
                current + (target - current) * (1.0 - Math.exp(-k * deltaTime));

            if (MRState.weatherBindings.rainIntensity) {
                const b = MRState.weatherBindings.rainIntensity;
                const idx = b.channel;
                const raw = idx < ch.length ? ch[idx].volume * b.scale : 0;
                WeatherMusicTargets.rainIntensity = smooth(
                    WeatherMusicTargets.rainIntensity,
                    Math.min(raw, 1.0),
                    b.smoothing
                );
            }
            if (MRState.weatherBindings.thunderPulse) {
                const b = MRState.weatherBindings.thunderPulse;
                const idx = b.channel;
                const raw = idx < ch.length ? ch[idx].volume * b.scale : 0;
                WeatherMusicTargets.thunderPulse = smooth(
                    WeatherMusicTargets.thunderPulse,
                    Math.min(raw, 1.0),
                    b.smoothing
                );
            }
            if (MRState.weatherBindings.fogDensity) {
                const b = MRState.weatherBindings.fogDensity;
                const idx = b.channel;
                const raw = idx < ch.length ? ch[idx].volume * b.scale : 0;
                WeatherMusicTargets.fogDensity = smooth(
                    WeatherMusicTargets.fogDensity,
                    Math.min(raw, 1.0),
                    b.smoothing
                );
            }
        } else {
            // Feature off or no channel data — exponentially decay targets to zero.
            // Gradual decay (~200 ms time constant) prevents abrupt transitions on mid-game toggle.
            const decayFactor = 1.0 - Math.exp(-deltaTime * WEATHER_TARGET_DECAY_RATE);
            WeatherMusicTargets.rainIntensity -= WeatherMusicTargets.rainIntensity * decayFactor;
            WeatherMusicTargets.thunderPulse -= WeatherMusicTargets.thunderPulse * decayFactor;
            WeatherMusicTargets.fogDensity -= WeatherMusicTargets.fogDensity * decayFactor;
            // Clamp to zero below threshold to avoid denormals
            if (WeatherMusicTargets.rainIntensity < 0.001) WeatherMusicTargets.rainIntensity = 0;
            if (WeatherMusicTargets.thunderPulse < 0.001) WeatherMusicTargets.thunderPulse = 0;
            if (WeatherMusicTargets.fogDensity < 0.001) WeatherMusicTargets.fogDensity = 0;
        }
    }