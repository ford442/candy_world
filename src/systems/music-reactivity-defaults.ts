import * as THREE from 'three';
import musicBindings from '../../assets/music-bindings.json';
import { BiomeUniforms, LuminousPlantUniforms } from './biome-uniforms.ts';

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

const _skyMoonConfig = (musicBindings as any).sky_moon;
if (!_skyMoonConfig || typeof _skyMoonConfig.melody_channel !== 'number') {
    throw new Error('[MusicReactivity] Missing or invalid sky_moon.melody_channel in music-bindings.json');
}
export const defaultSkyMoonMelodyCh: number = _skyMoonConfig.melody_channel as number;
export const defaultLuminousPlantTrackerChannel: number = (musicBindings as any).luminous_plants?.tracker_channel ?? 2;

export interface WeatherReactivityBinding {
    channel: number;
    smoothing: number;
    scale: number;
}
export const defaultWeatherBindings: {
    rainIntensity?: WeatherReactivityBinding;
    thunderPulse?: WeatherReactivityBinding;
    fogDensity?: WeatherReactivityBinding;
} = (musicBindings as any).weatherReactivity ?? {};

const _skyWaveConfig = (musicBindings as any).sky_wave;
export const defaultSkyWavePropagationMs = _skyWaveConfig?.propagation_ms ?? 800;
export const defaultSkyWaveDecayMs = _skyWaveConfig?.decay_ms ?? 2000;
export const defaultSkyWaveTargets: readonly string[] = _skyWaveConfig?.target_biomes ?? ['arpeggio_grove', 'crystalline_nebula', 'luminous_plants', 'sky_moon', 'global', 'musical_flora', 'lake_features'];

export const skyWaveUniformMap: Record<string, { value: THREE.Color }> = {
  arpeggio_grove: BiomeUniforms.arpeggioGrove.noteColor,
  crystalline_nebula: BiomeUniforms.crystallineNebula.noteColor,
  luminous_plants: LuminousPlantUniforms.noteColor as any,
  musical_flora: BiomeUniforms.musicalFlora.noteColor,
  lake_features: BiomeUniforms.lakeFeatures.noteColor,
  global: BiomeUniforms.global.noteColor,
  sky_moon: BiomeUniforms.skyMoon.moonNoteColor as any,
};

export const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
