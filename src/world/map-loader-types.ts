export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface MapRotation {
    euler?: Vec3;
    quat?: Quat;
    order?: string;
}

export type MapScale = number | Vec3;

export interface MapMusicHints {
    biome?: string;
    biomeTag?: string;
    biomeOverride?: string;
    channels?: number[];
    intensityScale?: number;
    trackerChannel?: number;
    reactivityProfile?: string;
    noteColorOverride?: string;
}

export interface MapMusicChannelBinding {
    shimmer?: number[];
    hueShift?: number[];
    noteColor?: number[];
    amplitudeScale?: number[];
    intensity?: number[];
    intensityScale?: number;
}

export interface MapWeatherBinding {
    channel?: number;
    smoothing?: number;
    scale?: number;
}

export interface MapMusicOverrides {
    profile?: string;
    biomes?: Record<string, MapMusicChannelBinding>;
    skyMoon?: {
        melodyChannel?: number;
        baseMoonIntensity?: number;
    };
    luminousPlants?: {
        trackerChannel?: number;
        baseIntensity?: number;
    };
    skyWave?: {
        propagationMs?: number;
        decayMs?: number;
        targetBiomes?: string[];
    };
    weatherReactivity?: {
        rainIntensity?: MapWeatherBinding;
        thunderPulse?: MapWeatherBinding;
        fogDensity?: MapWeatherBinding;
    };
}

export interface MapRegion {
    id: string;
    name?: string;
    bounds: {
        min: [number, number];
        max: [number, number];
    };
    biome?: string;
    tags?: string[];
    music?: MapMusicHints;
}

export interface CandyMapEntity {
    id?: string;
    type: string;
    position: Vec3;
    /** Stable ID for awakened-persistence (overrides position-hash when set) */
    persistentId?: string;
    rotation?: number | Vec3 | Quat | MapRotation;
    scale?: MapScale;
    variant?: string;
    size?: number | string;
    note?: string;
    noteIndex?: number;
    hasFace?: boolean;
    category?: string;
    layer?: string;
    biome?: string;
    music?: MapMusicHints;
    params?: Record<string, unknown>;
    placement?: 'ground' | 'absolute' | 'offset';
    /** Optional Y offset from authoritative ground (overrides ENTITY_BASE_OFFSETS). */
    baseOffset?: number;
    critical?: boolean;
    isObstacle?: boolean;
}

export interface CandyMapData {
    metadata?: {
        seed?: number;
        version?: string;
        biomes?: string[];
        bounds?: {
            min: [number, number];
            max: [number, number];
        };
        entityCount?: number;
        pathCount?: number;
        poiCount?: number;
        generationTime?: number;
        expectedInstanceCounts?: Record<string, number>;
        [key: string]: unknown;
    };
    entities: CandyMapEntity[];
    paths?: unknown[];
    pois?: unknown[];
    regions?: MapRegion[];
    layers?: string[];
    music?: MapMusicOverrides;
}

export interface LoadedMapEntity extends CandyMapEntity {
    id: string;
    type: string;
    position: Vec3;
    rotation?: MapRotation;
}

export interface LoadedCandyMap {
    source: string;
    data: CandyMapData;
    entities: LoadedMapEntity[];
    getEntitiesByType(type: string): LoadedMapEntity[];
    getEntitiesByBiome(biome: string): LoadedMapEntity[];
    getEntityById(id: string): LoadedMapEntity | undefined;
    getEntitiesByIds(ids: readonly string[], out?: LoadedMapEntity[]): LoadedMapEntity[];
    getEntitiesInBounds(bounds: {
        minX: number;
        minY?: number;
        minZ: number;
        maxX: number;
        maxY?: number;
        maxZ: number;
    }): LoadedMapEntity[];
    getNearestEntities(query: {
        origin: Vec3 | { x: number; z: number };
        radius: number;
        limit?: number;
        priorityTypes?: readonly string[];
        excludeIds?: ReadonlySet<string>;
        out?: LoadedMapEntity[];
    }): LoadedMapEntity[];
    streamEntitiesNear(
        origin: Vec3 | { x: number; z: number },
        maxRadius: number,
        priorityTypes?: readonly string[],
        options?: {
            ringSize?: number;
            chunkSize?: number;
            excludeIds?: ReadonlySet<string>;
        }
    ): IterableIterator<LoadedMapEntity[]>;
    getExpectedInstanceCounts(): Readonly<Record<string, number>>;
}
