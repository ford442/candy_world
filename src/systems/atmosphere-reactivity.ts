// Atmosphere Reactivity — maps tracker audio to post-processing + sky uniforms.
// Zero-allocation hot path: module-scope scratch only.

import musicBindings from '../../assets/music-bindings.json';
import { BeatSync } from '../audio/beat-sync.ts';
import { uBloomStrength } from '../foliage/post-processing-uniforms.ts';
import { uCrescendoFogDensity } from '../foliage/sky.ts';
import type { AudioData } from '../foliage/types.ts';
import {
    computeBassNorm,
    computeBloomTarget,
    computeFogTarget,
    computeMelodyShaft,
    computeNightGate,
    decayBeatSpike,
    smoothTowards,
} from './atmosphere-reactivity-core.ts';
import { MRState, toChannels } from './music-reactivity-core.ts';

export interface AtmosphereBloomBinding {
    channels: readonly number[];
    rest: number;
    peak: number;
    smoothing: number;
}

export interface AtmosphereFogBinding {
    scale: number;
    max: number;
    smoothing: number;
}

export interface AtmosphereShaftBinding {
    peak: number;
    smoothing: number;
}

export interface AtmosphereBeatBinding {
    bloomSpike: number;
    shaftShimmer: number;
    decay: number;
}

/** Read each frame by game-loop for shaft visibility / opacity composition. */
export const AtmosphereShaftState = {
    musicOpacity: 0,
    beatShimmer: 0,
    nightMoonbeam: false,
};

const _defaultAtmosphere = (musicBindings as any).atmosphere ?? {};

const _fallbackBloomChannels: readonly number[] = [0, ...musicBindings.biomes.global.shimmer];

let _bloomBinding: AtmosphereBloomBinding = {
    channels: toChannels(_defaultAtmosphere.bloom?.channels) ?? _fallbackBloomChannels,
    rest: typeof _defaultAtmosphere.bloom?.rest === 'number' ? _defaultAtmosphere.bloom.rest : 1.0,
    peak: typeof _defaultAtmosphere.bloom?.peak === 'number' ? _defaultAtmosphere.bloom.peak : 2.5,
    smoothing:
        typeof _defaultAtmosphere.bloom?.smoothing === 'number'
            ? _defaultAtmosphere.bloom.smoothing
            : 8.0,
};

let _fogBinding: AtmosphereFogBinding = {
    scale:
        typeof _defaultAtmosphere.fogDensity?.scale === 'number'
            ? _defaultAtmosphere.fogDensity.scale
            : 0.65,
    max:
        typeof _defaultAtmosphere.fogDensity?.max === 'number'
            ? _defaultAtmosphere.fogDensity.max
            : 0.85,
    smoothing:
        typeof _defaultAtmosphere.fogDensity?.smoothing === 'number'
            ? _defaultAtmosphere.fogDensity.smoothing
            : 6.0,
};

let _shaftBinding: AtmosphereShaftBinding = {
    peak:
        typeof _defaultAtmosphere.shaftMelody?.peak === 'number'
            ? _defaultAtmosphere.shaftMelody.peak
            : 0.35,
    smoothing:
        typeof _defaultAtmosphere.shaftMelody?.smoothing === 'number'
            ? _defaultAtmosphere.shaftMelody.smoothing
            : 10.0,
};

let _beatBinding: AtmosphereBeatBinding = {
    bloomSpike:
        typeof _defaultAtmosphere.beatPulse?.bloomSpike === 'number'
            ? _defaultAtmosphere.beatPulse.bloomSpike
            : 0.45,
    shaftShimmer:
        typeof _defaultAtmosphere.beatPulse?.shaftShimmer === 'number'
            ? _defaultAtmosphere.beatPulse.shaftShimmer
            : 0.12,
    decay:
        typeof _defaultAtmosphere.beatPulse?.decay === 'number'
            ? _defaultAtmosphere.beatPulse.decay
            : 12.0,
};

let _smoothedBassEnergy = 0;
let _smoothedMixEnergy = 0;
let _smoothedMelodyEnergy = 0;
let _beatBloomSpike = 0;
let _beatShaftShimmer = 0;

function _resetAtmosphereBindings(): void {
    _bloomBinding = {
        channels: toChannels(_defaultAtmosphere.bloom?.channels) ?? _fallbackBloomChannels,
        rest:
            typeof _defaultAtmosphere.bloom?.rest === 'number'
                ? _defaultAtmosphere.bloom.rest
                : 1.0,
        peak:
            typeof _defaultAtmosphere.bloom?.peak === 'number'
                ? _defaultAtmosphere.bloom.peak
                : 2.5,
        smoothing:
            typeof _defaultAtmosphere.bloom?.smoothing === 'number'
                ? _defaultAtmosphere.bloom.smoothing
                : 8.0,
    };
    _fogBinding = {
        scale:
            typeof _defaultAtmosphere.fogDensity?.scale === 'number'
                ? _defaultAtmosphere.fogDensity.scale
                : 0.65,
        max:
            typeof _defaultAtmosphere.fogDensity?.max === 'number'
                ? _defaultAtmosphere.fogDensity.max
                : 0.85,
        smoothing:
            typeof _defaultAtmosphere.fogDensity?.smoothing === 'number'
                ? _defaultAtmosphere.fogDensity.smoothing
                : 6.0,
    };
    _shaftBinding = {
        peak:
            typeof _defaultAtmosphere.shaftMelody?.peak === 'number'
                ? _defaultAtmosphere.shaftMelody.peak
                : 0.35,
        smoothing:
            typeof _defaultAtmosphere.shaftMelody?.smoothing === 'number'
                ? _defaultAtmosphere.shaftMelody.smoothing
                : 10.0,
    };
    _beatBinding = {
        bloomSpike:
            typeof _defaultAtmosphere.beatPulse?.bloomSpike === 'number'
                ? _defaultAtmosphere.beatPulse.bloomSpike
                : 0.45,
        shaftShimmer:
            typeof _defaultAtmosphere.beatPulse?.shaftShimmer === 'number'
                ? _defaultAtmosphere.beatPulse.shaftShimmer
                : 0.12,
        decay:
            typeof _defaultAtmosphere.beatPulse?.decay === 'number'
                ? _defaultAtmosphere.beatPulse.decay
                : 12.0,
    };
}

/** Reapply map overrides for atmosphere bindings (called when map music context changes). */
export function applyAtmosphereMapOverrides(
    overrides: { atmosphere?: Record<string, unknown> } | undefined
): void {
    _resetAtmosphereBindings();
    const atmosphere = overrides?.atmosphere;
    if (!atmosphere || typeof atmosphere !== 'object') return;

    const bloom = atmosphere.bloom as Record<string, unknown> | undefined;
    if (bloom) {
        const channels = toChannels(bloom.channels);
        if (channels) _bloomBinding.channels = channels;
        if (typeof bloom.rest === 'number' && Number.isFinite(bloom.rest))
            _bloomBinding.rest = bloom.rest;
        if (typeof bloom.peak === 'number' && Number.isFinite(bloom.peak))
            _bloomBinding.peak = bloom.peak;
        if (typeof bloom.smoothing === 'number' && Number.isFinite(bloom.smoothing))
            _bloomBinding.smoothing = bloom.smoothing;
    }

    const fog = atmosphere.fogDensity as Record<string, unknown> | undefined;
    if (fog) {
        if (typeof fog.scale === 'number' && Number.isFinite(fog.scale))
            _fogBinding.scale = fog.scale;
        if (typeof fog.max === 'number' && Number.isFinite(fog.max)) _fogBinding.max = fog.max;
        if (typeof fog.smoothing === 'number' && Number.isFinite(fog.smoothing))
            _fogBinding.smoothing = fog.smoothing;
    }

    const shaft = atmosphere.shaftMelody as Record<string, unknown> | undefined;
    if (shaft) {
        if (typeof shaft.peak === 'number' && Number.isFinite(shaft.peak))
            _shaftBinding.peak = shaft.peak;
        if (typeof shaft.smoothing === 'number' && Number.isFinite(shaft.smoothing))
            _shaftBinding.smoothing = shaft.smoothing;
    }

    const beat = atmosphere.beatPulse as Record<string, unknown> | undefined;
    if (beat) {
        if (typeof beat.bloomSpike === 'number' && Number.isFinite(beat.bloomSpike))
            _beatBinding.bloomSpike = beat.bloomSpike;
        if (typeof beat.shaftShimmer === 'number' && Number.isFinite(beat.shaftShimmer))
            _beatBinding.shaftShimmer = beat.shaftShimmer;
        if (typeof beat.decay === 'number' && Number.isFinite(beat.decay))
            _beatBinding.decay = beat.decay;
    }
}

export function triggerAtmosphereBeatPulse(kickStrength: number): void {
    const kick = Math.max(0, Math.min(1, kickStrength));
    const scale = 0.5 + kick * 0.5;
    _beatBloomSpike = Math.max(_beatBloomSpike, _beatBinding.bloomSpike * scale);
    _beatShaftShimmer = Math.max(_beatShaftShimmer, _beatBinding.shaftShimmer * scale);
}

export function registerAtmosphereBeatSync(beatSync: BeatSync): void {
    beatSync.onBeat((state) => {
        const kick = state?.kickTrigger || 0;
        if (kick > 0.2) triggerAtmosphereBeatPulse(kick);
    });
}

/**
 * Maps audio energy to bloom, crescendo fog, and shaft state.
 * Mutates uniform `.value` only — never reassigns TSL nodes.
 */
export function updateAtmosphereReactivity(
    audioState: AudioData | null,
    deltaTime: number,
    dayNightBias: number,
    isDay: boolean,
    weatherFogBoost = 0
): void {
    const channels = audioState?.channelData;
    const bloomCh = _bloomBinding.channels;

    // Kick / bass energy → uBloomStrength (Visual Impact: rest 1.0 → peak 2.5 on crescendo)
    const bassNorm = computeBassNorm(channels, bloomCh);
    _smoothedBassEnergy = smoothTowards(
        _smoothedBassEnergy,
        bassNorm,
        _bloomBinding.smoothing,
        deltaTime
    );

    // Mix energy → uCrescendoFogDensity (Visual Impact: candy-dream haze, not murky — capped at 0.85)
    const mixTarget = computeFogTarget(
        channels,
        _fogBinding.scale,
        _fogBinding.max,
        weatherFogBoost
    );
    _smoothedMixEnergy = smoothTowards(
        _smoothedMixEnergy,
        mixTarget,
        _fogBinding.smoothing,
        deltaTime
    );

    // Melody channel (sky_moon.melody_channel via MRState.skyMoonCh) → shaft opacity driver
    let melodyVol = 0;
    if (channels && MRState.skyMoonCh < channels.length) {
        melodyVol = channels[MRState.skyMoonCh].volume || 0;
    }
    _smoothedMelodyEnergy = smoothTowards(
        _smoothedMelodyEnergy,
        melodyVol,
        _shaftBinding.smoothing,
        deltaTime
    );

    // Decay beat spikes smoothly
    _beatBloomSpike = decayBeatSpike(_beatBloomSpike, _beatBinding.decay, deltaTime);
    _beatShaftShimmer = decayBeatSpike(_beatShaftShimmer, _beatBinding.decay, deltaTime);

    if (!channels) {
        _smoothedBassEnergy = smoothTowards(
            _smoothedBassEnergy,
            0,
            _bloomBinding.smoothing,
            deltaTime
        );
        _smoothedMixEnergy = smoothTowards(
            _smoothedMixEnergy,
            weatherFogBoost > 0 ? Math.min(_fogBinding.max, weatherFogBoost * 0.35) : 0,
            _fogBinding.smoothing,
            deltaTime
        );
        _smoothedMelodyEnergy = smoothTowards(
            _smoothedMelodyEnergy,
            0,
            _shaftBinding.smoothing,
            deltaTime
        );
    }

    const nightGate = computeNightGate(dayNightBias);
    const bloomTarget = computeBloomTarget(
        _smoothedBassEnergy,
        _bloomBinding.rest,
        _bloomBinding.peak,
        nightGate,
        _beatBloomSpike
    );
    const currentBloom = uBloomStrength.value as number;
    uBloomStrength.value = smoothTowards(
        currentBloom,
        bloomTarget,
        _bloomBinding.smoothing,
        deltaTime
    );

    const currentFog = uCrescendoFogDensity.value as number;
    uCrescendoFogDensity.value = smoothTowards(
        currentFog,
        _smoothedMixEnergy,
        _fogBinding.smoothing,
        deltaTime
    );

    const melodyShaft = computeMelodyShaft(_smoothedMelodyEnergy, _shaftBinding.peak);
    AtmosphereShaftState.musicOpacity = melodyShaft;
    AtmosphereShaftState.beatShimmer = _beatShaftShimmer;
    AtmosphereShaftState.nightMoonbeam =
        !isDay && (melodyShaft > 0.02 || _beatShaftShimmer > 0.005);
}
