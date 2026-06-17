import * as THREE from 'three';
import { getGroundHeight, checkPositionValidity } from '../utils/wasm-loader.ts';
import { CONFIG } from '../core/config.ts';

export const DEFAULT_MAP_CHUNK_SIZE = 100;
export const DEFAULT_PROCEDURAL_CHUNK_SIZE = 100;

// Population numbers are now driven from CONFIG.world.population for easier tuning.
// These are the effective values used by Full mode generation.
const cfg = (typeof CONFIG !== 'undefined' ? CONFIG : undefined) as any;
const pop = (cfg && cfg.world && cfg.world.population) ? cfg.world.population : {};
let popScale = pop.scale ?? 1.0;

// Runtime override for "Fast Full Mode" (chosen in the startup UI)
if ((window as any).__fastPopulationOverride) {
    popScale *= 0.42; // Aggressive reduction for fast loading while still feeling like "full"
}

export const PROCEDURAL_ENTITY_COUNT = 200;
export const ENTITY_BUDGET_MS = 14;
export const YIELD_ENTITY_BATCH_SIZE = 40;
export const YIELD_LOG_INTERVAL = YIELD_ENTITY_BATCH_SIZE * 5;

// Arpeggio Grove counts (used by generation-decorators)
export const ARPEGGIO_GROVE_FERN_COUNT = Math.max(3, Math.floor((pop.arpeggioGroveFerns ?? 7) * popScale));
export const ARPEGGIO_GROVE_OUTER_COUNT = Math.max(2, Math.floor((pop.arpeggioGroveOuter ?? 4) * popScale));
export const LAKE_ARPEGGIO_FERN_COUNT = Math.max(1, Math.floor((pop.lakeArpeggioFerns ?? 3) * popScale));
export const LAKE_DANDELION_COUNT = Math.max(2, Math.floor((pop.lakeDandelions ?? 6) * popScale));

// Constants
export const LAKE_BOUNDS = { minX: -38, maxX: 78, minZ: -28, maxZ: 68 };
export const LAKE_BOTTOM = -2.0;
export const LAKE_ISLAND = {
    centerX: 20,
    centerZ: 20,
    radius: 12,
    peakHeight: 3.0,
    falloffRadius: 4,
    enabled: true
};
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

// Note: Actual fern/outer counts for the grove now come from
// CONFIG.world.population (see above) and are consumed in generation-decorators.ts.

export const obstaclesData: {x: number, y: number, z: number, radius: number}[] = [];

// Types
export interface MapEntity {
    id?: string;
    type: string;
    position: [number, number, number];
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

// Helper: Calculate Unified Ground Height (WASM + Visual Lake Modifiers + Island)
// Matches logic in src/systems/physics.js
export function getUnifiedGroundHeight(x: number, z: number): number {
    let height = getGroundHeight(x, z);

    // Check if we're in the lake bounds
    if (x > LAKE_BOUNDS.minX && x < LAKE_BOUNDS.maxX && z > LAKE_BOUNDS.minZ && z < LAKE_BOUNDS.maxZ) {
        // Calculate distance from lake edges
        const distX = Math.min(x - LAKE_BOUNDS.minX, LAKE_BOUNDS.maxX - x);
        const distZ = Math.min(z - LAKE_BOUNDS.minZ, LAKE_BOUNDS.maxZ - z);
        const distEdge = Math.min(distX, distZ);

        // Check if we're on the island
        if (LAKE_ISLAND.enabled) {
            const dx = x - LAKE_ISLAND.centerX;
            const dz = z - LAKE_ISLAND.centerZ;

            // ⚡ OPTIMIZATION: Deferred Math.sqrt() by using squared distance for early-out bounds check.
            const distFromIslandCenterSq = dx * dx + dz * dz;
            const islandRadiusSq = LAKE_ISLAND.radius * LAKE_ISLAND.radius;

            if (distFromIslandCenterSq < islandRadiusSq) {
                const distFromIslandCenter = Math.sqrt(distFromIslandCenterSq);
                // On the island - calculate height above water
                const normalizedDist = distFromIslandCenter / LAKE_ISLAND.radius;

                // Smooth falloff using cosine curve for natural hill shape
                const islandHeight = LAKE_ISLAND.peakHeight * Math.cos(normalizedDist * Math.PI / 2);

                // Blend at the edge of the island
                const edgeDist = LAKE_ISLAND.radius - distFromIslandCenter;
                const edgeBlend = Math.min(1.0, edgeDist / LAKE_ISLAND.falloffRadius);

                // Island height above water level (water is at ~1.5)
                const waterLevel = 1.5;
                const finalIslandHeight = waterLevel + (islandHeight * edgeBlend);

                // Return island height (don't apply lake depression)
                return Math.max(height, finalIslandHeight);
            }
        }

        // Not on island - apply lake depression
        const blend = Math.min(1.0, distEdge / 10.0);
        const targetHeight = THREE.MathUtils.lerp(height, LAKE_BOTTOM, blend);

        if (targetHeight < height) {
            height = targetHeight;
        }
    }
    return height;
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
