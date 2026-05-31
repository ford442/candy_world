import type {
    CandyMapData,
    MapMusicChannelBinding,
    MapMusicHints,
    MapMusicOverrides,
    MapRegion,
    MapWeatherBinding,
} from './map-loader.ts';

interface MusicContextState {
    version: number;
    overrides: MapMusicOverrides;
}

const _state: MusicContextState = {
    version: 0,
    overrides: {},
};

const _biomeIntensityAccum = new Map<string, { sum: number; count: number }>();

function cloneChannelList(channels: number[] | undefined): number[] | undefined {
    if (!channels || channels.length === 0) return undefined;
    const unique = new Set<number>();
    for (let i = 0; i < channels.length; i++) unique.add(channels[i]);
    return Array.from(unique.values());
}

function cloneWeatherBinding(binding: MapWeatherBinding | undefined): MapWeatherBinding | undefined {
    if (!binding) return undefined;
    return {
        channel: binding.channel,
        smoothing: binding.smoothing,
        scale: binding.scale,
    };
}

function cloneOverrides(base: MapMusicOverrides | undefined): MapMusicOverrides {
    if (!base || typeof base !== 'object') return {};
    const cloned: MapMusicOverrides = {};
    if (base.profile) cloned.profile = base.profile;
    if (base.biomes) {
        cloned.biomes = {};
        for (const [biome, binding] of Object.entries(base.biomes)) {
            cloned.biomes[biome] = {
                shimmer: cloneChannelList(binding.shimmer),
                hueShift: cloneChannelList(binding.hueShift),
                noteColor: cloneChannelList(binding.noteColor),
                amplitudeScale: cloneChannelList(binding.amplitudeScale),
                intensity: cloneChannelList(binding.intensity),
                intensityScale: binding.intensityScale,
            };
        }
    }
    if (base.skyMoon) {
        cloned.skyMoon = {
            melodyChannel: base.skyMoon.melodyChannel,
            baseMoonIntensity: base.skyMoon.baseMoonIntensity,
        };
    }
    if (base.luminousPlants) {
        cloned.luminousPlants = {
            trackerChannel: base.luminousPlants.trackerChannel,
            baseIntensity: base.luminousPlants.baseIntensity,
        };
    }
    if (base.skyWave) {
        cloned.skyWave = {
            propagationMs: base.skyWave.propagationMs,
            decayMs: base.skyWave.decayMs,
            targetBiomes: base.skyWave.targetBiomes ? [...base.skyWave.targetBiomes] : undefined,
        };
    }
    if (base.weatherReactivity) {
        cloned.weatherReactivity = {
            rainIntensity: cloneWeatherBinding(base.weatherReactivity.rainIntensity),
            thunderPulse: cloneWeatherBinding(base.weatherReactivity.thunderPulse),
            fogDensity: cloneWeatherBinding(base.weatherReactivity.fogDensity),
        };
    }
    return cloned;
}

function ensureBiomeBinding(overrides: MapMusicOverrides, biome: string): MapMusicChannelBinding {
    if (!overrides.biomes) overrides.biomes = {};
    const existing = overrides.biomes[biome];
    if (existing) return existing;
    const created: MapMusicChannelBinding = {};
    overrides.biomes[biome] = created;
    return created;
}

function inferRegionForPosition(regions: MapRegion[] | undefined, x: number, z: number): MapRegion | undefined {
    if (!regions || regions.length === 0) return undefined;
    for (let i = 0; i < regions.length; i++) {
        const region = regions[i];
        const minX = region.bounds.min[0];
        const minZ = region.bounds.min[1];
        const maxX = region.bounds.max[0];
        const maxZ = region.bounds.max[1];
        if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return region;
    }
    return undefined;
}

function resolveMusicHintBiome(entityBiome: string | undefined, regionBiome: string | undefined, music: MapMusicHints | undefined): string | undefined {
    return music?.biomeOverride ?? music?.biome ?? music?.biomeTag ?? entityBiome ?? regionBiome;
}

function mergeMusicHintsIntoOverrides(
    overrides: MapMusicOverrides,
    hints: MapMusicHints | undefined,
    fallbackBiome: string | undefined
): void {
    if (!hints) return;
    const biome = hints.biomeOverride ?? hints.biome ?? hints.biomeTag ?? fallbackBiome;
    if (!biome) return;

    const binding = ensureBiomeBinding(overrides, biome);
    if (hints.channels && hints.channels.length > 0) {
        if (!binding.noteColor || binding.noteColor.length === 0) {
            binding.noteColor = cloneChannelList(hints.channels);
        }
    }
    if (typeof hints.intensityScale === 'number' && Number.isFinite(hints.intensityScale)) {
        const slot = _biomeIntensityAccum.get(biome) ?? { sum: 0, count: 0 };
        slot.sum += hints.intensityScale;
        slot.count++;
        _biomeIntensityAccum.set(biome, slot);
    }
}

export function deriveMapMusicContext(data: CandyMapData): MapMusicOverrides {
    const overrides = cloneOverrides(data.music);
    _biomeIntensityAccum.clear();

    for (let i = 0; i < data.entities.length; i++) {
        const entity = data.entities[i];
        const region = inferRegionForPosition(data.regions, entity.position[0], entity.position[2]);
        const regionHints = region?.music;
        const resolvedBiome = resolveMusicHintBiome(entity.biome, region?.biome, entity.music);
        mergeMusicHintsIntoOverrides(overrides, regionHints, region?.biome);
        mergeMusicHintsIntoOverrides(overrides, entity.music, resolvedBiome);

        const trackerChannel = entity.music?.trackerChannel ?? regionHints?.trackerChannel;
        if (typeof trackerChannel === 'number' && Number.isInteger(trackerChannel)) {
            if (!overrides.luminousPlants) overrides.luminousPlants = {};
            if (overrides.luminousPlants.trackerChannel === undefined) {
                overrides.luminousPlants.trackerChannel = trackerChannel;
            }
        }
    }

    if (overrides.biomes) {
        for (const [biome, binding] of Object.entries(overrides.biomes)) {
            const scaleAccum = _biomeIntensityAccum.get(biome);
            if (scaleAccum && scaleAccum.count > 0 && binding.intensityScale === undefined) {
                binding.intensityScale = scaleAccum.sum / scaleAccum.count;
            }
        }
    }

    return overrides;
}

export function setMapMusicContext(overrides: MapMusicOverrides): void {
    _state.overrides = cloneOverrides(overrides);
    _state.version++;
}

export function clearMapMusicContext(): void {
    _state.overrides = {};
    _state.version++;
}

export function getMapMusicContext(): Readonly<MusicContextState> {
    return _state;
}

