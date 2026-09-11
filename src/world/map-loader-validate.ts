import type {
    CandyMapData,
    CandyMapEntity,
    MapMusicHints,
    MapMusicOverrides,
    MapWeatherBinding,
    MapMusicChannelBinding,
} from './map-loader-types.ts';
import {
    asVec3,
    isFiniteNumber,
    normalizeRotation,
    normalizeScale,
} from './map-loader-normalize.ts';

const MAX_MAP_ENTITIES = 20000;

export function validateMapShape(raw: unknown, source: string): asserts raw is CandyMapData {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`[MapLoader] Invalid map from ${source}: expected JSON object.`);
    }
    const entities = (raw as CandyMapData).entities;
    if (!Array.isArray(entities)) {
        throw new Error(`[MapLoader] Invalid map from ${source}: "entities" must be an array.`);
    }
    const expectedCounts = (raw as CandyMapData).metadata?.expectedInstanceCounts;
    if (expectedCounts !== undefined) {
        if (
            !expectedCounts ||
            typeof expectedCounts !== 'object' ||
            Array.isArray(expectedCounts)
        ) {
            throw new Error(
                `[MapLoader] Invalid map from ${source}: metadata.expectedInstanceCounts must be an object.`
            );
        }
        for (const [type, count] of Object.entries(expectedCounts)) {
            if (typeof type !== 'string' || type.trim().length === 0) {
                throw new Error(
                    `[MapLoader] Invalid expected instance count key "${type}" from ${source}.`
                );
            }
            if (!Number.isInteger(count) || count < 0 || count > 50000) {
                throw new Error(
                    `[MapLoader] Invalid expected instance count for "${type}" from ${source}: must be integer in [0, 50000].`
                );
            }
        }
    }
    if (entities.length > MAX_MAP_ENTITIES) {
        throw new Error(
            `[MapLoader] Invalid map from ${source}: entity cap exceeded (${entities.length}/${MAX_MAP_ENTITIES}).`
        );
    }
    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i] as CandyMapEntity;
        if (!entity || typeof entity !== 'object') {
            throw new Error(`[MapLoader] Invalid entity at index ${i}: expected object.`);
        }
        if (typeof entity.type !== 'string' || entity.type.trim().length === 0) {
            throw new Error(
                `[MapLoader] Invalid entity at index ${i}: "type" must be a non-empty string.`
            );
        }
        const position = asVec3(entity.position);
        if (!position) {
            throw new Error(
                `[MapLoader] Invalid entity "${entity.type}" at index ${i}: "position" must be [x,y,z].`
            );
        }
        if (entity.scale !== undefined && normalizeScale(entity.scale) === undefined) {
            throw new Error(
                `[MapLoader] Invalid entity "${entity.type}" at index ${i}: "scale" must be number or [x,y,z].`
            );
        }
        if (entity.rotation !== undefined && normalizeRotation(entity.rotation) === undefined) {
            throw new Error(
                `[MapLoader] Invalid entity "${entity.type}" at index ${i}: unsupported rotation shape.`
            );
        }
        if (entity.music !== undefined) {
            validateMusicHints(
                entity.music,
                `[MapLoader] Invalid music hints for entity "${entity.type}" at index ${i}`
            );
        }
    }

    const regions = (raw as CandyMapData).regions;
    if (regions !== undefined) {
        if (!Array.isArray(regions)) {
            throw new Error(
                `[MapLoader] Invalid map from ${source}: "regions" must be an array when provided.`
            );
        }
        for (let i = 0; i < regions.length; i++) {
            const region = regions[i];
            if (!region || typeof region !== 'object') {
                throw new Error(`[MapLoader] Invalid region at index ${i}: expected object.`);
            }
            if (typeof region.id !== 'string' || region.id.trim().length === 0) {
                throw new Error(
                    `[MapLoader] Invalid region at index ${i}: "id" must be a non-empty string.`
                );
            }
            if (
                !region.bounds ||
                typeof region.bounds !== 'object' ||
                !Array.isArray(region.bounds.min) ||
                !Array.isArray(region.bounds.max) ||
                region.bounds.min.length !== 2 ||
                region.bounds.max.length !== 2 ||
                !isFiniteNumber(region.bounds.min[0]) ||
                !isFiniteNumber(region.bounds.min[1]) ||
                !isFiniteNumber(region.bounds.max[0]) ||
                !isFiniteNumber(region.bounds.max[1])
            ) {
                throw new Error(
                    `[MapLoader] Invalid region "${region.id}": bounds must be { min:[x,z], max:[x,z] }.`
                );
            }
            if (region.music !== undefined) {
                validateMusicHints(
                    region.music,
                    `[MapLoader] Invalid music hints for region "${region.id}"`
                );
            }
        }
    }

    const mapMusic = (raw as CandyMapData).music;
    if (mapMusic !== undefined) {
        validateMapMusicOverrides(mapMusic, '[MapLoader] Invalid map-level music overrides');
    }
}

function validateChannelList(value: unknown, context: string): void {
    if (!Array.isArray(value)) throw new Error(`${context}: expected integer array.`);
    for (let i = 0; i < value.length; i++) {
        const channel = value[i];
        if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
            throw new Error(
                `${context}: channel "${channel}" at index ${i} is out of range (0-255 integer).`
            );
        }
    }
}

function validateMusicHints(raw: unknown, context: string): asserts raw is MapMusicHints {
    if (!raw || typeof raw !== 'object') throw new Error(`${context}: expected object.`);
    const hints = raw as MapMusicHints;
    if (hints.channels !== undefined) validateChannelList(hints.channels, `${context}.channels`);
    if (
        hints.intensityScale !== undefined &&
        (!isFiniteNumber(hints.intensityScale) ||
            hints.intensityScale < 0 ||
            hints.intensityScale > 10)
    ) {
        throw new Error(`${context}.intensityScale must be a finite number in [0, 10].`);
    }
    if (
        hints.trackerChannel !== undefined &&
        (!Number.isInteger(hints.trackerChannel) ||
            hints.trackerChannel < 0 ||
            hints.trackerChannel > 255)
    ) {
        throw new Error(`${context}.trackerChannel must be an integer in [0, 255].`);
    }
}

function validateMapMusicOverrides(
    raw: unknown,
    context: string
): asserts raw is MapMusicOverrides {
    if (!raw || typeof raw !== 'object') throw new Error(`${context}: expected object.`);
    const overrides = raw as MapMusicOverrides;

    if (overrides.biomes !== undefined) {
        if (typeof overrides.biomes !== 'object' || Array.isArray(overrides.biomes)) {
            throw new Error(`${context}.biomes must be an object.`);
        }
        for (const [biome, binding] of Object.entries(overrides.biomes)) {
            if (!binding || typeof binding !== 'object') {
                throw new Error(`${context}.biomes.${biome} must be an object.`);
            }
            const candidate = binding as MapMusicChannelBinding;
            if (candidate.shimmer !== undefined)
                validateChannelList(candidate.shimmer, `${context}.biomes.${biome}.shimmer`);
            if (candidate.hueShift !== undefined)
                validateChannelList(candidate.hueShift, `${context}.biomes.${biome}.hueShift`);
            if (candidate.noteColor !== undefined)
                validateChannelList(candidate.noteColor, `${context}.biomes.${biome}.noteColor`);
            if (candidate.amplitudeScale !== undefined)
                validateChannelList(
                    candidate.amplitudeScale,
                    `${context}.biomes.${biome}.amplitudeScale`
                );
            if (candidate.intensity !== undefined)
                validateChannelList(candidate.intensity, `${context}.biomes.${biome}.intensity`);
            if (
                candidate.intensityScale !== undefined &&
                (!isFiniteNumber(candidate.intensityScale) ||
                    candidate.intensityScale < 0 ||
                    candidate.intensityScale > 10)
            ) {
                throw new Error(
                    `${context}.biomes.${biome}.intensityScale must be a finite number in [0, 10].`
                );
            }
        }
    }

    if (overrides.skyMoon?.melodyChannel !== undefined) {
        const channel = overrides.skyMoon.melodyChannel;
        if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
            throw new Error(`${context}.skyMoon.melodyChannel must be an integer in [0, 255].`);
        }
    }
    if (overrides.luminousPlants?.trackerChannel !== undefined) {
        const channel = overrides.luminousPlants.trackerChannel;
        if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
            throw new Error(
                `${context}.luminousPlants.trackerChannel must be an integer in [0, 255].`
            );
        }
    }
    if (
        overrides.skyWave?.targetBiomes !== undefined &&
        !Array.isArray(overrides.skyWave.targetBiomes)
    ) {
        throw new Error(`${context}.skyWave.targetBiomes must be an array of strings.`);
    }

    const weather = overrides.weatherReactivity;
    if (weather && typeof weather === 'object') {
        for (const [name, binding] of Object.entries(weather)) {
            if (!binding || typeof binding !== 'object') continue;
            const typed = binding as MapWeatherBinding;
            if (
                typed.channel !== undefined &&
                (!Number.isInteger(typed.channel) || typed.channel < 0 || typed.channel > 255)
            ) {
                throw new Error(
                    `${context}.weatherReactivity.${name}.channel must be an integer in [0, 255].`
                );
            }
            if (
                typed.smoothing !== undefined &&
                (!isFiniteNumber(typed.smoothing) || typed.smoothing <= 0 || typed.smoothing > 10)
            ) {
                throw new Error(
                    `${context}.weatherReactivity.${name}.smoothing must be in (0, 10].`
                );
            }
            if (
                typed.scale !== undefined &&
                (!isFiniteNumber(typed.scale) || typed.scale < 0 || typed.scale > 10)
            ) {
                throw new Error(`${context}.weatherReactivity.${name}.scale must be in [0, 10].`);
            }
        }
    }
}
