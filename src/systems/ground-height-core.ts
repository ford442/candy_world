/**
 * Pure JS unified ground-height core (cache + platform override + lake/island).
 * Source of truth for fallback paths; mirrors assembly/ground.ts and emscripten/ground.cpp.
 */

import * as THREE from 'three';

// -----------------------------------------------------------------------------
// Lake / island constants (single source of truth)
// -----------------------------------------------------------------------------

export const LAKE_BOUNDS = {
    minX: -38,
    maxX: 78,
    minZ: -28,
    maxZ: 68
} as const;

export const LAKE_BOTTOM = -2.0;

export const LAKE_ISLAND = {
    centerX: 20,
    centerZ: 20,
    radius: 12,
    peakHeight: 3.0,
    falloffRadius: 4,
    enabled: true
} as const;

export const LAKE_ISLAND_RADIUS_SQ = LAKE_ISLAND.radius * LAKE_ISLAND.radius;

export interface GroundPlatform {
    id: string;
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    priority?: number;
}

// -----------------------------------------------------------------------------
// Fixed-size exact-position height cache
// -----------------------------------------------------------------------------

const CACHE_SIZE = 256;
const EMPTY_KEY = Number.POSITIVE_INFINITY;

const _cache = new Float64Array(CACHE_SIZE * 4);
let _cacheTTL = 1.0;
let _lastPurge = 0;

export function setGroundCacheTTL(seconds: number): void {
    _cacheTTL = seconds;
}

function quantizeCoord(v: number): number {
    return Math.round(v * 100);
}

function hashSlot(qx: number, qz: number): number {
    let h = qx * 73856093;
    h ^= qz * 19349663;
    h ^= h >>> 16;
    return Math.abs(h) % CACHE_SIZE;
}

const _cacheProbe = { qx: EMPTY_KEY, qz: EMPTY_KEY, height: 0, time: 0 };

function readCacheSlot(slot: number): void {
    const off = slot * 4;
    _cacheProbe.qx = _cache[off];
    _cacheProbe.qz = _cache[off + 1];
    _cacheProbe.height = _cache[off + 2];
    _cacheProbe.time = _cache[off + 3];
}

function writeCacheSlot(slot: number, qx: number, qz: number, height: number, time: number): void {
    const off = slot * 4;
    _cache[off] = qx;
    _cache[off + 1] = qz;
    _cache[off + 2] = height;
    _cache[off + 3] = time;
}

function lookupCachedHeight(qx: number, qz: number, now: number): number | null {
    const ttlMs = _cacheTTL * 1000;
    let slot = hashSlot(qx, qz);
    for (let probe = 0; probe < CACHE_SIZE; probe++) {
        readCacheSlot(slot);
        if (_cacheProbe.qx === EMPTY_KEY) return null;
        if (_cacheProbe.qx === qx && _cacheProbe.qz === qz) {
            if (now - _cacheProbe.time <= ttlMs) return _cacheProbe.height;
            writeCacheSlot(slot, EMPTY_KEY, EMPTY_KEY, 0, 0);
            return null;
        }
        slot = (slot + 1) % CACHE_SIZE;
    }
    return null;
}

function storeCachedHeight(qx: number, qz: number, height: number, now: number): void {
    let slot = hashSlot(qx, qz);
    for (let probe = 0; probe < CACHE_SIZE; probe++) {
        readCacheSlot(slot);
        if (_cacheProbe.qx === EMPTY_KEY || (_cacheProbe.qx === qx && _cacheProbe.qz === qz)) {
            writeCacheSlot(slot, qx, qz, height, now);
            return;
        }
        slot = (slot + 1) % CACHE_SIZE;
    }
    writeCacheSlot(slot, qx, qz, height, now);

    if (now - _lastPurge > 1000) {
        purgeStaleCacheEntries(now);
        _lastPurge = now;
    }
}

function purgeStaleCacheEntries(now: number): void {
    const ttlMs = _cacheTTL * 1000;
    for (let slot = 0; slot < CACHE_SIZE; slot++) {
        readCacheSlot(slot);
        if (_cacheProbe.qx !== EMPTY_KEY && now - _cacheProbe.time > ttlMs) {
            writeCacheSlot(slot, EMPTY_KEY, EMPTY_KEY, 0, 0);
        }
    }
}

export function invalidateJsGroundCache(): void {
    _cache.fill(EMPTY_KEY);
    _lastPurge = performance.now();
}

export function applyPlatformOverride(
    x: number,
    z: number,
    terrainHeight: number,
    platforms: readonly GroundPlatform[]
): number {
    let bestHeight = terrainHeight;
    for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
        if (p.maxY > bestHeight) bestHeight = p.maxY;
    }
    return bestHeight;
}

export function applyLakeModifiers(x: number, z: number, height: number): number {
    if (x <= LAKE_BOUNDS.minX || x >= LAKE_BOUNDS.maxX || z <= LAKE_BOUNDS.minZ || z >= LAKE_BOUNDS.maxZ) {
        return height;
    }

    if (LAKE_ISLAND.enabled) {
        const dx = x - LAKE_ISLAND.centerX;
        const dz = z - LAKE_ISLAND.centerZ;
        const distSq = dx * dx + dz * dz;
        if (distSq < LAKE_ISLAND_RADIUS_SQ) {
            const dist = Math.sqrt(distSq);
            const normalizedDist = dist / LAKE_ISLAND.radius;
            const islandHeight = LAKE_ISLAND.peakHeight * Math.cos(normalizedDist * Math.PI / 2);
            const edgeDist = LAKE_ISLAND.radius - dist;
            const edgeBlend = Math.min(1.0, edgeDist / LAKE_ISLAND.falloffRadius);
            const waterLevel = 1.5;
            const finalIslandHeight = waterLevel + islandHeight * edgeBlend;
            return Math.max(height, finalIslandHeight);
        }
    }

    const distX = Math.min(x - LAKE_BOUNDS.minX, LAKE_BOUNDS.maxX - x);
    const distZ = Math.min(z - LAKE_BOUNDS.minZ, LAKE_BOUNDS.maxZ - z);
    const distEdge = Math.min(distX, distZ);
    const blend = Math.min(1.0, distEdge / 10.0);
    const targetHeight = THREE.MathUtils.lerp(height, LAKE_BOTTOM, blend);
    return targetHeight < height ? targetHeight : height;
}

/**
 * JS unified ground height: terrain sample + platform + lake + cache.
 */
export function queryUnifiedGroundHeightJS(
    x: number,
    z: number,
    now: number,
    getTerrainHeight: (x: number, z: number) => number,
    platforms: readonly GroundPlatform[]
): number {
    const qx = quantizeCoord(x);
    const qz = quantizeCoord(z);
    const cached = lookupCachedHeight(qx, qz, now);
    if (cached !== null) return cached;

    const terrainHeight = getTerrainHeight(x, z);
    let height = applyPlatformOverride(x, z, terrainHeight, platforms);
    height = applyLakeModifiers(x, z, height);

    storeCachedHeight(qx, qz, height, now);
    return height;
}

/**
 * Batch JS unified ground height into `out` without allocating.
 */
export function fillUnifiedGroundHeightsJS(
    positions: Float32Array,
    out: Float32Array,
    count: number,
    now: number,
    getTerrainHeight: (x: number, z: number) => number,
    platforms: readonly GroundPlatform[]
): void {
    for (let i = 0; i < count; i++) {
        out[i] = queryUnifiedGroundHeightJS(
            positions[i * 2],
            positions[i * 2 + 1],
            now,
            getTerrainHeight,
            platforms
        );
    }
}
