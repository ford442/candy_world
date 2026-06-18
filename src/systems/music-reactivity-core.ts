import * as THREE from 'three';
import { CONFIG, CYCLE_DURATION } from '../core/config.ts';
import { getDayNightBias } from '../core/cycle.ts';
import { animateFoliage } from '../foliage/animation.ts';
import { foliageBatcher } from '../foliage/batcher/index.ts';
import { arpeggioFernBatcher } from '../foliage/arpeggio-batcher.ts';
import { portamentoPineBatcher } from '../foliage/portamento-batcher.ts';
import { mushroomBatcher } from '../foliage/mushroom-batcher.ts';
import { flowerBatcher } from '../foliage/flower-batcher.ts';
import { simpleFlowerBatcher } from '../foliage/simple-flower-batcher.ts';
import { kickDrumGeyserBatcher } from '../foliage/kick-drum-geyser-batcher.ts';
import { subwooferLotusBatcher } from '../foliage/subwoofer-lotus-batcher.ts';
import type { AudioData, FoliageObject } from '../foliage/types.ts';
import { BiomeUniforms, SkyUniforms, LuminousPlantUniforms } from './biome-uniforms.ts';
import { uTwilight } from '../foliage/sky.ts';
import { BeatSync } from '../audio/beat-sync.ts';
import {
    defaultArpeggioShimmerCh, defaultArpeggioHueShiftCh, defaultArpeggioNoteColorCh,
    defaultNebulaShimmerCh, defaultNebulaAmplitudeCh, defaultNebulaNoteColorCh,
    defaultSkyMoonNoteColorCh, defaultSkyMoonIntensityCh, defaultGlobalShimmerCh,
    defaultGlobalHueShiftCh, defaultGlobalNoteColorCh, defaultSkyMoonMelodyCh,
    defaultLuminousPlantTrackerChannel, defaultGemCanopyShimmerCh, defaultGemCanopyHueShiftCh,
    defaultGemCanopyNoteColorCh, WeatherReactivityBinding, defaultWeatherBindings,
    defaultSkyWavePropagationMs, defaultSkyWaveDecayMs, defaultSkyWaveTargets,
    skyWaveUniformMap, CHROMATIC_SCALE
} from './music-reactivity-defaults.ts';

import { getMapMusicContext } from '../world/map-music-context.ts';
import type { MapMusicOverrides } from '../world/map-loader.ts';









// ⚡ OPTIMIZATION: Per-frame scratch floats — no per-frame object allocations.







 // The active MIDI note (e.g., 60 for C4)




// ⚡ OPTIMIZATION: Module-scoped colors for zero-allocation note lerping

export const MRState = {
    arpeggioShimmerCh: defaultArpeggioShimmerCh as readonly number[],
    arpeggioHueShiftCh: defaultArpeggioHueShiftCh as readonly number[],
    arpeggioNoteColorCh: defaultArpeggioNoteColorCh as readonly number[],
    nebulaShimmerCh: defaultNebulaShimmerCh as readonly number[],
    nebulaAmplitudeCh: defaultNebulaAmplitudeCh as readonly number[],
    nebulaNoteColorCh: defaultNebulaNoteColorCh as readonly number[],
    skyMoonNoteColorCh: defaultSkyMoonNoteColorCh as readonly number[],
    skyMoonIntensityCh: defaultSkyMoonIntensityCh as readonly number[],
    globalShimmerCh: defaultGlobalShimmerCh as readonly number[],
    globalHueShiftCh: defaultGlobalHueShiftCh as readonly number[],
    globalNoteColorCh: defaultGlobalNoteColorCh as readonly number[],
    gemCanopyShimmerCh: defaultGemCanopyShimmerCh as readonly number[],
    gemCanopyHueShiftCh: defaultGemCanopyHueShiftCh as readonly number[],
    gemCanopyNoteColorCh: defaultGemCanopyNoteColorCh as readonly number[],
    arpeggioIntensityScale: 1.0,
    nebulaIntensityScale: 1.0,
    globalIntensityScale: 1.0,
    gemCanopyIntensityScale: 1.0,
    skyMoonIntensityScale: 1.0,
    luminousIntensityScale: 1.0,
    arpeggioShimmerAccum: 0.0,
    arpeggioHueShiftAccum: 0.0,
    nebulaShimmerAccum: 0.0,
    nebulaAmplitudeAccum: 0.0,
    skyMoonIntensityAccum: 0.0,
    globalShimmerAccum: 0.0,
    globalHueShiftAccum: 0.0,
    gemCanopyShimmerAccum: 0.0,
    gemCanopyHueShiftAccum: 0.0,
    skyMoonNoteVal: 0.0,
    arpeggioNoteVal: 0.0,
    nebulaNoteVal: 0.0,
    globalNoteVal: 0.0,
    gemCanopyNoteVal: 0.0,
    skyMoonCh: defaultSkyMoonMelodyCh,
    luminousPlantTrackerChannel: defaultLuminousPlantTrackerChannel,
    smoothedSkyIntensity: 0.0,
    lastSkyNoteIndex: 0.0,
    weatherBindings: {
        rainIntensity: defaultWeatherBindings.rainIntensity ? { ...defaultWeatherBindings.rainIntensity } : undefined,
        thunderPulse: defaultWeatherBindings.thunderPulse ? { ...defaultWeatherBindings.thunderPulse } : undefined,
        fogDensity: defaultWeatherBindings.fogDensity ? { ...defaultWeatherBindings.fogDensity } : undefined,
    } as any,
    skyWavePropagationMs: defaultSkyWavePropagationMs,
    skyWaveDecayMs: defaultSkyWaveDecayMs,
    skyWaveTargets: defaultSkyWaveTargets as readonly string[],
    activeWave: null as any,
    waveDecayStartTime: 0,
    channelValidationDone: false,
    appliedMapMusicVersion: -1,
};

export const _targetMoonColor = new THREE.Color(0xffffff);
export const _targetArpeggioColor = new THREE.Color(0xffffff);
export const _targetNebulaColor = new THREE.Color(0xffffff);
export const _targetGlobalColor = new THREE.Color(0xffffff);
export const _targetGemCanopyColor = new THREE.Color(0xffffff);

// ⚡ OPTIMIZATION: Sky/Moon note reactivity scratch — allocated once, never in hot path.
// melody_channel from assets/music-bindings.json sky_moon block.



// Last valid note index (0–127) kept across frames to avoid flicker when channel is silent.


// ⚡ OPTIMIZATION: Reusable Frustum & Matrices
export const _frustum = new THREE.Frustum();
export const _projScreenMatrix = new THREE.Matrix4();
export const _scratchSphere = new THREE.Sphere(); // Reusable for Group culling checks

// ⚡ OPTIMIZATION: Reusable scratch array for species list
const _scratchSpeciesList: string[] = [];

// --- Weather Music Reactivity ---
// Parsed once at module init from assets/music-bindings.json weatherReactivity block.

// ⚡ SKY WAVE config from music-bindings.json




// Map from sky_wave.target_biomes keys (in music-bindings.json) → the Color uniform to receive the propagating hue.
// This makes the wave fully data-driven. Adding a new target = add key here + entry in JSON list.
// Many foliage already consume arpeggioGrove.noteColor or crystallineNebula.noteColor (portamento, wisteria, trees, mushrooms),
// so they receive the sky wave "for free" when those hubs are targeted.


// ⚡ SKY WAVE state — pre-allocated, zero per-frame allocations in hot path
export interface ActiveWave { color: THREE.Color; timestamp: number; origin?: THREE.Vector3; speed?: number; }


export const _zeroVec = new THREE.Vector3();
export function computeWaveTimeSinceArrival(plantWorldPos: THREE.Vector3, activeWave: ActiveWave | null, cameraPosition?: THREE.Vector3): number {
    if (!activeWave) return -999;
    const origin = activeWave.origin || cameraPosition || _zeroVec;
    const speed = activeWave.speed || 25.0;
    // ⚡ OPTIMIZATION: Bypassed THREE.Vector3.distanceTo() overhead in hot loop with raw math
    const dx = plantWorldPos.x - origin.x;
    const dy = plantWorldPos.y - origin.y;
    const dz = plantWorldPos.z - origin.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const arrivalTime = activeWave.timestamp + (distance / speed) * 1000;
    return (performance.now() - arrivalTime) / 1000;
}
export const _waveColor = new THREE.Color(); // scratch for beat capture
export const _whiteColor = new THREE.Color(0xffffff);


// One-time validation flag for channel range checks against music-bindings.json



export function toChannels(value: unknown): readonly number[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const sanitized: number[] = [];
    for (let i = 0; i < value.length; i++) {
        const channel = value[i];
        if (Number.isInteger(channel) && channel >= 0 && channel <= 255) sanitized.push(channel as number);
    }
    return sanitized.length > 0 ? sanitized : undefined;
}

export function applyMapMusicContext(overrides: MapMusicOverrides | undefined): void {
    MRState.arpeggioShimmerCh = defaultArpeggioShimmerCh;
    MRState.arpeggioHueShiftCh = defaultArpeggioHueShiftCh;
    MRState.arpeggioNoteColorCh = defaultArpeggioNoteColorCh;
    MRState.nebulaShimmerCh = defaultNebulaShimmerCh;
    MRState.nebulaAmplitudeCh = defaultNebulaAmplitudeCh;
    MRState.nebulaNoteColorCh = defaultNebulaNoteColorCh;
    MRState.skyMoonNoteColorCh = defaultSkyMoonNoteColorCh;
    MRState.skyMoonIntensityCh = defaultSkyMoonIntensityCh;
    MRState.globalShimmerCh = defaultGlobalShimmerCh;
    MRState.globalHueShiftCh = defaultGlobalHueShiftCh;
    MRState.globalNoteColorCh = defaultGlobalNoteColorCh;
    MRState.gemCanopyShimmerCh = defaultGemCanopyShimmerCh;
    MRState.gemCanopyHueShiftCh = defaultGemCanopyHueShiftCh;
    MRState.gemCanopyNoteColorCh = defaultGemCanopyNoteColorCh;

    MRState.arpeggioIntensityScale = 1.0;
    MRState.nebulaIntensityScale = 1.0;
    MRState.globalIntensityScale = 1.0;
    MRState.gemCanopyIntensityScale = 1.0;
    MRState.skyMoonIntensityScale = 1.0;
    MRState.luminousIntensityScale = 1.0;

    MRState.skyMoonCh = defaultSkyMoonMelodyCh;
    MRState.luminousPlantTrackerChannel = defaultLuminousPlantTrackerChannel;

    MRState.weatherBindings = {
        rainIntensity: defaultWeatherBindings.rainIntensity ? { ...defaultWeatherBindings.rainIntensity } : undefined,
        thunderPulse: defaultWeatherBindings.thunderPulse ? { ...defaultWeatherBindings.thunderPulse } : undefined,
        fogDensity: defaultWeatherBindings.fogDensity ? { ...defaultWeatherBindings.fogDensity } : undefined,
    };
    MRState.skyWavePropagationMs = defaultSkyWavePropagationMs;
    MRState.skyWaveDecayMs = defaultSkyWaveDecayMs;
    MRState.skyWaveTargets = defaultSkyWaveTargets;

    const biomeOverrides = overrides?.biomes;
    if (biomeOverrides && typeof biomeOverrides === 'object') {
        const arpeggio = biomeOverrides.arpeggio_grove;
        const nebula = biomeOverrides.crystalline_nebula;
        const skyMoon = biomeOverrides.sky_moon;
        const global = biomeOverrides.global;
        const gemCanopy = biomeOverrides.gem_canopy;
        if (arpeggio) {
            MRState.arpeggioShimmerCh = toChannels(arpeggio.shimmer) ?? MRState.arpeggioShimmerCh;
            MRState.arpeggioHueShiftCh = toChannels(arpeggio.hueShift) ?? MRState.arpeggioHueShiftCh;
            MRState.arpeggioNoteColorCh = toChannels(arpeggio.noteColor) ?? MRState.arpeggioNoteColorCh;
            if (typeof arpeggio.intensityScale === 'number' && Number.isFinite(arpeggio.intensityScale)) {
                MRState.arpeggioIntensityScale = arpeggio.intensityScale;
            }
        }
        if (nebula) {
            MRState.nebulaShimmerCh = toChannels(nebula.shimmer) ?? MRState.nebulaShimmerCh;
            MRState.nebulaAmplitudeCh = toChannels(nebula.amplitudeScale) ?? MRState.nebulaAmplitudeCh;
            MRState.nebulaNoteColorCh = toChannels(nebula.noteColor) ?? MRState.nebulaNoteColorCh;
            if (typeof nebula.intensityScale === 'number' && Number.isFinite(nebula.intensityScale)) {
                MRState.nebulaIntensityScale = nebula.intensityScale;
            }
        }
        if (skyMoon) {
            MRState.skyMoonNoteColorCh = toChannels(skyMoon.noteColor) ?? MRState.skyMoonNoteColorCh;
            MRState.skyMoonIntensityCh = toChannels(skyMoon.intensity) ?? MRState.skyMoonIntensityCh;
            if (typeof skyMoon.intensityScale === 'number' && Number.isFinite(skyMoon.intensityScale)) {
                MRState.skyMoonIntensityScale = skyMoon.intensityScale;
            }
        }
        if (global) {
            MRState.globalShimmerCh = toChannels(global.shimmer) ?? MRState.globalShimmerCh;
            MRState.globalHueShiftCh = toChannels(global.hueShift) ?? MRState.globalHueShiftCh;
            MRState.globalNoteColorCh = toChannels(global.noteColor) ?? MRState.globalNoteColorCh;
            if (typeof global.intensityScale === 'number' && Number.isFinite(global.intensityScale)) {
                MRState.globalIntensityScale = global.intensityScale;
            }
        }
        if (gemCanopy) {
            MRState.gemCanopyShimmerCh = toChannels(gemCanopy.shimmer) ?? MRState.gemCanopyShimmerCh;
            MRState.gemCanopyHueShiftCh = toChannels(gemCanopy.hueShift) ?? MRState.gemCanopyHueShiftCh;
            MRState.gemCanopyNoteColorCh = toChannels(gemCanopy.noteColor) ?? MRState.gemCanopyNoteColorCh;
            if (typeof gemCanopy.intensityScale === 'number' && Number.isFinite(gemCanopy.intensityScale)) {
                MRState.gemCanopyIntensityScale = gemCanopy.intensityScale;
            }
        }
    }

    if (typeof overrides?.skyMoon?.melodyChannel === 'number' && Number.isInteger(overrides.skyMoon.melodyChannel)) {
        MRState.skyMoonCh = overrides.skyMoon.melodyChannel;
    }
    if (typeof overrides?.luminousPlants?.trackerChannel === 'number' && Number.isInteger(overrides.luminousPlants.trackerChannel)) {
        MRState.luminousPlantTrackerChannel = overrides.luminousPlants.trackerChannel;
    }
    if (typeof overrides?.luminousPlants?.baseIntensity === 'number' && Number.isFinite(overrides.luminousPlants.baseIntensity)) {
        MRState.luminousIntensityScale = overrides.luminousPlants.baseIntensity;
    }
    if (typeof overrides?.skyWave?.propagationMs === 'number' && Number.isFinite(overrides.skyWave.propagationMs)) {
        MRState.skyWavePropagationMs = Math.max(100, overrides.skyWave.propagationMs);
    }
    if (typeof overrides?.skyWave?.decayMs === 'number' && Number.isFinite(overrides.skyWave.decayMs)) {
        MRState.skyWaveDecayMs = Math.max(100, overrides.skyWave.decayMs);
    }
    if (Array.isArray(overrides?.skyWave?.targetBiomes) && overrides.skyWave.targetBiomes.length > 0) {
        const filteredTargets = overrides.skyWave.targetBiomes.filter((name: string) => typeof name === 'string');
        if (filteredTargets.length > 0) MRState.skyWaveTargets = filteredTargets;
    }
    if (overrides?.weatherReactivity && typeof overrides.weatherReactivity === 'object') {
        const keys: Array<'rainIntensity' | 'thunderPulse' | 'fogDensity'> = ['rainIntensity', 'thunderPulse', 'fogDensity'];
        for (const key of keys) {
            const current = MRState.weatherBindings[key];
            const override = overrides.weatherReactivity[key];
            if (!override || typeof override !== 'object') continue;
            const merged: WeatherReactivityBinding = {
                channel: typeof override.channel === 'number' ? override.channel : current?.channel ?? 0,
                smoothing: typeof override.smoothing === 'number' ? override.smoothing : current?.smoothing ?? 0.15,
                scale: typeof override.scale === 'number' ? override.scale : current?.scale ?? 1.0,
            };
            MRState.weatherBindings[key] = merged;
        }
    }

    MRState.channelValidationDone = false;
}

export function syncMapMusicContext(): void {
    const context = getMapMusicContext();
    if (context.version === MRState.appliedMapMusicVersion) return;
    MRState.appliedMapMusicVersion = context.version;
    applyMapMusicContext(context.overrides);
}

// Helper to map MIDI note (0-127) to a color hue
// Helper to map MIDI note (0-127) to a color using CONFIG.noteColorMap.sky
export function mapNoteToColor(note: number, outColor: THREE.Color, palette: string = 'global') {
    if (note <= 0) return outColor.setHex(0xffffff);
    const pitchClass = note % 12;
    const noteName = CHROMATIC_SCALE[pitchClass];
    const speciesMap = CONFIG.noteColorMap[palette] || CONFIG.noteColorMap.global;
    const hexColor = speciesMap[noteName] || CONFIG.noteColorMap.global[noteName] || 0xffffff;
    outColor.setHex(hexColor);
    return outColor;
}

// --- Type Definitions ---

interface MoonState {
    isBlinking: boolean;
    blinkStartTime: number;
    nextBlinkTime: number;
    baseScale: THREE.Vector3;
    dancePhase: number;
}

// Minimal interface for WeatherSystem based on usage
export interface IWeatherSystem {
    getTwilightGlowIntensity?(cyclePos: number): number;
    isNight(): boolean;
}

// Caches to prevent repeated lookups (migrated from core idea)
const _noteNameCache: Record<string | number, string> = {};
