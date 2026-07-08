/**
 * @file src/systems/ground-system.ts
 * @brief Single authoritative ground-height query for Candy World.
 *
 * This module consolidates terrain sampling, lake/island carving, and (soon)
 * walkable platform overrides into one query surface. All systems that need
 * ground height should read from here instead of duplicating lake/island math
 * or calling the raw WASM terrain function directly.
 *
 * Query priority:
 *   1. Registered platforms (e.g. cloud tops, panning pads) — highest Y wins.
 *   2. Raw WASM terrain height via getGroundHeight from wasm-loader.
 *   3. Lake Melody carving + Lake Island rise.
 *
 * Performance:
 *   - A small fixed-size open-addressing cache stores exact (x,z) samples to
 *     avoid repeated WASM calls when multiple systems ask for the same point.
 *   - All hot-path lookup/insertion uses integer math and typed arrays; no
 *     per-query string or object allocation.
 */

import * as THREE from 'three';
import { getGroundHeight as getWasmGroundHeight } from '../utils/wasm-loader.ts';
import { CONFIG } from '../core/config.ts';

// -----------------------------------------------------------------------------
// Lake / Island constants (single source of truth moved from physics.core.ts
// and generation-utils.ts)
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

/**
 * Check if (x, z) lies inside the carved lake basin.
 * Used by physics routing and gameplay water checks.
 */
export function isInLakeBasin(x: number, z: number): boolean {
    return (
        x > LAKE_BOUNDS.minX &&
        x < LAKE_BOUNDS.maxX &&
        z > LAKE_BOUNDS.minZ &&
        z < LAKE_BOUNDS.maxZ
    );
}

/**
 * Check if (x, z) is on the Lake Island (solid ground above the water).
 */
export function isOnLakeIsland(x: number, z: number): boolean {
    if (!LAKE_ISLAND.enabled) return false;
    const dx = x - LAKE_ISLAND.centerX;
    const dz = z - LAKE_ISLAND.centerZ;
    const distFromCenterSq = dx * dx + dz * dz;
    return distFromCenterSq < LAKE_ISLAND_RADIUS_SQ;
}

// -----------------------------------------------------------------------------
// Platform registry (foundation for #1266 walkable cloud platforms)
// -----------------------------------------------------------------------------

export interface GroundPlatform {
    id: string;
    /** Axis-aligned bounds of the walkable surface in world units. */
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    /** Higher priority platforms win when multiple overlap. */
    priority?: number;
}

const _platforms: GroundPlatform[] = [];

export function registerPlatform(platform: GroundPlatform): void {
    // Replace existing platform with same id if present.
    const existing = _platforms.findIndex(p => p.id === platform.id);
    if (existing >= 0) {
        _platforms[existing] = platform;
    } else {
        _platforms.push(platform);
    }
    invalidateHeightCache();
}

export function unregisterPlatform(id: string): void {
    const idx = _platforms.findIndex(p => p.id === id);
    if (idx >= 0) {
        _platforms.splice(idx, 1);
        invalidateHeightCache();
    }
}

export function getPlatforms(): readonly GroundPlatform[] {
    return _platforms;
}

export function clearPlatforms(): void {
    _platforms.length = 0;
    invalidateHeightCache();
}

function applyPlatformOverride(x: number, z: number, terrainHeight: number): number {
    let bestHeight = terrainHeight;
    for (let i = 0; i < _platforms.length; i++) {
        const p = _platforms[i];
        if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
        if (p.maxY > bestHeight) bestHeight = p.maxY;
    }
    return bestHeight;
}

// -----------------------------------------------------------------------------
// Fixed-size exact-position height cache
// -----------------------------------------------------------------------------

const CACHE_SIZE = 256;
const CACHE_SLOTS = CACHE_SIZE;
const EMPTY_KEY = Number.POSITIVE_INFINITY;

// Each slot stores [quantizedX, quantizedZ, height, timestamp]
const _cache = new Float64Array(CACHE_SLOTS * 4);
let _cacheConfigured = false;
let _cacheCellSize = 2.0;
let _cacheTTL = 1.0;
let _lastPurge = 0;

function ensureCacheConfig(): void {
    if (_cacheConfigured) return;
    const cfg = CONFIG.ground;
    _cacheCellSize = cfg.cacheCellSize ?? _cacheCellSize;
    _cacheTTL = cfg.cacheTTL ?? _cacheTTL;
    _cache.fill(EMPTY_KEY);
    _cacheConfigured = true;
}

function quantizeCoord(v: number): number {
    // 0.01 unit precision is plenty for ground/eye queries and keeps the
    // cache meaningful across tiny sub-frame position differences.
    return Math.round(v * 100);
}

function hashSlot(qx: number, qz: number): number {
    // Simple hash-mix turned into a positive index.
    let h = qx * 73856093;
    h ^= qz * 19349663;
    h ^= h >>> 16;
    return Math.abs(h) % CACHE_SLOTS;
}

function readCacheSlot(slot: number, out: { qx: number; qz: number; height: number; time: number }): void {
    const off = slot * 4;
    out.qx = _cache[off];
    out.qz = _cache[off + 1];
    out.height = _cache[off + 2];
    out.time = _cache[off + 3];
}

function writeCacheSlot(slot: number, qx: number, qz: number, height: number, time: number): void {
    const off = slot * 4;
    _cache[off] = qx;
    _cache[off + 1] = qz;
    _cache[off + 2] = height;
    _cache[off + 3] = time;
}

const _cacheProbe = { qx: EMPTY_KEY, qz: EMPTY_KEY, height: 0, time: 0 };

function lookupCachedHeight(qx: number, qz: number, now: number): number | null {
    ensureCacheConfig();
    const ttlMs = _cacheTTL * 1000;
    let slot = hashSlot(qx, qz);
    for (let probe = 0; probe < CACHE_SLOTS; probe++) {
        readCacheSlot(slot, _cacheProbe);
        if (_cacheProbe.qx === EMPTY_KEY) return null;
        if (_cacheProbe.qx === qx && _cacheProbe.qz === qz) {
            if (now - _cacheProbe.time <= ttlMs) return _cacheProbe.height;
            // Expired: treat as empty and stop probing (open addressing simplification).
            writeCacheSlot(slot, EMPTY_KEY, EMPTY_KEY, 0, 0);
            return null;
        }
        slot = (slot + 1) % CACHE_SLOTS;
    }
    return null;
}

function storeCachedHeight(qx: number, qz: number, height: number, now: number): void {
    let slot = hashSlot(qx, qz);
    for (let probe = 0; probe < CACHE_SLOTS; probe++) {
        readCacheSlot(slot, _cacheProbe);
        if (_cacheProbe.qx === EMPTY_KEY || _cacheProbe.qx === qx && _cacheProbe.qz === qz) {
            writeCacheSlot(slot, qx, qz, height, now);
            return;
        }
        slot = (slot + 1) % CACHE_SLOTS;
    }
    // Cache full: overwrite the starting slot. This is rare and harmless.
    writeCacheSlot(slot, qx, qz, height, now);

    // Periodic lazy purge of stale entries (~once per second).
    if (now - _lastPurge > 1000) {
        purgeStaleCacheEntries(now);
        _lastPurge = now;
    }
}

function purgeStaleCacheEntries(now: number): void {
    const ttlMs = _cacheTTL * 1000;
    for (let slot = 0; slot < CACHE_SLOTS; slot++) {
        readCacheSlot(slot, _cacheProbe);
        if (_cacheProbe.qx !== EMPTY_KEY && now - _cacheProbe.time > ttlMs) {
            writeCacheSlot(slot, EMPTY_KEY, EMPTY_KEY, 0, 0);
        }
    }
}

export function invalidateHeightCache(): void {
    _cache.fill(EMPTY_KEY);
    _lastPurge = performance.now();
    invalidateFootprintCache();
}

// -----------------------------------------------------------------------------
// Lake / island modifiers
// -----------------------------------------------------------------------------

function applyLakeModifiers(x: number, z: number, height: number): number {
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

// -----------------------------------------------------------------------------
// Public query surface
// -----------------------------------------------------------------------------

/**
 * Thin wrapper over the raw WASM terrain function. Does NOT apply lake/island
 * or platform overrides. Most callers should use {@link getGroundHeight}.
 */
export function getRawTerrainHeight(x: number, z: number): number {
    return getWasmGroundHeight(x, z);
}

/**
 * Authoritative ground height at (x, z). Applies platform overrides, raw
 * terrain, and lake/island carving, with a small fixed-size exact-position
 * cache to avoid redundant WASM calls.
 */
export function getGroundHeight(x: number, z: number): number {
    ensureCacheConfig();
    const now = performance.now();
    const qx = quantizeCoord(x);
    const qz = quantizeCoord(z);
    const cached = lookupCachedHeight(qx, qz, now);
    if (cached !== null) return cached;

    const terrainHeight = getWasmGroundHeight(x, z);
    let height = applyPlatformOverride(x, z, terrainHeight);
    height = applyLakeModifiers(x, z, height);

    storeCachedHeight(qx, qz, height, now);
    return height;
}

/**
 * Batched ground-height lookup. Returns a new Float32Array of heights.
 * Uses the same authoritative path as {@link getGroundHeight}.
 */
export function getGroundHeightBatch(positions: Float32Array): Float32Array {
    const count = positions.length / 2;
    const out = new Float32Array(count);
    fillGroundHeightsBatch(positions, out, count);
    return out;
}

/**
 * Write authoritative ground heights into `out` without allocating.
 * `positions` is [x0,z0, x1,z1, ...]; `out[i]` receives the height at sample i.
 */
export function fillGroundHeightsBatch(positions: Float32Array, out: Float32Array, count: number): void {
    for (let i = 0; i < count; i++) {
        out[i] = getGroundHeight(positions[i * 2], positions[i * 2 + 1]);
    }
}

/**
 * Target first-person eye Y at (x, z): authoritative ground + configured eye offset.
 */
export function getEyeTargetY(x: number, z: number): number {
    return getGroundHeight(x, z) + CONFIG.player.eyeHeight;
}

export interface GroundedEyeReconcileOptions {
    isGrounded: boolean;
    velocityY: number;
}

/**
 * Reconcile player/camera Y with the authoritative ground surface.
 * - Always raises when below terrain eye level (prevents sinking).
 * - When grounded near terrain, smoothly lerps toward eye target (handles downhill).
 * - When clearly on a platform (cloud, pad), leaves Y unchanged.
 */
export function reconcileGroundedEyeY(
    currentY: number,
    x: number,
    z: number,
    delta: number,
    opts: GroundedEyeReconcileOptions
): number {
    const eyeY = getEyeTargetY(x, z);

    // Sinking below carved terrain / lake surface — snap up immediately.
    if (currentY < eyeY) {
        return eyeY;
    }

    if (!opts.isGrounded || opts.velocityY > 0.05) {
        return currentY;
    }

    const threshold = CONFIG.ground.platformElevationThreshold;
    const heightAboveTerrain = currentY - eyeY;
    if (heightAboveTerrain > threshold) {
        return currentY;
    }

    const lerpSpeed = CONFIG.ground.followLerpSpeed;
    const maxStep = CONFIG.ground.followMaxStep;
    let nextY = THREE.MathUtils.lerp(currentY, eyeY, Math.min(delta * lerpSpeed, 1.0));
    nextY = THREE.MathUtils.clamp(nextY, currentY - maxStep, currentY + maxStep);
    return nextY;
}

/** Approximate walkable top surface for a tier-1 cloud group. */
export function registerWalkableCloudPlatform(cloud: THREE.Object3D): void {
    if (!cloud.userData.isWalkable) return;

    const scale = cloud.scale;
    const sizeMul = typeof cloud.userData.cloudScale === 'number' ? cloud.userData.cloudScale : 1.0;
    const halfX = 3.5 * scale.x * sizeMul * 0.5;
    const halfZ = 3.5 * scale.z * sizeMul * 0.5;
    const topY = cloud.position.y + scale.y * sizeMul * 0.35;

    const id = typeof cloud.userData.persistentId === 'string'
        ? `cloud:${cloud.userData.persistentId}`
        : typeof cloud.userData.mapEntityId === 'string'
            ? `cloud:${cloud.userData.mapEntityId}`
            : `cloud:${cloud.position.x.toFixed(1)}_${cloud.position.z.toFixed(1)}_${cloud.position.y.toFixed(1)}`;

    registerPlatform({
        id,
        minX: cloud.position.x - halfX,
        maxX: cloud.position.x + halfX,
        minZ: cloud.position.z - halfZ,
        maxZ: cloud.position.z + halfZ,
        minY: topY - 0.6,
        maxY: topY,
        priority: 2,
    });
}

// -----------------------------------------------------------------------------
// Baked normal data registration (populated by ground-heightmap.ts)
// -----------------------------------------------------------------------------

interface BakedNormalData {
    normals: Float32Array;
    size: number;
    resolution: number;
}

let _bakedNormalData: BakedNormalData | null = null;

export function registerGroundNormalData(
    normals: Float32Array,
    size: number,
    resolution: number
): void {
    _bakedNormalData = { normals, size, resolution };
}

const _fdDelta = 0.05;
const _fdTx = new THREE.Vector3();
const _fdTz = new THREE.Vector3();
const _normalScratch = new THREE.Vector3();
const _fpNormalScratch = new THREE.Vector3();

function sampleBakedGroundNormalInto(x: number, z: number, out: THREE.Vector3): boolean {
    if (!_bakedNormalData) return false;
    const { normals, size, resolution } = _bakedNormalData;
    const halfSize = size * 0.5;
    if (
        x < -halfSize || x > halfSize ||
        z < -halfSize || z > halfSize
    ) {
        return false;
    }

    const step = size / resolution;
    const fx = (x + halfSize) / step;
    const fy = (-z + halfSize) / step;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);

    if (ix < 0 || ix >= resolution || iy < 0 || iy >= resolution) {
        return false;
    }

    const u = fx - ix;
    const v = fy - iy;
    const row = resolution + 1;
    const i00 = (iy * row + ix) * 3;
    const i10 = i00 + 3;
    const i01 = ((iy + 1) * row + ix) * 3;
    const i11 = i01 + 3;

    const nx = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(normals[i00], normals[i10], u),
        THREE.MathUtils.lerp(normals[i01], normals[i11], u),
        v
    );
    const ny = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(normals[i00 + 1], normals[i10 + 1], u),
        THREE.MathUtils.lerp(normals[i01 + 1], normals[i11 + 1], u),
        v
    );
    const nz = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(normals[i00 + 2], normals[i10 + 2], u),
        THREE.MathUtils.lerp(normals[i01 + 2], normals[i11 + 2], u),
        v
    );

    out.set(nx, ny, nz).normalize();
    return true;
}

/**
 * Compute the terrain surface normal at (x, z).
 * Uses the baked normal map when available; otherwise falls back to a cheap
 * 3-point finite difference over the authoritative getGroundHeight() query.
 *
 * Pass `out` to avoid allocation (recommended in per-frame debug paths).
 */
export function sampleGroundNormal(x: number, z: number, out: THREE.Vector3 = _normalScratch): THREE.Vector3 {
    if (sampleBakedGroundNormalInto(x, z, out)) {
        return out;
    }

    const hL = getGroundHeight(x - _fdDelta, z);
    const hR = getGroundHeight(x + _fdDelta, z);
    const hD = getGroundHeight(x, z - _fdDelta);
    const hU = getGroundHeight(x, z + _fdDelta);

    _fdTx.set(_fdDelta * 2, hR - hL, 0).normalize();
    _fdTz.set(0, hU - hD, _fdDelta * 2).normalize();

    out.crossVectors(_fdTz, _fdTx).normalize();
    if (out.y < 0.2) {
        out.y = 0.2;
        out.normalize();
    }
    return out;
}

export interface GroundFootprintResult {
    minY: number;
    avgY: number;
    maxY: number;
    normal: THREE.Vector3;
}

const _fpCenter = new THREE.Vector3();
const _fpResult: GroundFootprintResult = {
    minY: 0,
    avgY: 0,
    maxY: 0,
    normal: new THREE.Vector3(0, 1, 0),
};

// -----------------------------------------------------------------------------
// Footprint result cache (whole-ring samples, keyed by center + radius + count)
// -----------------------------------------------------------------------------

const FOOTPRINT_CACHE_SIZE = 64;

const _fpCacheV2 = new Float64Array(FOOTPRINT_CACHE_SIZE * 11);

const _fpCacheScratch = {
    qx: EMPTY_KEY,
    qz: EMPTY_KEY,
    qr: 0,
    qp: 0,
    minY: 0,
    avgY: 0,
    maxY: 0,
    time: 0,
    nx: 0,
    ny: 1,
    nz: 0,
};

function quantizeRadius(r: number): number {
    return Math.round(r * 100);
}

function footprintHashSlot(qx: number, qz: number, qr: number, qp: number): number {
    let h = qx * 73856093;
    h ^= qz * 19349663;
    h ^= qr * 83492791;
    h ^= qp * 50331653;
    h ^= h >>> 16;
    return Math.abs(h) % FOOTPRINT_CACHE_SIZE;
}
function readFootprintSlotV2(slot: number): void {
    const off = slot * 11;
    _fpCacheScratch.qx = _fpCacheV2[off];
    _fpCacheScratch.qz = _fpCacheV2[off + 1];
    _fpCacheScratch.qr = _fpCacheV2[off + 2];
    _fpCacheScratch.qp = _fpCacheV2[off + 3];
    _fpCacheScratch.minY = _fpCacheV2[off + 4];
    _fpCacheScratch.avgY = _fpCacheV2[off + 5];
    _fpCacheScratch.maxY = _fpCacheV2[off + 6];
    _fpCacheScratch.nx = _fpCacheV2[off + 7];
    _fpCacheScratch.ny = _fpCacheV2[off + 8];
    _fpCacheScratch.nz = _fpCacheV2[off + 9];
    _fpCacheScratch.time = _fpCacheV2[off + 10];
}

function writeFootprintSlotV2(
    slot: number,
    qx: number,
    qz: number,
    qr: number,
    qp: number,
    minY: number,
    avgY: number,
    maxY: number,
    nx: number,
    ny: number,
    nz: number,
    time: number
): void {
    const off = slot * 11;
    _fpCacheV2[off] = qx;
    _fpCacheV2[off + 1] = qz;
    _fpCacheV2[off + 2] = qr;
    _fpCacheV2[off + 3] = qp;
    _fpCacheV2[off + 4] = minY;
    _fpCacheV2[off + 5] = avgY;
    _fpCacheV2[off + 6] = maxY;
    _fpCacheV2[off + 7] = nx;
    _fpCacheV2[off + 8] = ny;
    _fpCacheV2[off + 9] = nz;
    _fpCacheV2[off + 10] = time;
}

function lookupFootprintCache(
    qx: number,
    qz: number,
    qr: number,
    qp: number,
    now: number
): GroundFootprintResult | null {
    ensureCacheConfig();
    const ttlMs = _cacheTTL * 1000;
    let slot = footprintHashSlot(qx, qz, qr, qp);
    for (let probe = 0; probe < FOOTPRINT_CACHE_SIZE; probe++) {
        readFootprintSlotV2(slot);
        if (_fpCacheScratch.qx === EMPTY_KEY) return null;
        if (
            _fpCacheScratch.qx === qx &&
            _fpCacheScratch.qz === qz &&
            _fpCacheScratch.qr === qr &&
            _fpCacheScratch.qp === qp
        ) {
            if (now - _fpCacheScratch.time > ttlMs) {
                writeFootprintSlotV2(slot, EMPTY_KEY, EMPTY_KEY, 0, 0, 0, 0, 0, 0, 1, 0, 0);
                return null;
            }
            _fpResult.minY = _fpCacheScratch.minY;
            _fpResult.avgY = _fpCacheScratch.avgY;
            _fpResult.maxY = _fpCacheScratch.maxY;
            _fpResult.normal.set(_fpCacheScratch.nx, _fpCacheScratch.ny, _fpCacheScratch.nz);
            return _fpResult;
        }
        slot = (slot + 1) % FOOTPRINT_CACHE_SIZE;
    }
    return null;
}

function storeFootprintCache(
    qx: number,
    qz: number,
    qr: number,
    qp: number,
    result: GroundFootprintResult,
    now: number
): void {
    let slot = footprintHashSlot(qx, qz, qr, qp);
    for (let probe = 0; probe < FOOTPRINT_CACHE_SIZE; probe++) {
        readFootprintSlotV2(slot);
        if (
            _fpCacheScratch.qx === EMPTY_KEY ||
            (_fpCacheScratch.qx === qx && _fpCacheScratch.qz === qz && _fpCacheScratch.qr === qr && _fpCacheScratch.qp === qp)
        ) {
            writeFootprintSlotV2(
                slot,
                qx,
                qz,
                qr,
                qp,
                result.minY,
                result.avgY,
                result.maxY,
                result.normal.x,
                result.normal.y,
                result.normal.z,
                now
            );
            return;
        }
        slot = (slot + 1) % FOOTPRINT_CACHE_SIZE;
    }
    writeFootprintSlotV2(
        slot,
        qx,
        qz,
        qr,
        qp,
        result.minY,
        result.avgY,
        result.maxY,
        result.normal.x,
        result.normal.y,
        result.normal.z,
        now
    );
}

export function invalidateFootprintCache(): void {
    _fpCacheV2.fill(EMPTY_KEY);
}

const _fpBatchPositions = new Float32Array(20); // up to 9 samples (4 perimeter + center)
const _fpBatchHeights = new Float32Array(10);

/**
 * Sample a circular footprint around (x, z) to find the lowest/average ground
 * contact and a representative surface normal. Uses batched getGroundHeight()
 * queries and a small footprint-level cache so repeated placements at the same
 * cell during world-gen do not re-walk the ring.
 *
 * Returns a reused module-scope object — clone fields if you need to retain them.
 */
export function sampleGroundFootprint(
    x: number,
    z: number,
    radius: number,
    points: number
): GroundFootprintResult {
    ensureCacheConfig();
    const now = performance.now();
    const qx = quantizeCoord(x);
    const qz = quantizeCoord(z);
    const qr = quantizeRadius(radius);
    const qp = points;
    const cached = lookupFootprintCache(qx, qz, qr, qp, now);
    if (cached) return cached;

    const count = points + 1; // center + perimeter points
    _fpBatchPositions[0] = x;
    _fpBatchPositions[1] = z;

    for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const off = (i + 1) * 2;
        _fpBatchPositions[off] = x + Math.cos(angle) * radius;
        _fpBatchPositions[off + 1] = z + Math.sin(angle) * radius;
    }

    fillGroundHeightsBatch(_fpBatchPositions, _fpBatchHeights, count);

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let sumY = 0;
    _fpCenter.set(0, 0, 0);

    for (let i = 0; i < count; i++) {
        const sy = _fpBatchHeights[i];
        const sx = _fpBatchPositions[i * 2];
        const sz = _fpBatchPositions[i * 2 + 1];
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
        sumY += sy;
        _fpCenter.x += sx;
        _fpCenter.y += sy;
        _fpCenter.z += sz;
    }

    _fpCenter.divideScalar(count);
    const avgY = sumY / count;
    sampleGroundNormal(_fpCenter.x, _fpCenter.z, _fpResult.normal);

    _fpResult.minY = minY;
    _fpResult.avgY = avgY;
    _fpResult.maxY = maxY;

    storeFootprintCache(qx, qz, qr, qp, _fpResult, now);
    return _fpResult;
}

export function unregisterWalkableCloudPlatform(cloud: THREE.Object3D): void {
    const id = typeof cloud.userData.persistentId === 'string'
        ? `cloud:${cloud.userData.persistentId}`
        : typeof cloud.userData.mapEntityId === 'string'
            ? `cloud:${cloud.userData.mapEntityId}`
            : `cloud:${cloud.position.x.toFixed(1)}_${cloud.position.z.toFixed(1)}_${cloud.position.y.toFixed(1)}`;
    unregisterPlatform(id);
}
