import * as THREE from 'three';
import { checkPositionValidity } from '../utils/wasm-loader.ts';
import {
    LAKE_BOUNDS,
    LAKE_BOTTOM,
    LAKE_ISLAND,
    getGroundHeight
} from '../systems/ground-system.ts';
import { CONFIG, getLoadMemoryScale, getLoadMemoryTier } from '../core/config.ts';

export const DEFAULT_MAP_CHUNK_SIZE = 100;
export const DEFAULT_PROCEDURAL_CHUNK_SIZE = 100;

/**
 * Effective Full-mode population scale.
 * Combines CONFIG.world.population.scale, Fast-Full override, and device RAM tier.
 * Evaluated at call time so Fast-Full / memory scaling actually apply (module-load
 * constants previously missed the runtime `__fastPopulationOverride` flag).
 */
export function getPopulationScale(): number {
    const pop = CONFIG.world?.population;
    let scale = pop?.scale ?? 1.0;

    // Runtime override for "Fast Full Mode" (chosen in the startup UI)
    if (typeof window !== 'undefined' && (window as any).__fastPopulationOverride) {
        scale *= 0.42;
    }

    // Device RAM awareness — shrink Full-mode population on low-memory machines
    scale *= getLoadMemoryScale();
    return scale;
}

/** Procedural extras count for Full mode (CONFIG + memory + fast-full). */
export function getProceduralEntityCount(): number {
    const base = CONFIG.world?.population?.proceduralExtras ?? 200;
    return Math.max(20, Math.floor(base * getPopulationScale()));
}

/** @deprecated Prefer getProceduralEntityCount() — kept for worker docs / legacy imports. */
export const PROCEDURAL_ENTITY_COUNT = 200;

/** Per-chunk time budget (ms); tighter on low-RAM devices to avoid long stalls. */
export function getEntityBudgetMs(): number {
    const tier = getLoadMemoryTier();
    if (tier === 'critical') return 6;
    if (tier === 'low') return 8;
    if (tier === 'medium') return 12;
    return 14;
}

/** @deprecated Prefer getEntityBudgetMs() */
export const ENTITY_BUDGET_MS = 14;
export const YIELD_ENTITY_BATCH_SIZE = 40;
export const YIELD_LOG_INTERVAL = YIELD_ENTITY_BATCH_SIZE * 5;

function scaledPopCount(configValue: number | undefined, fallback: number, min: number): number {
    const base = configValue ?? fallback;
    return Math.max(min, Math.floor(base * getPopulationScale()));
}

export function getArpeggioGroveFernCount(): number {
    return scaledPopCount(CONFIG.world?.population?.arpeggioGroveFerns, 7, 3);
}
export function getArpeggioGroveOuterCount(): number {
    return scaledPopCount(CONFIG.world?.population?.arpeggioGroveOuter, 4, 2);
}
export function getLakeArpeggioFernCount(): number {
    return scaledPopCount(CONFIG.world?.population?.lakeArpeggioFerns, 3, 1);
}
export function getLakeDandelionCount(): number {
    return scaledPopCount(CONFIG.world?.population?.lakeDandelions, 6, 2);
}

/** @deprecated Prefer getArpeggioGroveFernCount() */
export const ARPEGGIO_GROVE_FERN_COUNT = 7;
/** @deprecated Prefer getArpeggioGroveOuterCount() */
export const ARPEGGIO_GROVE_OUTER_COUNT = 4;
/** @deprecated Prefer getLakeArpeggioFernCount() */
export const LAKE_ARPEGGIO_FERN_COUNT = 3;
/** @deprecated Prefer getLakeDandelionCount() */
export const LAKE_DANDELION_COUNT = 6;

// Re-export lake constants from the single authoritative source.
export { LAKE_BOUNDS, LAKE_BOTTOM, LAKE_ISLAND };

export const ARPEGGIO_GROVE = {
    centerX: -60,
    centerZ: 60,
    radius: 15,
    enabled: true
};

export const GEM_CANOPY = {
    enabled: true,
    startX: 75,
    startZ: -115,
    endX: 125,
    endZ: -45,
    corridorWidth: 14,
    treeCount: 24,
};

// Luminous Mycelium Realm — glass-mushroom grove + ambient spore field, sited as a
// companion biome near Melody Lake (the lake island sits around -40, 40).
export const MYCELIUM_GROVE = {
    enabled: true,
    centerX: -78,
    centerZ: 78,
    radius: 16,
    mushroomCount: 28, // glass mushrooms scattered through the grove
    sporeCount: 260,   // ambient compute spores drifting in the misty air
};

export const CLOUD_ARCHIPELAGO = {
    enabled: true,
    startX: -100,
    startZ: 100,
    platforms: 8,
    stepY: 2.8,
    radius: 12,
    heightOffset: 8,
};

/**
 * Stacked sky islands (#1363) — NW of spawn, above cloud-archipelago approach stairs.
 * Explicit absolute Y tiers validated against unified ground / platform query.
 */
export const SKY_ISLANDS = {
    enabled: true,
    centerX: -110,
    centerZ: 118,
    // Lateral offsets keep walkable decks from overlapping in XZ so each tier
    // remains independently queryable via highest-maxY platform override.
    layers: [
        { id: 'low_mist', y: 18, radius: 9, height: 3.2, kind: 'mist' as const, offsetX: 0, offsetZ: 0 },
        { id: 'mid_canopy', y: 32, radius: 11, height: 3.6, kind: 'canopy' as const, offsetX: 26, offsetZ: -18 },
        { id: 'high_nebula', y: 48, radius: 8, height: 3.0, kind: 'nebula' as const, offsetX: -22, offsetZ: 24 },
    ],
    cloudRingCount: 4,
    panningPadCount: 3,
    vineLadders: true,
};

// Note: Actual fern/outer counts for the grove now come from
// CONFIG.world.population (see above) and are consumed in generation-decorators.ts.

export const obstaclesData: {x: number, y: number, z: number, radius: number}[] = [];

// Types
export interface MapEntity {
    id?: string;
    type: string;
    position: [number, number, number];
    /** Stable ID for awakened-persistence across reloads (hand-placed landmarks) */
    persistentId?: string;
    variant?: string;
    scale?: number | [number, number, number];
    rotation?: number | [number, number, number] | [number, number, number, number] | {
        euler?: [number, number, number];
        quat?: [number, number, number, number];
        order?: string;
    };
    size?: number | string;
    note?: string;
    noteIndex?: number;
    hasFace?: boolean;
    category?: string;
    layer?: string;
    biome?: string;
    placement?: 'ground' | 'absolute' | 'offset';
    /** Optional Y correction (world units) for hand-tuned landmark contact; see placement-utils ENTITY_BASE_OFFSETS */
    baseOffset?: number;
    music?: {
        biome?: string;
        biomeTag?: string;
        biomeOverride?: string;
        channels?: number[];
        intensityScale?: number;
        trackerChannel?: number;
        reactivityProfile?: string;
        noteColorOverride?: string;
    };
    params?: Record<string, unknown>;
    critical?: boolean;
    isObstacle?: boolean;
}

export interface ObstacleData {
    position: THREE.Vector3;
    radius: number;
}

export interface WorldObjects {
    sky: THREE.Object3D;
    moon: THREE.Object3D;
    ground: THREE.Mesh;
}

export interface WeatherSystem {
    registerTree(obj: THREE.Object3D): void;
    registerShrub(obj: THREE.Object3D): void;
    registerMushroom(obj: THREE.Object3D): void;
    registerCave(obj: THREE.Object3D): void;
}

export type WorldProgressCallback = (
    current: number,
    total: number,
    label?: string,
    entityType?: string
) => void;

export type WorldMode = 'CORE' | 'FULL';

export interface FoliageGrowthOptions {
    maxOffspring: number;
    spawnChanceBase: number;
    spawnRadius: number;
    densityLimit: number;
}

// Helpers
export const yieldControl = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

export function shouldLogYieldProgress(current: number, total: number): boolean {
    return current === YIELD_ENTITY_BATCH_SIZE || current === total || current % YIELD_LOG_INTERVAL === 0;
}


// --- HELPER: Position Validation ---
export function isPositionValid(x: number, z: number, radius: number): boolean {
    const distFromCenterSq = x * x + z * z;
    if (distFromCenterSq < 15 * 15) return false;

    // ⚡ PERFORMANCE: Use WASM Spatial Grid for O(1) check instead of O(N) loop
    const isValidWasm = checkPositionValidity(x, z, radius);
    if (isValidWasm === 1) return false; // 1 = Collision

    /* Legacy O(N) Loop - Kept for reference
    for (const obs of obstacles) {
        const dx = x - obs.position.x;
        const dz = z - obs.position.z;
        const distSq = dx * dx + dz * dz;
        const minDistance = obs.radius + radius + 1.5;
        if (distSq < minDistance * minDistance) return false;
    }
    */

    // 3. Lake Avoidance for PROCEDURAL content
    // We specifically prevent random generation in the lake so we don't drown bushes.
    // However, map.json entities or explicitly placed objects (like the Cave) are allowed.
    if (x > -40 && x < 80 && z > -30 && z < 70) {
        return false;
    }

    return true;
}

const TYPE_ALIASES: Record<string, string> = {
    panningPad: 'panning_pad',
    instrumentShrine: 'instrument_shrine',
    kickDrumGeyser: 'kick_drum_geyser',
    snareTrap: 'snare_trap',
    subwooferLotus: 'subwoofer_lotus',
    prismRoseBush: 'prism_rose_bush',
    fiberOpticWillow: 'fiber_optic_willow',
    bubbleWillow: 'bubble_willow',
    portamentoPine: 'portamento_pine',
    gemCanopyTree: 'gem_canopy_tree',
    skyIsland: 'sky_island',
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

export function normalizeMapEntityType(type: string): string {
    return TYPE_ALIASES[type] ?? type;
}

// --- MAP GENERATION ---
/**
 * Determine if an entity is critical for initial load (collision, physics, interaction)
 */
export function isCriticalEntity(item: MapEntity | { type: string, isObstacle?: boolean }): boolean {
    const criticalTypes = [
        'mushroom', // Often giant / bouncy
        'tree',     // usually has collision
        'arpeggio_fern',
        'portamento_pine',
        'snare_trap',
        'kick_drum_geyser',
        'trap',
        'panning_pad',
        'cloud',    // can be Walkable
        'vine_ladder',
        'sky_island',
        'instrument_shrine',
        'waterfall'
    ];

    if (criticalTypes.includes(normalizeMapEntityType(item.type))) return true;

    // Explicit overrides
    if ((item as any).critical === true) return true;
    if ((item as any).isObstacle === true) return true;
    if (item.type === 'cave') return true;

    return false;
}
