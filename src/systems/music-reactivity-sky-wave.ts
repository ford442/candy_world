import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { uTwilight } from '../foliage/sky.ts';
import type { AudioData } from '../foliage/types.ts';
import { WeatherMusicTargets } from './music-reactivity-core.ts';
import { MRState, _whiteColor, setActiveWave, skyWaveRing } from './music-reactivity-core.ts';
import { BiomeUniforms } from './biome-uniforms.ts';
import { skyWaveUniformMap } from './music-reactivity-defaults.ts';
import { WEATHER_TARGET_DECAY_RATE } from './music-reactivity.ts';
import { WAVE_SLOT_COUNT } from './music-wave.ts';

// Night gate: fully off below TWILIGHT_GATE_LO (daytime), fully on above TWILIGHT_GATE_HI.
// Smoothstep rather than a hard threshold so a lerped uTwilight hovering near dusk/dawn
// fades the wave in and out instead of flickering frame to frame.
const TWILIGHT_GATE_LO = 0.05;
const TWILIGHT_GATE_HI = 0.15;
const GATE_OFF = 0.01;

// Exponential rates (1/s) chosen to match the previous per-frame weights at 60 fps
// (0.32 wave ramp, 0.06 decay, 0.04 dawn clear) so the look is unchanged but the
// timing no longer depends on refresh rate.
const WAVE_LERP_RATE = 23.0;
const DECAY_LERP_RATE = 3.7;
const DAWN_LERP_RATE = 2.5;

export function skyWaveNightGate(twilight: number): number {
    return THREE.MathUtils.smoothstep(twilight, TWILIGHT_GATE_LO, TWILIGHT_GATE_HI);
}

/**
 * Beat handler: claim a ring slot stamped with the current sky/moon note color.
 * Overlapping waves each keep their own timestamp and color, so a fast BPM
 * doesn't restart (and starve) the wave that is still travelling.
 */
export function triggerSkyWave(now: number = performance.now()): void {
    if (skyWaveNightGate(uTwilight.value) < GATE_OFF || MRState.skyMoonNoteVal <= 0) return;
    const slot = skyWaveRing.push(BiomeUniforms.skyMoon.moonNoteColor.value, now);
    // Batchers read the newest wave via getActiveWave() for their spatial front.
    MRState.activeWave = slot;
    setActiveWave(slot);
    MRState.waveDecayStartTime = 0;
}

export function updateSkyWavePropagation(
    audioState: AudioData | null,
    isDay: boolean,
    cameraPosition?: THREE.Vector3,
    deltaTime: number = 0.016
) {
    // ---------------------------------------------------------------
    // ⚡ SKY WAVE — Per-channel MOD note-color wave propagation
    // When a sky/moon note fires on the beat (via BeatSync), its hue cascades
    // to the noteColor uniforms listed in music-bindings.json sky_wave.target_biomes.
    // Order in the array controls stagger (earlier targets receive the color first).
    // Up to WAVE_SLOT_COUNT waves travel at once (skyWaveRing), applied oldest→newest.
    // Foliage that already .mul() one of the hub noteColors (arpeggioGrove or crystallineNebula)
    // — e.g. portamento-pine, wisteria-cluster, many trees/mushrooms — get the sky hue automatically.
    // Zero allocations: all state is module-level.
    // Music Impact: the primary "sky talks to ground" visual sync mechanism.
    // ---------------------------------------------------------------
    const gate = skyWaveNightGate(uTwilight.value);
    const now = performance.now();
    if (gate >= GATE_OFF) {
        const anyActive = skyWaveRing.expire(now, MRState.skyWavePropagationMs);
        if (anyActive) {
            const targets: readonly string[] = MRState.skyWaveTargets;
            const rampAlpha = (1.0 - Math.exp(-WAVE_LERP_RATE * deltaTime)) * gate;
            const ring = skyWaveRing;
            for (let k = 0; k < WAVE_SLOT_COUNT; k++) {
                const slot = ring.slots[(ring.head + k) % WAVE_SLOT_COUNT];
                if (!slot.active) continue;
                const elapsed = (now - slot.timestamp) / MRState.skyWavePropagationMs;
                for (let i = 0; i < targets.length; i++) {
                    const uni = skyWaveUniformMap[targets[i]];
                    if (!uni) continue;

                    // Stagger arrival: ~0.22 of propagation per step in the list
                    const phaseStart = i * 0.22;
                    if (elapsed > phaseStart) {
                        const localT = Math.min((elapsed - phaseStart) / 0.68, 1.0);
                        // Gentle influence so it feels like a traveling wave, not a hard cut
                        uni.value.lerp(slot.color, localT * rampAlpha);
                    }
                }
            }
            const newest = ring.newestActive();
            MRState.activeWave = newest;
            setActiveWave(newest);
        } else {
            if (MRState.activeWave) {
                MRState.activeWave = null;
                setActiveWave(null);
                MRState.waveDecayStartTime = now;
            }
            if (MRState.waveDecayStartTime > 0) {
                const decayElapsed = now - MRState.waveDecayStartTime;
                const targets: readonly string[] = MRState.skyWaveTargets;

                if (decayElapsed < MRState.skyWaveDecayMs) {
                    const decayAlpha = 1.0 - Math.exp(-DECAY_LERP_RATE * deltaTime);
                    for (const key of targets) {
                        const uni = skyWaveUniformMap[key];
                        if (uni) uni.value.lerp(_whiteColor, decayAlpha);
                    }
                } else {
                    MRState.waveDecayStartTime = 0;
                    for (const key of targets) {
                        const uni = skyWaveUniformMap[key];
                        if (uni) uni.value.copy(_whiteColor);
                    }
                }
            }
        }
    } else {
        // Dawn guard: clear active waves and decay to white for every targeted uniform
        if (MRState.activeWave) {
            skyWaveRing.clear();
            MRState.activeWave = null;
            setActiveWave(null);
            MRState.waveDecayStartTime = now;
        }
        // Also gently clear any lingering wave color on targets (defensive)
        const targets: readonly string[] = MRState.skyWaveTargets;
        const dawnAlpha = 1.0 - Math.exp(-DAWN_LERP_RATE * deltaTime);
        for (const key of targets) {
            const uni = skyWaveUniformMap[key];
            if (uni) uni.value.lerp(_whiteColor, dawnAlpha);
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
