// src/systems/atmosphere-reactivity.ts
//
// Atmosphere Reactivity — bridges audio analysis to post-processing & sky uniforms.
// Called from MusicReactivitySystem.update() once per frame.
//
// Mapping (assets/music-bindings.json `atmosphere` block, all optional):
//   - bloom.channels (kick/bass energy)  -> uBloomStrength        (post-processing.ts)
//   - average channel volume             -> uCrescendoFogDensity  (sky.ts, enhances the
//                                            existing weather-driven lerp, never fights it)
//   - shafts.melodyChannel (via SkyUniforms.intensity) -> uShaftOpacity (init.ts), night only
//   - BeatSync strong downbeats -> decaying spikes added to bloom + shaft opacity
//
// Zero per-frame allocations: only pre-resolved scalars/arrays from module init are used.
// Only `.value` on existing TSL uniform nodes is mutated — nodes are never reassigned.

import { uBloomStrength } from '../foliage/post-processing.ts';
import { uCrescendoFogDensity } from '../foliage/sky.ts';
import { uShaftOpacity } from '../core/init.ts';
import { SkyUniforms } from './biome-uniforms.ts';
import musicBindings from '../../assets/music-bindings.json';
import type { AudioData } from '../foliage/types.ts';
import type { BeatSync } from '../audio/beat-sync.ts';

function toChannelArray(value: unknown, fallback: readonly number[]): readonly number[] {
    if (!Array.isArray(value) || value.length === 0) return fallback;
    const sanitized: number[] = [];
    for (let i = 0; i < value.length; i++) {
        const channel = value[i];
        if (Number.isInteger(channel) && channel >= 0 && channel <= 255) sanitized.push(channel as number);
    }
    return sanitized.length > 0 ? sanitized : fallback;
}

// ⚡ OPTIMIZATION: Resolved once at module init from assets/music-bindings.json — immutable
// after that, zero per-frame allocations. The `atmosphere` block is entirely optional;
// every field falls back to a sensible default below.
const _atmosphereConfig: any = (musicBindings as any).atmosphere ?? {};
const _bloomConfig = _atmosphereConfig.bloom ?? {};
const _fogConfig = _atmosphereConfig.fog ?? {};
const _shaftConfig = _atmosphereConfig.shafts ?? {};
const _beatPulseConfig = _atmosphereConfig.beatPulse ?? {};

const _bloomChannels: readonly number[] = toChannelArray(_bloomConfig.channels, [0, 1]);
const BLOOM_REST: number = typeof _bloomConfig.restStrength === 'number' ? _bloomConfig.restStrength : 1.0;
const BLOOM_MAX: number = typeof _bloomConfig.maxStrength === 'number' ? _bloomConfig.maxStrength : 2.5;
const BLOOM_SMOOTHING: number = typeof _bloomConfig.smoothing === 'number' ? _bloomConfig.smoothing : 4.0;

const FOG_BOOST_SCALE: number = typeof _fogConfig.boostScale === 'number' ? _fogConfig.boostScale : 0.7;
const FOG_SMOOTHING: number = typeof _fogConfig.smoothing === 'number' ? _fogConfig.smoothing : 3.0;

const SHAFT_REST: number = typeof _shaftConfig.restOpacity === 'number' ? _shaftConfig.restOpacity : 0.0;
const SHAFT_MAX: number = typeof _shaftConfig.maxOpacity === 'number' ? _shaftConfig.maxOpacity : 0.35;
const SHAFT_SMOOTHING: number = typeof _shaftConfig.smoothing === 'number' ? _shaftConfig.smoothing : 2.5;
const SHAFT_ACTIVATE_THRESHOLD: number = typeof _shaftConfig.activateThreshold === 'number' ? _shaftConfig.activateThreshold : 0.15;

const BEAT_THRESHOLD: number = typeof _beatPulseConfig.threshold === 'number' ? _beatPulseConfig.threshold : 0.5;
const BEAT_BLOOM_SPIKE: number = typeof _beatPulseConfig.bloomSpike === 'number' ? _beatPulseConfig.bloomSpike : 0.6;
const BEAT_SHAFT_SPIKE: number = typeof _beatPulseConfig.shaftShimmerSpike === 'number' ? _beatPulseConfig.shaftShimmerSpike : 0.25;
const BEAT_DECAY_RATE: number = typeof _beatPulseConfig.decayRate === 'number' ? _beatPulseConfig.decayRate : 4.0;

// ⚡ Per-frame scratch — pre-allocated, mutated in place, never reassigned.
let _bloomBeatSpike = 0.0;
let _shaftBeatSpike = 0.0;

/**
 * Shared with src/core/game-loop.ts:
 *  - `nightShaftReady` is read there to gate night-time moonbeam shaft *visibility*.
 *    Opacity itself (uShaftOpacity.value) is driven continuously below so it never
 *    pops when visibility toggles.
 *  - `sunShaftActive` is written there (in the shaft-visibility block) to report
 *    whether the sunrise/sunset god-ray code drove uShaftOpacity.value this frame.
 *    Near the day/night boundary (cyclePos in [0,60) or (510,540]) `isNight` is true
 *    AND the sun-shaft code can also be active in the same frame — when it is, the
 *    melody-driven write below yields so the two systems don't fight over the
 *    same uniform.
 */
export const AtmosphereReactivityState = {
    nightShaftReady: false,
    sunShaftActive: false,
};

/** One-pole exponential smoothing toward `target`, frame-rate independent. */
function smoothTo(current: number, target: number, rate: number, deltaTime: number): number {
    return current + (target - current) * (1.0 - Math.exp(-rate * deltaTime));
}

/**
 * Registers the BeatSync downbeat hook for atmosphere spikes (bloom + shaft shimmer).
 * Call once during MusicReactivitySystem.init().
 */
export function registerAtmosphereBeatSync(beatSync: BeatSync): void {
    beatSync.onBeat((state: any) => {
        const kick = state?.kickTrigger || 0;
        if (kick >= BEAT_THRESHOLD) {
            _bloomBeatSpike = Math.max(_bloomBeatSpike, kick * BEAT_BLOOM_SPIKE);
            _shaftBeatSpike = Math.max(_shaftBeatSpike, kick * BEAT_SHAFT_SPIKE);
        }
    });
}

/**
 * Per-frame atmosphere update. Call from MusicReactivitySystem.update() after
 * SkyUniforms.intensity has been refreshed for this frame.
 */
export function updateAtmosphereReactivity(audioState: AudioData | null, deltaTime: number, isNight: boolean): void {
    // Decay beat-driven spikes — frame-rate independent exponential decay, no pops.
    const spikeDecay = Math.exp(-BEAT_DECAY_RATE * deltaTime);
    _bloomBeatSpike *= spikeDecay;
    if (_bloomBeatSpike < 0.001) _bloomBeatSpike = 0.0;
    _shaftBeatSpike *= spikeDecay;
    if (_shaftBeatSpike < 0.001) _shaftBeatSpike = 0.0;

    const channels = audioState?.channelData;

    // --- Kick/bass energy -> uBloomStrength ---
    let bloomEnergy = 0.0;
    if (channels && channels.length > 0) {
        let sum = 0.0;
        let count = 0;
        for (let i = 0; i < _bloomChannels.length; i++) {
            const idx = _bloomChannels[i];
            if (idx < channels.length) {
                sum += channels[idx].volume;
                count++;
            }
        }
        if (count > 0) bloomEnergy = sum / count;
    }
    const kickEnergy = audioState?.kickTrigger || 0;
    const bloomDrive = Math.min(1.0, Math.max(bloomEnergy, kickEnergy));
    const bloomTarget = Math.min(
        BLOOM_MAX + BEAT_BLOOM_SPIKE,
        BLOOM_REST + (BLOOM_MAX - BLOOM_REST) * bloomDrive + _bloomBeatSpike
    );
    uBloomStrength.value = smoothTo(uBloomStrength.value as number, bloomTarget, BLOOM_SMOOTHING, deltaTime);

    // --- Mix energy / average volume -> uCrescendoFogDensity (enhance, don't fight) ---
    // weather-atmosphere.ts already lerps this uniform toward its own crescendo factor
    // every frame. We only ever push the value UP toward our (richer) target, so the
    // weather-driven decay back to baseline is never fought.
    if (channels && channels.length > 0) {
        let totalVolume = 0.0;
        for (let i = 0; i < channels.length; i++) totalVolume += channels[i].volume;
        const averageVolume = totalVolume / channels.length;
        const fogBoostTarget = Math.min(1.0, averageVolume * FOG_BOOST_SCALE);
        const current = uCrescendoFogDensity.value as number;
        const enhanced = smoothTo(current, fogBoostTarget, FOG_SMOOTHING, deltaTime);
        if (enhanced > current) uCrescendoFogDensity.value = enhanced;
    }

    // --- Melody channel hits + beat shimmer -> uShaftOpacity (night only) ---
    // Near the day/night boundary, sunrise/sunset god-ray code in game-loop.ts can
    // also write uShaftOpacity.value in this same frame (sunShaftActive). When it
    // does, it owns the uniform this frame — yield so the two writers don't fight.
    if (isNight && !AtmosphereReactivityState.sunShaftActive) {
        const melodyIntensity = SkyUniforms.intensity.value as number;
        const shaftTarget = Math.min(
            SHAFT_MAX + BEAT_SHAFT_SPIKE,
            SHAFT_REST + (SHAFT_MAX - SHAFT_REST) * melodyIntensity + _shaftBeatSpike
        );
        uShaftOpacity.value = smoothTo(uShaftOpacity.value as number, shaftTarget, SHAFT_SMOOTHING, deltaTime);
        AtmosphereReactivityState.nightShaftReady = melodyIntensity > SHAFT_ACTIVATE_THRESHOLD || _shaftBeatSpike > 0.01;
    } else {
        AtmosphereReactivityState.nightShaftReady = false;
    }
}
