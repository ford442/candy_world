import type { NoteName } from './scales.ts';
import { SCALES } from './scales.ts';

/**
 * Generative music palette per biome.
 * Extends the MUSIC_MAP_BINDING model: biome → scale/mood/tempo.
 * Crossfaded at runtime as the player moves between regions.
 */
export interface BiomeMusicProfile {
    /** Biome tag (matches map regions + music-bindings.json keys). */
    id: string;
    root: NoteName;
    scale: readonly number[];
    /** Base tempo BPM at day. */
    tempo: number;
    /** Night tempo multiplier (0.7–1.0). */
    nightTempoScale: number;
    /** Filter brightness 0–1 (lower = darker/moodier). */
    brightness: number;
    /** Swing/groove 0–1. */
    groove: number;
    /** Per-channel activity weights (8 tracker channels). */
    channelDensity: readonly number[];
    /** Mood label for UI. */
    mood: string;
}

const DEFAULT_DENSITY: readonly number[] = [1, 0.7, 0.8, 0.6, 0.5, 0.4, 0.3, 0.35];

export const BIOME_PROFILES: Record<string, BiomeMusicProfile> = {
    global: {
        id: 'global',
        root: 'C',
        scale: SCALES.major,
        tempo: 92,
        nightTempoScale: 0.85,
        brightness: 0.65,
        groove: 0.15,
        channelDensity: DEFAULT_DENSITY,
        mood: 'meadow',
    },
    arpeggio_grove: {
        id: 'arpeggio_grove',
        root: 'G',
        scale: SCALES.lydian,
        tempo: 108,
        nightTempoScale: 0.9,
        brightness: 0.75,
        groove: 0.25,
        channelDensity: [0.8, 0.9, 0.7, 1.0, 0.95, 0.6, 0.5, 0.4],
        mood: 'sparkling',
    },
    crystalline_nebula: {
        id: 'crystalline_nebula',
        root: 'E',
        scale: SCALES.dorian,
        tempo: 118,
        nightTempoScale: 0.95,
        brightness: 0.85,
        groove: 0.35,
        channelDensity: [1.0, 0.95, 0.85, 0.5, 0.45, 0.55, 0.6, 0.5],
        mood: 'crystalline',
    },
    musical_flora: {
        id: 'musical_flora',
        root: 'D',
        scale: SCALES.pentatonic,
        tempo: 100,
        nightTempoScale: 0.88,
        brightness: 0.7,
        groove: 0.2,
        channelDensity: [0.85, 0.8, 0.9, 0.85, 0.7, 0.5, 0.45, 0.4],
        mood: 'floral',
    },
    gem_canopy: {
        id: 'gem_canopy',
        root: 'A',
        scale: SCALES.minor,
        tempo: 96,
        nightTempoScale: 0.82,
        brightness: 0.6,
        groove: 0.18,
        channelDensity: [0.75, 0.85, 0.65, 0.7, 0.6, 0.55, 0.5, 0.45],
        mood: 'jeweled',
    },
    luminous_plants: {
        id: 'luminous_plants',
        root: 'F',
        scale: SCALES.dorian,
        tempo: 88,
        nightTempoScale: 0.78,
        brightness: 0.55,
        groove: 0.12,
        channelDensity: [0.7, 0.75, 1.0, 0.6, 0.55, 0.65, 0.5, 0.4],
        mood: 'bioluminescent',
    },
    sky_moon: {
        id: 'sky_moon',
        root: 'B',
        scale: SCALES.phrygian,
        tempo: 72,
        nightTempoScale: 1.0,
        brightness: 0.45,
        groove: 0.08,
        channelDensity: [0.5, 0.6, 1.0, 0.4, 0.35, 0.7, 0.55, 0.5],
        mood: 'nocturne',
    },
    lake_features: {
        id: 'lake_features',
        root: 'C',
        scale: SCALES.major,
        tempo: 84,
        nightTempoScale: 0.8,
        brightness: 0.6,
        groove: 0.1,
        channelDensity: [0.6, 0.65, 0.75, 0.7, 0.65, 0.5, 0.4, 0.35],
        mood: 'reflective',
    },
};

export function getBiomeProfile(biomeId: string): BiomeMusicProfile {
    return BIOME_PROFILES[biomeId] ?? BIOME_PROFILES.global;
}

/** Linear blend between two biome profiles (allocation-free scratch target). */
export function blendProfiles(
    a: BiomeMusicProfile,
    b: BiomeMusicProfile,
    t: number,
    out: BiomeMusicProfile
): BiomeMusicProfile {
    const w = Math.max(0, Math.min(1, t));
    out.id = w < 0.5 ? a.id : b.id;
    out.root = w < 0.5 ? a.root : b.root;
    out.scale = w < 0.5 ? a.scale : b.scale;
    out.tempo = a.tempo * (1 - w) + b.tempo * w;
    out.nightTempoScale = a.nightTempoScale * (1 - w) + b.nightTempoScale * w;
    out.brightness = a.brightness * (1 - w) + b.brightness * w;
    out.groove = a.groove * (1 - w) + b.groove * w;
    out.mood = w < 0.5 ? a.mood : b.mood;
    if (!out.channelDensity || out.channelDensity.length !== 8) {
        (out as { channelDensity: number[] }).channelDensity = new Array(8).fill(0);
    }
    const cd = out.channelDensity as number[];
    for (let i = 0; i < 8; i++) {
        cd[i] = a.channelDensity[i] * (1 - w) + b.channelDensity[i] * w;
    }
    return out;
}

/** Module-scoped scratch for crossfade — never allocate in hot path. */
export const _blendScratch: BiomeMusicProfile = {
    id: 'global',
    root: 'C',
    scale: SCALES.major,
    tempo: 92,
    nightTempoScale: 0.85,
    brightness: 0.65,
    groove: 0.15,
    channelDensity: [1, 0.7, 0.8, 0.6, 0.5, 0.4, 0.3, 0.35],
    mood: 'meadow',
};
