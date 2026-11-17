import * as THREE from 'three';
import musicBindings from '../../../assets/music-bindings.json';
import { BiomeUniforms, LuminousPlantUniforms } from '../biome-uniforms.ts';

/** Per-biome channel lists read from music-bindings.json. */
interface BiomeChannelBindings {
    shimmer: number[];
    hueShift: number[];
    noteColor: number[];
}

/**
 * The parts of music-bindings.json read below with a fallback. Declared optional
 * so the defaults keep working if a key is dropped from the file; the JSON's
 * inferred type is checked against this at compile time.
 */
interface MusicBindingsFile {
    biomes: {
        gem_canopy: BiomeChannelBindings;
        sky_islands: BiomeChannelBindings & {
            fog?: { channels?: number[]; rest?: number; peak?: number };
        };
        sugar_caves: BiomeChannelBindings;
        night_market: BiomeChannelBindings;
    };
    sky_moon?: { melody_channel?: unknown };
    luminous_plants?: { tracker_channel?: number };
    weatherReactivity?: {
        rainIntensity?: WeatherReactivityBinding;
        thunderPulse?: WeatherReactivityBinding;
        fogDensity?: WeatherReactivityBinding;
    };
    sky_wave?: { propagation_ms?: number; decay_ms?: number; target_biomes?: string[] };
}

const bindings: MusicBindingsFile = musicBindings;

// ⚡ OPTIMIZATION: Pre-parsed channel index arrays from music-bindings.json.
export const defaultArpeggioShimmerCh: readonly number[] = musicBindings.biomes.arpeggio_grove.shimmer;
export const defaultArpeggioHueShiftCh: readonly number[] = musicBindings.biomes.arpeggio_grove.hueShift;
export const defaultArpeggioNoteColorCh: readonly number[] = musicBindings.biomes.arpeggio_grove.noteColor;
export const defaultNebulaShimmerCh: readonly number[] = musicBindings.biomes.crystalline_nebula.shimmer;
export const defaultNebulaAmplitudeCh: readonly number[] = musicBindings.biomes.crystalline_nebula.amplitudeScale;
export const defaultNebulaNoteColorCh: readonly number[] = musicBindings.biomes.crystalline_nebula.noteColor;
export const defaultSkyMoonNoteColorCh: readonly number[] = musicBindings.biomes.sky_moon.noteColor;
export const defaultSkyMoonIntensityCh: readonly number[] = musicBindings.biomes.sky_moon.intensity;
export const defaultGlobalShimmerCh: readonly number[] = musicBindings.biomes.global.shimmer;
export const defaultGlobalHueShiftCh: readonly number[] = musicBindings.biomes.global.hueShift;
export const defaultGlobalNoteColorCh: readonly number[] = musicBindings.biomes.global.noteColor;
export const defaultGemCanopyShimmerCh: readonly number[] = bindings.biomes.gem_canopy.shimmer;
export const defaultGemCanopyHueShiftCh: readonly number[] = bindings.biomes.gem_canopy.hueShift;
export const defaultGemCanopyNoteColorCh: readonly number[] = bindings.biomes.gem_canopy.noteColor;
export const defaultSkyIslandsShimmerCh: readonly number[] = bindings.biomes.sky_islands.shimmer;
export const defaultSkyIslandsHueShiftCh: readonly number[] = bindings.biomes.sky_islands.hueShift;
export const defaultSkyIslandsNoteColorCh: readonly number[] = bindings.biomes.sky_islands.noteColor;
export const defaultSkyIslandsFogCh: readonly number[] = bindings.biomes.sky_islands.fog?.channels ?? [5];
export const defaultSkyIslandsFogRest: number = bindings.biomes.sky_islands.fog?.rest ?? 0.15;
export const defaultSkyIslandsFogPeak: number = bindings.biomes.sky_islands.fog?.peak ?? 0.55;
export const defaultSugarCavesShimmerCh: readonly number[] = bindings.biomes.sugar_caves.shimmer;
export const defaultSugarCavesHueShiftCh: readonly number[] = bindings.biomes.sugar_caves.hueShift;
export const defaultSugarCavesNoteColorCh: readonly number[] = bindings.biomes.sugar_caves.noteColor;
export const defaultNightMarketShimmerCh: readonly number[] = bindings.biomes.night_market.shimmer;
export const defaultNightMarketHueShiftCh: readonly number[] = bindings.biomes.night_market.hueShift;
export const defaultNightMarketNoteColorCh: readonly number[] = bindings.biomes.night_market.noteColor;

const _skyMoonConfig = bindings.sky_moon;
if (!_skyMoonConfig || typeof _skyMoonConfig.melody_channel !== 'number') {
    throw new Error('[MusicReactivity] Missing or invalid sky_moon.melody_channel in music-bindings.json');
}
export const defaultSkyMoonMelodyCh: number = _skyMoonConfig.melody_channel as number;
export const defaultLuminousPlantTrackerChannel: number = bindings.luminous_plants?.tracker_channel ?? 2;

export interface WeatherReactivityBinding {
    channel: number;
    smoothing: number;
    scale: number;
}
export const defaultWeatherBindings: {
    rainIntensity?: WeatherReactivityBinding;
    thunderPulse?: WeatherReactivityBinding;
    fogDensity?: WeatherReactivityBinding;
} = bindings.weatherReactivity ?? {};

const _skyWaveConfig = bindings.sky_wave;
export const defaultSkyWavePropagationMs = _skyWaveConfig?.propagation_ms ?? 800;
export const defaultSkyWaveDecayMs = _skyWaveConfig?.decay_ms ?? 2000;
export const defaultSkyWaveTargets: readonly string[] = _skyWaveConfig?.target_biomes ?? ['arpeggio_grove', 'crystalline_nebula', 'luminous_plants', 'sky_moon', 'global', 'musical_flora', 'lake_features', 'sky_islands'];

export const skyWaveUniformMap: Record<string, { value: THREE.Color }> = {
  arpeggio_grove: BiomeUniforms.arpeggioGrove.noteColor,
  crystalline_nebula: BiomeUniforms.crystallineNebula.noteColor,
  luminous_plants: LuminousPlantUniforms.noteColor,
  musical_flora: BiomeUniforms.musicalFlora.noteColor,
  lake_features: BiomeUniforms.lakeFeatures.noteColor,
  global: BiomeUniforms.global.noteColor,
  gem_canopy: BiomeUniforms.gemCanopy.noteColor,
  sky_islands: BiomeUniforms.skyIslands.noteColor,
  sugar_caves: BiomeUniforms.sugarCaves.noteColor,
  night_market: BiomeUniforms.nightMarket.noteColor,
  sky_moon: BiomeUniforms.skyMoon.moonNoteColor,
};

export const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
