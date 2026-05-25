import * as THREE from 'three';
import { getGroundHeight, checkPositionValidity } from '../utils/wasm-loader.js';

export const DEFAULT_MAP_CHUNK_SIZE = 100;
export const DEFAULT_PROCEDURAL_CHUNK_SIZE = 100;
// Reduced from 400 → 200: halves synchronous + deferred work in Full mode
// without meaningfully affecting visual density (the map.json already has 2192 entities).
export const PROCEDURAL_ENTITY_COUNT = 200;
export const ENTITY_BUDGET_MS = 14;
export const YIELD_ENTITY_BATCH_SIZE = 40;
export const YIELD_LOG_INTERVAL = YIELD_ENTITY_BATCH_SIZE * 5;

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

export const obstaclesData: {x: number, y: number, z: number, radius: number}[] = [];

// Types
export interface MapEntity {
    type: string;
    position: [number, number, number];
    variant?: string;
    scale?: number;
    size?: number | string;
    note?: string;
    noteIndex?: number;
    hasFace?: boolean;
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
        'geyser',
        'trap',
        'panningPad',
        'cloud',    // can be Walkable
        'vine_ladder',
        'instrumentShrine',
        'waterfall'
    ];

    if (criticalTypes.includes(item.type)) return true;

    // Explicit overrides
    if ((item as any).critical === true) return true;
    if ((item as any).isObstacle === true) return true;
    if (item.type === 'cave') return true;

    return false;
}
