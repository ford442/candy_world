/**
 * Play vs Explore world footprint.
 *
 * Play boots a compact visual terrain (~180×180 / ±90) so Enter stays fast.
 * ±75 (150×150) clips Melody Lake's east shore (~x=80) and the mycelium grove
 * (~78,78), so we start at 180 — still inside the 120–180 target band.
 * Explore keeps the existing ~400×400 visual mesh. Entities beyond the Play
 * envelope stream in via ChunkStreamer; terrain expands before the player
 * can walk off the Play mesh.
 */
import type { StartupPath } from '../core/startup-profile.ts';
import { DEFAULT_MAP_CHUNK_STREAM_SIZE } from './map-chunk-size.ts';

/** Asset-streaming HIGH-priority cell (docs/ASSET_STREAMING.md). */
export const STREAM_CELL_SIZE_M = 50;

/** Play visual terrain side length (metres). Half-extent = 90. */
export const PLAY_WORLD_SIZE = 180;
/** Explore / full-world visual terrain (legacy 400 mesh, ~±200). */
export const EXPLORE_WORLD_SIZE = 400;
/** CORE sandbox — already a small candy set. */
export const CORE_WORLD_SIZE = 120;

export const PLAY_WORLD_HALF = PLAY_WORLD_SIZE / 2;
export const EXPLORE_WORLD_HALF = EXPLORE_WORLD_SIZE / 2;
export const CORE_WORLD_HALF = CORE_WORLD_SIZE / 2;

/** Spawn tile + 1-ring must be ready before pointer-lock. */
export const PLAY_SPAWN_RADIUS_CHUNKS = 1;
/** Prefetch ahead of the player (~80–96 m ≈ 50 m cell + one 32 m chunk). */
export const PLAY_LOAD_RADIUS_M = 80;
/** Unload beyond the MEDIUM streaming band when memory is fine. */
export const PLAY_EVICT_RADIUS_M = 150;
/** Tighter eviction under JS-heap pressure. */
export const PLAY_EVICT_RADIUS_PRESSURE_M = 80;
/** Start expanding Play terrain when this close to the mesh edge. */
export const TERRAIN_EXPAND_MARGIN_M = 40;
/** Soft clamp so the player cannot walk off an unexpanded Play mesh. */
export const TERRAIN_EDGE_CLAMP_M = 2;

export interface WorldExtentConfig {
    size: number;
    halfExtent: number;
    heightmapResolution: number;
    grassCapacity: number;
    luminousPlantCount: number;
    fogFarCap: number;
}

const PLAY_EXTENT: WorldExtentConfig = {
    size: PLAY_WORLD_SIZE,
    halfExtent: PLAY_WORLD_HALF,
    heightmapResolution: 128,
    grassCapacity: 2500,
    luminousPlantCount: 48,
    fogFarCap: PLAY_WORLD_HALF + 20,
};

const EXPLORE_EXTENT: WorldExtentConfig = {
    size: EXPLORE_WORLD_SIZE,
    halfExtent: EXPLORE_WORLD_HALF,
    heightmapResolution: 256,
    grassCapacity: 10000,
    luminousPlantCount: 150,
    fogFarCap: 420,
};

const CORE_EXTENT: WorldExtentConfig = {
    size: CORE_WORLD_SIZE,
    halfExtent: CORE_WORLD_HALF,
    heightmapResolution: 64,
    grassCapacity: 800,
    luminousPlantCount: 24,
    fogFarCap: CORE_WORLD_HALF + 20,
};

export function worldExtentForPath(path: StartupPath | string | undefined): WorldExtentConfig {
    if (path === 'explore') return EXPLORE_EXTENT;
    if (path === 'core') return CORE_EXTENT;
    return PLAY_EXTENT;
}

export function metersToChunkRadius(
    meters: number,
    chunkSize: number = DEFAULT_MAP_CHUNK_STREAM_SIZE
): number {
    if (chunkSize <= 0) return 1;
    return Math.max(1, Math.ceil(meters / chunkSize));
}

export function clampToHalfExtent(
    x: number,
    z: number,
    halfExtent: number,
    pad: number = TERRAIN_EDGE_CLAMP_M
): { x: number; z: number; clamped: boolean } {
    const limit = Math.max(1, halfExtent - pad);
    const nx = Math.max(-limit, Math.min(limit, x));
    const nz = Math.max(-limit, Math.min(limit, z));
    return { x: nx, z: nz, clamped: nx !== x || nz !== z };
}
