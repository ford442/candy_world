export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

const ARPEGGIO_GROVE_SETPIECE = {
    centerX: -60,
    centerZ: 60,
    radius: 15
};

const LAKE_ISLAND_SETPIECE = {
    centerX: 20,
    centerZ: 20,
    radius: 12
};

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
    getEntitiesInBounds(
        bounds: { minX: number; minY?: number; minZ: number; maxX: number; maxY?: number; maxZ: number }
    ): LoadedMapEntity[];
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

const MAX_MAP_ENTITIES = 20000;
const DEFAULT_SPATIAL_CELL_SIZE = 40;

interface NearestScratch {
    entity: LoadedMapEntity;
    priorityRank: number;
    distSq: number;
}

const TYPE_ALIASES: Record<string, string> = {
    panningPad: 'panning_pad',
    panningpad: 'panning_pad',
    instrumentShrine: 'instrument_shrine',
    instrumentshrine: 'instrument_shrine',
    kickDrumGeyser: 'kick_drum_geyser',
    snareTrap: 'snare_trap',
    subwooferLotus: 'subwoofer_lotus',
    prismRoseBush: 'prism_rose_bush',
    fiberOpticWillow: 'fiber_optic_willow',
    bubbleWillow: 'bubble_willow',
    gemCanopyTree: 'gem_canopy_tree',
    portamentoPine: 'portamento_pine',
    arpeggioFern: 'arpeggio_fern',
    cymbalDandelion: 'cymbal_dandelion',
    retriggerMushroom: 'retrigger_mushroom',
    vibratoViolet: 'vibrato_violet',
    tremoloTulip: 'tremolo_tulip',
    floatingOrb: 'floating_orb',
    swingableVine: 'swingable_vine',
    vineLadder: 'vine_ladder',
    wisteriaCluster: 'wisteria_cluster',
    silenceSpirit: 'silence_spirit',
    melodyMirror: 'melody_mirror'
};

function normalizeType(type: string): string {
    const trimmed = type.trim();
    return TYPE_ALIASES[trimmed] ?? trimmed;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function asVec3(value: unknown): Vec3 | null {
    if (!Array.isArray(value) || value.length !== 3) return null;
    if (!isFiniteNumber(value[0]) || !isFiniteNumber(value[1]) || !isFiniteNumber(value[2])) return null;
    return [value[0], value[1], value[2]];
}

function asQuat(value: unknown): Quat | null {
    if (!Array.isArray(value) || value.length !== 4) return null;
    if (!isFiniteNumber(value[0]) || !isFiniteNumber(value[1]) || !isFiniteNumber(value[2]) || !isFiniteNumber(value[3])) return null;
    return [value[0], value[1], value[2], value[3]];
}

function normalizeRotation(rotation: CandyMapEntity['rotation']): MapRotation | undefined {
    if (rotation === undefined || rotation === null) return undefined;
    if (isFiniteNumber(rotation)) {
        return { euler: [0, rotation, 0], order: 'YXZ' };
    }
    const euler = asVec3(rotation);
    if (euler) {
        return { euler, order: 'YXZ' };
    }
    const quat = asQuat(rotation);
    if (quat) {
        return { quat };
    }
    if (typeof rotation === 'object') {
        const eulerFromObj = asVec3((rotation as MapRotation).euler);
        const quatFromObj = asQuat((rotation as MapRotation).quat);
        if (!eulerFromObj && !quatFromObj) return undefined;
        return {
            euler: eulerFromObj ?? undefined,
            quat: quatFromObj ?? undefined,
            order: typeof (rotation as MapRotation).order === 'string' ? (rotation as MapRotation).order : 'YXZ'
        };
    }
    return undefined;
}

function normalizeScale(scale: unknown): MapScale | undefined {
    if (scale === undefined || scale === null) return undefined;
    if (isFiniteNumber(scale)) return scale;
    const vec3 = asVec3(scale);
    if (vec3) return vec3;
    return undefined;
}

function validateMapShape(raw: unknown, source: string): asserts raw is CandyMapData {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`[MapLoader] Invalid map from ${source}: expected JSON object.`);
    }
    const entities = (raw as CandyMapData).entities;
    if (!Array.isArray(entities)) {
        throw new Error(`[MapLoader] Invalid map from ${source}: "entities" must be an array.`);
    }
    const expectedCounts = (raw as CandyMapData).metadata?.expectedInstanceCounts;
    if (expectedCounts !== undefined) {
        if (!expectedCounts || typeof expectedCounts !== 'object' || Array.isArray(expectedCounts)) {
            throw new Error(`[MapLoader] Invalid map from ${source}: metadata.expectedInstanceCounts must be an object.`);
        }
        for (const [type, count] of Object.entries(expectedCounts)) {
            if (typeof type !== 'string' || type.trim().length === 0) {
                throw new Error(`[MapLoader] Invalid expected instance count key "${type}" from ${source}.`);
            }
            if (!Number.isInteger(count) || count < 0 || count > 50000) {
                throw new Error(`[MapLoader] Invalid expected instance count for "${type}" from ${source}: must be integer in [0, 50000].`);
            }
        }
    }
    if (entities.length > MAX_MAP_ENTITIES) {
        throw new Error(`[MapLoader] Invalid map from ${source}: entity cap exceeded (${entities.length}/${MAX_MAP_ENTITIES}).`);
    }
    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i] as CandyMapEntity;
        if (!entity || typeof entity !== 'object') {
            throw new Error(`[MapLoader] Invalid entity at index ${i}: expected object.`);
        }
        if (typeof entity.type !== 'string' || entity.type.trim().length === 0) {
            throw new Error(`[MapLoader] Invalid entity at index ${i}: "type" must be a non-empty string.`);
        }
        const position = asVec3(entity.position);
        if (!position) {
            throw new Error(`[MapLoader] Invalid entity "${entity.type}" at index ${i}: "position" must be [x,y,z].`);
        }
        if (entity.scale !== undefined && normalizeScale(entity.scale) === undefined) {
            throw new Error(`[MapLoader] Invalid entity "${entity.type}" at index ${i}: "scale" must be number or [x,y,z].`);
        }
        if (entity.rotation !== undefined && normalizeRotation(entity.rotation) === undefined) {
            throw new Error(`[MapLoader] Invalid entity "${entity.type}" at index ${i}: unsupported rotation shape.`);
        }
        if (entity.music !== undefined) {
            validateMusicHints(entity.music, `[MapLoader] Invalid music hints for entity "${entity.type}" at index ${i}`);
        }
    }

    const regions = (raw as CandyMapData).regions;
    if (regions !== undefined) {
        if (!Array.isArray(regions)) {
            throw new Error(`[MapLoader] Invalid map from ${source}: "regions" must be an array when provided.`);
        }
        for (let i = 0; i < regions.length; i++) {
            const region = regions[i];
            if (!region || typeof region !== 'object') {
                throw new Error(`[MapLoader] Invalid region at index ${i}: expected object.`);
            }
            if (typeof region.id !== 'string' || region.id.trim().length === 0) {
                throw new Error(`[MapLoader] Invalid region at index ${i}: "id" must be a non-empty string.`);
            }
            if (!region.bounds || typeof region.bounds !== 'object' || !Array.isArray(region.bounds.min) || !Array.isArray(region.bounds.max) ||
                region.bounds.min.length !== 2 || region.bounds.max.length !== 2 ||
                !isFiniteNumber(region.bounds.min[0]) || !isFiniteNumber(region.bounds.min[1]) ||
                !isFiniteNumber(region.bounds.max[0]) || !isFiniteNumber(region.bounds.max[1])) {
                throw new Error(`[MapLoader] Invalid region "${region.id}": bounds must be { min:[x,z], max:[x,z] }.`);
            }
            if (region.music !== undefined) {
                validateMusicHints(region.music, `[MapLoader] Invalid music hints for region "${region.id}"`);
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
            throw new Error(`${context}: channel "${channel}" at index ${i} is out of range (0-255 integer).`);
        }
    }
}

function validateMusicHints(raw: unknown, context: string): asserts raw is MapMusicHints {
    if (!raw || typeof raw !== 'object') throw new Error(`${context}: expected object.`);
    const hints = raw as MapMusicHints;
    if (hints.channels !== undefined) validateChannelList(hints.channels, `${context}.channels`);
    if (hints.intensityScale !== undefined && (!isFiniteNumber(hints.intensityScale) || hints.intensityScale < 0 || hints.intensityScale > 10)) {
        throw new Error(`${context}.intensityScale must be a finite number in [0, 10].`);
    }
    if (hints.trackerChannel !== undefined && (!Number.isInteger(hints.trackerChannel) || hints.trackerChannel < 0 || hints.trackerChannel > 255)) {
        throw new Error(`${context}.trackerChannel must be an integer in [0, 255].`);
    }
}

function validateMapMusicOverrides(raw: unknown, context: string): asserts raw is MapMusicOverrides {
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
            if (candidate.shimmer !== undefined) validateChannelList(candidate.shimmer, `${context}.biomes.${biome}.shimmer`);
            if (candidate.hueShift !== undefined) validateChannelList(candidate.hueShift, `${context}.biomes.${biome}.hueShift`);
            if (candidate.noteColor !== undefined) validateChannelList(candidate.noteColor, `${context}.biomes.${biome}.noteColor`);
            if (candidate.amplitudeScale !== undefined) validateChannelList(candidate.amplitudeScale, `${context}.biomes.${biome}.amplitudeScale`);
            if (candidate.intensity !== undefined) validateChannelList(candidate.intensity, `${context}.biomes.${biome}.intensity`);
            if (candidate.intensityScale !== undefined && (!isFiniteNumber(candidate.intensityScale) || candidate.intensityScale < 0 || candidate.intensityScale > 10)) {
                throw new Error(`${context}.biomes.${biome}.intensityScale must be a finite number in [0, 10].`);
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
            throw new Error(`${context}.luminousPlants.trackerChannel must be an integer in [0, 255].`);
        }
    }
    if (overrides.skyWave?.targetBiomes !== undefined && !Array.isArray(overrides.skyWave.targetBiomes)) {
        throw new Error(`${context}.skyWave.targetBiomes must be an array of strings.`);
    }

    const weather = overrides.weatherReactivity;
    if (weather && typeof weather === 'object') {
        for (const [name, binding] of Object.entries(weather)) {
            if (!binding || typeof binding !== 'object') continue;
            const typed = binding as MapWeatherBinding;
            if (typed.channel !== undefined && (!Number.isInteger(typed.channel) || typed.channel < 0 || typed.channel > 255)) {
                throw new Error(`${context}.weatherReactivity.${name}.channel must be an integer in [0, 255].`);
            }
            if (typed.smoothing !== undefined && (!isFiniteNumber(typed.smoothing) || typed.smoothing <= 0 || typed.smoothing > 10)) {
                throw new Error(`${context}.weatherReactivity.${name}.smoothing must be in (0, 10].`);
            }
            if (typed.scale !== undefined && (!isFiniteNumber(typed.scale) || typed.scale < 0 || typed.scale > 10)) {
                throw new Error(`${context}.weatherReactivity.${name}.scale must be in [0, 10].`);
            }
        }
    }
}

function isV1Map(data: CandyMapData): boolean {
    const version = data.metadata?.version;
    if (version === undefined || version === null || version === '') return true;
    if (typeof version === 'number') return Math.floor(version) === 1;
    const trimmed = String(version).trim();
    if (trimmed === '1') return true;
    const numericPrefix = Number(trimmed.split('.')[0]);
    if (Number.isFinite(numericPrefix)) return numericPrefix === 1;
    return trimmed.startsWith('1.');
}

function hasSetpieceLayer(data: CandyMapData, layer: string): boolean {
    return data.entities.some(entity => entity.layer === layer || entity.id?.startsWith(`setpiece:${layer}:`));
}

function getEntityPosition(entity: CandyMapEntity): Vec3 | null {
    return asVec3(entity.position);
}

function hasEntityNear(
    entities: CandyMapEntity[],
    type: string,
    centerX: number,
    centerZ: number,
    radius: number
): boolean {
    const radiusSq = radius * radius;
    return entities.some(entity => {
        if (normalizeType(entity.type) !== type) return false;
        const position = getEntityPosition(entity);
        if (!position) return false;
        const dx = position[0] - centerX;
        const dz = position[2] - centerZ;
        return (dx * dx + dz * dz) <= radiusSq;
    });
}

function addLegacySetpieces(base: CandyMapData): CandyMapData {
    if (!isV1Map(base)) return base;

    const entities = [...base.entities];
    const groveLayer = 'setpiece-arpeggio-grove';
    const lakeLayer = 'setpiece-lake-island';
    const caveLayer = 'setpiece-cave';

    if (!entities.some(entity => normalizeType(entity.type) === 'cave') && !hasSetpieceLayer(base, caveLayer)) {
        entities.push({
            id: 'setpiece:cave:entrance',
            type: 'cave',
            category: 'setpiece',
            layer: caveLayer,
            biome: 'lake',
            position: [25, 0, 25],
            params: { lookAtOrigin: true, scale: 2.0 },
            critical: true
        });
    }

    const hasArpeggioSignature =
        hasEntityNear(entities, 'subwoofer_lotus', ARPEGGIO_GROVE_SETPIECE.centerX, ARPEGGIO_GROVE_SETPIECE.centerZ, ARPEGGIO_GROVE_SETPIECE.radius * 0.9) ||
        hasEntityNear(entities, 'arpeggio_fern', ARPEGGIO_GROVE_SETPIECE.centerX, ARPEGGIO_GROVE_SETPIECE.centerZ, ARPEGGIO_GROVE_SETPIECE.radius);

    if (!hasSetpieceLayer(base, groveLayer) && !hasArpeggioSignature) {
        const { centerX, centerZ, radius } = ARPEGGIO_GROVE_SETPIECE;
        entities.push({
            id: 'setpiece:arpeggio:lotus',
            type: 'subwoofer_lotus',
            category: 'setpiece',
            layer: groveLayer,
            biome: 'arpeggio_grove',
            position: [centerX, 0, centerZ],
            scale: 1.5,
            music: { biomeTag: 'arpeggio_grove' },
            critical: true
        });
        const fernCount = 7;
        const fernRadius = radius * 0.4;
        for (let i = 0; i < fernCount; i++) {
            const angle = (i / fernCount) * Math.PI * 2;
            entities.push({
                id: `setpiece:arpeggio:fern:${i}`,
                type: 'arpeggio_fern',
                category: 'setpiece',
                layer: groveLayer,
                biome: 'arpeggio_grove',
                position: [centerX + Math.cos(angle) * fernRadius, 0, centerZ + Math.sin(angle) * fernRadius],
                scale: 1.1,
                rotation: { euler: [0, angle + Math.PI, 0], order: 'YXZ' },
                music: { biomeTag: 'arpeggio_grove' },
                critical: true
            });
        }
        const outerCount = 4;
        const outerRadius = radius * 0.8;
        for (let i = 0; i < outerCount; i++) {
            const angle = (i / outerCount) * Math.PI * 2 + 0.2;
            const common = {
                category: 'setpiece',
                layer: groveLayer,
                biome: 'arpeggio_grove',
                position: [centerX + Math.cos(angle) * outerRadius, 0, centerZ + Math.sin(angle) * outerRadius] as Vec3,
                music: { biomeTag: 'arpeggio_grove' },
                critical: true
            };
            if (i % 2 === 0) {
                entities.push({
                    id: `setpiece:arpeggio:geyser:${i}`,
                    type: 'kick_drum_geyser',
                    ...common
                });
            } else {
                entities.push({
                    id: `setpiece:arpeggio:violet:${i}`,
                    type: 'vibrato_violet',
                    ...common
                });
            }
        }
    }

    const hasLakeSignature =
        hasEntityNear(entities, 'retrigger_mushroom', LAKE_ISLAND_SETPIECE.centerX, LAKE_ISLAND_SETPIECE.centerZ, LAKE_ISLAND_SETPIECE.radius * 0.9) ||
        hasEntityNear(entities, 'kick_drum_geyser', LAKE_ISLAND_SETPIECE.centerX, LAKE_ISLAND_SETPIECE.centerZ, LAKE_ISLAND_SETPIECE.radius);

    if (!hasSetpieceLayer(base, lakeLayer) && !hasLakeSignature) {
        const { centerX, centerZ, radius } = LAKE_ISLAND_SETPIECE;
        entities.push({
            id: 'setpiece:lake:core',
            type: 'retrigger_mushroom',
            category: 'setpiece',
            layer: lakeLayer,
            biome: 'lake',
            position: [centerX, 0, centerZ],
            scale: 1.5,
            params: { retriggerSpeed: 4, color: 0x00FFFF },
            critical: true
        });
        const geyserCount = 6;
        for (let i = 0; i < geyserCount; i++) {
            const angle = (i / geyserCount) * Math.PI * 2;
            entities.push({
                id: `setpiece:lake:geyser:${i}`,
                type: 'kick_drum_geyser',
                category: 'setpiece',
                layer: lakeLayer,
                biome: 'lake',
                position: [centerX + Math.cos(angle) * radius * 0.7, 0, centerZ + Math.sin(angle) * radius * 0.7],
                rotation: { euler: [0, angle + Math.PI, 0], order: 'YXZ' }
            });
        }
    }

    return {
        ...base,
        entities
    };
}

function normalizeEntity(entity: CandyMapEntity, index: number): LoadedMapEntity {
    const type = normalizeType(entity.type);
    const placement = entity.placement ?? (type === 'cloud' ? 'absolute' : 'ground');
    const biome = entity.biome ?? entity.music?.biomeTag;
    const params = entity.params && typeof entity.params === 'object' ? entity.params : undefined;
    return {
        ...entity,
        id: entity.id ?? `${type}_${index}`,
        type,
        position: asVec3(entity.position)!,
        rotation: normalizeRotation(entity.rotation),
        scale: normalizeScale(entity.scale),
        placement,
        biome,
        music: normalizeMusicHints(entity.music),
        params
    };
}

function normalizeMusicHints(raw: CandyMapEntity['music']): CandyMapEntity['music'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const biome = raw.biomeOverride ?? raw.biome ?? raw.biomeTag;
    return {
        ...raw,
        biome: biome ?? raw.biome,
        biomeTag: biome ?? raw.biomeTag,
    };
}

function getOriginXZ(origin: Vec3 | { x: number; z: number }): { x: number; z: number } {
    if (Array.isArray(origin)) {
        return { x: origin[0], z: origin[2] };
    }
    return { x: origin.x, z: origin.z };
}

function cellKey(cellX: number, cellZ: number): string {
    return `${cellX},${cellZ}`;
}

function toCellCoord(value: number, cellSize: number): number {
    return Math.floor(value / cellSize);
}

class LoadedCandyMapImpl implements LoadedCandyMap {
    source: string;
    data: CandyMapData;
    entities: LoadedMapEntity[];
    private cellSize: number;
    private cellIndex: Map<string, LoadedMapEntity[]> = new Map();
    private byType: Map<string, LoadedMapEntity[]> = new Map();
    private byBiome: Map<string, LoadedMapEntity[]> = new Map();
    private nearestScratch: NearestScratch[] = [];
    private nearestScratchCount: number = 0;
    private streamScratch: LoadedMapEntity[] = [];
    private streamChunkScratch: LoadedMapEntity[] = [];
    private expectedInstanceCounts: Readonly<Record<string, number>>;

    constructor(source: string, data: CandyMapData, entities: LoadedMapEntity[]) {
        this.source = source;
        this.data = data;
        this.entities = entities;
        this.cellSize = DEFAULT_SPATIAL_CELL_SIZE;
        this.buildIndexes();
        this.expectedInstanceCounts = this.buildExpectedInstanceCounts();
    }

    private buildExpectedInstanceCounts(): Readonly<Record<string, number>> {
        const explicit = this.data.metadata?.expectedInstanceCounts;
        if (explicit && typeof explicit === 'object') {
            const normalized: Record<string, number> = {};
            for (const [rawType, value] of Object.entries(explicit)) {
                if (!Number.isInteger(value) || value < 0) continue;
                normalized[normalizeType(rawType)] = value;
            }
            return normalized;
        }
        const derived: Record<string, number> = {};
        for (const entity of this.entities) {
            derived[entity.type] = (derived[entity.type] ?? 0) + 1;
        }
        return derived;
    }

    private buildIndexes(): void {
        for (const entity of this.entities) {
            const typeList = this.byType.get(entity.type);
            if (typeList) typeList.push(entity);
            else this.byType.set(entity.type, [entity]);

            const biomeTag = entity.biome ?? entity.music?.biomeTag;
            if (biomeTag) {
                const biomeList = this.byBiome.get(biomeTag);
                if (biomeList) biomeList.push(entity);
                else this.byBiome.set(biomeTag, [entity]);
            }

            const [x, , z] = entity.position;
            const cx = toCellCoord(x, this.cellSize);
            const cz = toCellCoord(z, this.cellSize);
            const key = cellKey(cx, cz);
            const cellEntities = this.cellIndex.get(key);
            if (cellEntities) {
                cellEntities.push(entity);
            } else {
                this.cellIndex.set(key, [entity]);
            }
        }
    }

    getEntitiesByType(type: string): LoadedMapEntity[] {
        const normalized = normalizeType(type);
        return this.byType.get(normalized) ?? [];
    }

    getEntitiesByBiome(biome: string): LoadedMapEntity[] {
        return this.byBiome.get(biome) ?? [];
    }

    getEntitiesInBounds(
        bounds: { minX: number; minY?: number; minZ: number; maxX: number; maxY?: number; maxZ: number }
    ): LoadedMapEntity[] {
        const minY = bounds.minY ?? Number.NEGATIVE_INFINITY;
        const maxY = bounds.maxY ?? Number.POSITIVE_INFINITY;
        return this.getNearestEntities({
            origin: { x: (bounds.minX + bounds.maxX) * 0.5, z: (bounds.minZ + bounds.maxZ) * 0.5 },
            radius: Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ),
            out: []
        }).filter(entity => {
            const [x, y, z] = entity.position;
            return x >= bounds.minX && x <= bounds.maxX && y >= minY && y <= maxY && z >= bounds.minZ && z <= bounds.maxZ;
        });
    }

    getNearestEntities(query: {
        origin: Vec3 | { x: number; z: number };
        radius: number;
        limit?: number;
        priorityTypes?: readonly string[];
        excludeIds?: ReadonlySet<string>;
        out?: LoadedMapEntity[];
    }): LoadedMapEntity[] {
        const { x: originX, z: originZ } = getOriginXZ(query.origin);
        const radius = Math.max(0, query.radius);
        const radiusSq = radius * radius;
        const maxCount = query.limit ?? Number.POSITIVE_INFINITY;
        const out = query.out ?? [];
        out.length = 0;

        const priorityMap = new Map<string, number>();
        if (query.priorityTypes) {
            for (let i = 0; i < query.priorityTypes.length; i++) {
                priorityMap.set(normalizeType(query.priorityTypes[i]), i);
            }
        }
        const defaultRank = priorityMap.size + 1;

        let minCellX = Number.NEGATIVE_INFINITY;
        let maxCellX = Number.POSITIVE_INFINITY;
        let minCellZ = Number.NEGATIVE_INFINITY;
        let maxCellZ = Number.POSITIVE_INFINITY;
        if (Number.isFinite(radius)) {
            minCellX = toCellCoord(originX - radius, this.cellSize);
            maxCellX = toCellCoord(originX + radius, this.cellSize);
            minCellZ = toCellCoord(originZ - radius, this.cellSize);
            maxCellZ = toCellCoord(originZ + radius, this.cellSize);
        }

        this.nearestScratchCount = 0;
        if (Number.isFinite(radius)) {
            for (let cz = minCellZ; cz <= maxCellZ; cz++) {
                for (let cx = minCellX; cx <= maxCellX; cx++) {
                    const cellEntities = this.cellIndex.get(cellKey(cx, cz));
                    if (!cellEntities) continue;
                    for (const entity of cellEntities) {
                        if (query.excludeIds?.has(entity.id)) continue;
                        const dx = entity.position[0] - originX;
                        const dz = entity.position[2] - originZ;
                        const distSq = dx * dx + dz * dz;
                        if (distSq > radiusSq) continue;
                        const rank = priorityMap.get(entity.type) ?? defaultRank;
                        const slot = this.nearestScratch[this.nearestScratchCount] ?? { entity, priorityRank: rank, distSq };
                        slot.entity = entity;
                        slot.priorityRank = rank;
                        slot.distSq = distSq;
                        this.nearestScratch[this.nearestScratchCount] = slot;
                        this.nearestScratchCount++;
                    }
                }
            }
        } else {
            for (const entity of this.entities) {
                if (query.excludeIds?.has(entity.id)) continue;
                const dx = entity.position[0] - originX;
                const dz = entity.position[2] - originZ;
                const distSq = dx * dx + dz * dz;
                const rank = priorityMap.get(entity.type) ?? defaultRank;
                const slot = this.nearestScratch[this.nearestScratchCount] ?? { entity, priorityRank: rank, distSq };
                slot.entity = entity;
                slot.priorityRank = rank;
                slot.distSq = distSq;
                this.nearestScratch[this.nearestScratchCount] = slot;
                this.nearestScratchCount++;
            }
        }

        this.nearestScratch.length = this.nearestScratchCount;
        this.nearestScratch.sort((a, b) => {
            if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
            return a.distSq - b.distSq;
        });

        const count = Math.min(this.nearestScratchCount, maxCount);
        for (let i = 0; i < count; i++) {
            out.push(this.nearestScratch[i].entity);
        }
        return out;
    }

    *streamEntitiesNear(
        origin: Vec3 | { x: number; z: number },
        maxRadius: number,
        priorityTypes?: readonly string[],
        options?: {
            ringSize?: number;
            chunkSize?: number;
            excludeIds?: ReadonlySet<string>;
        }
    ): IterableIterator<LoadedMapEntity[]> {
        const ringSize = Math.max(8, options?.ringSize ?? 36);
        const chunkSize = Math.max(10, options?.chunkSize ?? 40);
        const { x: originX, z: originZ } = getOriginXZ(origin);
        const ordered = this.getNearestEntities({
            origin,
            radius: maxRadius,
            priorityTypes,
            excludeIds: options?.excludeIds,
            out: this.streamScratch
        });

        let currentRing = -1;
        let currentChunkSize = 0;
        this.streamChunkScratch.length = 0;
        for (const entity of ordered) {
            const dx = entity.position[0] - originX;
            const dz = entity.position[2] - originZ;
            const ring = Math.floor(Math.hypot(dx, dz) / ringSize);
            if ((currentRing !== -1 && ring !== currentRing) || currentChunkSize >= chunkSize) {
                yield [...this.streamChunkScratch];
                this.streamChunkScratch.length = 0;
                currentChunkSize = 0;
            }
            currentRing = ring;
            this.streamChunkScratch.push(entity);
            currentChunkSize++;
        }
        if (this.streamChunkScratch.length > 0) {
            yield [...this.streamChunkScratch];
            this.streamChunkScratch.length = 0;
        }
    }

    getExpectedInstanceCounts(): Readonly<Record<string, number>> {
        return this.expectedInstanceCounts;
    }
}

async function fetchMapJson(source: string): Promise<unknown> {
    if (typeof window === 'undefined') {
        throw new Error('[MapLoader] String map sources require a browser environment.');
    }
    const url = new URL(source, window.location.href);
    if (url.origin !== window.location.origin) {
        throw new Error(`[MapLoader] Refusing cross-origin map source: ${source}`);
    }
    const response = await fetch(url.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
        throw new Error(`[MapLoader] Failed to load map "${source}" (${response.status} ${response.statusText})`);
    }
    return response.json();
}

export function getMapSourceFromUrl(defaultSource: string = new URL('../../assets/map.json', import.meta.url).href): string {
    if (typeof window === 'undefined') return defaultSource;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('map');
    if (!fromQuery || fromQuery.trim().length === 0) return defaultSource;
    return fromQuery;
}

export async function loadMap(source: string | CandyMapData): Promise<LoadedCandyMap> {
    const sourceLabel = typeof source === 'string' ? source : '[inline-map]';
    const raw = typeof source === 'string' ? await fetchMapJson(source) : source;
    validateMapShape(raw, sourceLabel);
    const withSetpieces = addLegacySetpieces(raw);
    validateMapShape(withSetpieces, sourceLabel);

    const entities = withSetpieces.entities.map((entity, index) => normalizeEntity(entity, index));
    const data: CandyMapData = {
        ...withSetpieces,
        metadata: {
            ...withSetpieces.metadata,
            version: withSetpieces.metadata?.version ?? '1.0'
        },
        entities,
        music: withSetpieces.music
    };

    return new LoadedCandyMapImpl(sourceLabel, data, entities);
}

export function setupMapHotReload(source: string, onReload: () => void): void {
    const hot = (import.meta as any).hot;
    if (!hot || typeof source !== 'string') return;
    hot.on('vite:beforeUpdate', (payload: { updates?: Array<{ path?: string }> }) => {
        if (!payload?.updates) return;
        const normalizedSource = source.replace(/^\.\//, '').replace(/^\//, '');
        const shouldReload = payload.updates.some(update => {
            const path = update.path ?? '';
            return path.endsWith(normalizedSource) || path.endsWith(source);
        });
        if (shouldReload) onReload();
    });
}
