/**
 * @file src/systems/ground-system.ts
 * @brief Single authoritative ground-height query for Candy World.
 *
 * Query priority:
 *   1. Registered platforms (e.g. cloud tops, panning pads) — highest Y wins.
 *   2. Raw WASM terrain height via getGroundHeight from wasm-loader.
 *   3. Lake Melody carving + Lake Island rise.
 *
 * Hot-path terrain + override + cache runs in assembly/ground.ts (and optional
 * emscripten/ground.cpp) with a JS fallback in ground-height-core.ts.
 */

import * as THREE from 'three';
import { getGroundHeight as getWasmGroundHeight } from '../utils/wasm-loader.ts';
import { CONFIG } from '../core/config.ts';
import {
    LAKE_BOUNDS,
    LAKE_BOTTOM,
    LAKE_ISLAND,
    LAKE_ISLAND_RADIUS_SQ,
    setGroundCacheTTL,
    type GroundPlatform,
} from './ground-height-core.ts';
import {
    queryUnifiedGroundHeight,
    fillUnifiedGroundHeights,
    syncGroundPlatformsToNative,
    syncGroundCacheTTLToNative,
    invalidateNativeGroundCache,
    isNativeUnifiedGroundReady,
    getUnifiedGroundBackend,
} from '../utils/wasm-ground.ts';

// Re-export constants and types for existing call sites
export { LAKE_BOUNDS, LAKE_BOTTOM, LAKE_ISLAND, LAKE_ISLAND_RADIUS_SQ };
export type { GroundPlatform };

/**
 * Check if (x, z) lies inside the carved lake basin.
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

const _platforms: GroundPlatform[] = [];

function ensureCacheConfig(): void {
    const ttl = CONFIG.ground.cacheTTL ?? 1.0;
    setGroundCacheTTL(ttl);
    syncGroundCacheTTLToNative(ttl);
}

function syncPlatforms(): void {
    syncGroundPlatformsToNative(_platforms);
}

export function registerPlatform(platform: GroundPlatform): void {
    const existing = _platforms.findIndex(p => p.id === platform.id);
    if (existing >= 0) {
        _platforms[existing] = platform;
    } else {
        _platforms.push(platform);
    }
    invalidateHeightCache();
    syncPlatforms();
}

export function unregisterPlatform(id: string): void {
    const idx = _platforms.findIndex(p => p.id === id);
    if (idx >= 0) {
        _platforms.splice(idx, 1);
        invalidateHeightCache();
        syncPlatforms();
    }
}

export function getPlatforms(): readonly GroundPlatform[] {
    return _platforms;
}

export function clearPlatforms(): void {
    _platforms.length = 0;
    invalidateHeightCache();
    syncPlatforms();
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
 * Authoritative ground height at (x, z). Delegates to native unified query
 * (AS/C++) when available, else JS core fallback.
 */
export function getGroundHeight(x: number, z: number): number {
    ensureCacheConfig();
    const now = performance.now();
    return queryUnifiedGroundHeight(x, z, now, getWasmGroundHeight, _platforms);
}

/**
 * Batched ground-height lookup. Returns a new Float32Array of heights.
 */
export function getGroundHeightBatch(positions: Float32Array): Float32Array {
    const count = positions.length / 2;
    const out = new Float32Array(count);
    fillGroundHeightsBatch(positions, out, count);
    return out;
}

/**
 * Write authoritative ground heights into `out` without allocating.
 */
export function fillGroundHeightsBatch(positions: Float32Array, out: Float32Array, count: number): void {
    ensureCacheConfig();
    const now = performance.now();
    fillUnifiedGroundHeights(positions, out, count, now, getWasmGroundHeight, _platforms);
}

/** Which backend serves unified ground queries ('cpp' | 'as' | 'js'). */
export { isNativeUnifiedGroundReady, getUnifiedGroundBackend };

/**
 * Target first-person eye Y at (x, z): authoritative ground + configured eye offset.
 */
export function getEyeTargetY(x: number, z: number): number {
    return getGroundHeight(x, z) + CONFIG.player.eyeHeight;
}

export function invalidateHeightCache(): void {
    invalidateNativeGroundCache();
    invalidateFootprintCache();
}

export interface GroundedEyeReconcileOptions {
    isGrounded: boolean;
    velocityY: number;
}

/**
 * Reconcile player/camera Y with the authoritative ground surface.
 */
export function reconcileGroundedEyeY(
    currentY: number,
    x: number,
    z: number,
    delta: number,
    opts: GroundedEyeReconcileOptions
): number {
    const eyeY = getEyeTargetY(x, z);

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

export function unregisterWalkableCloudPlatform(cloud: THREE.Object3D): void {
    const id = typeof cloud.userData.persistentId === 'string'
        ? `cloud:${cloud.userData.persistentId}`
        : typeof cloud.userData.mapEntityId === 'string'
            ? `cloud:${cloud.userData.mapEntityId}`
            : `cloud:${cloud.position.x.toFixed(1)}_${cloud.position.z.toFixed(1)}_${cloud.position.y.toFixed(1)}`;
    unregisterPlatform(id);
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
// Footprint result cache
// -----------------------------------------------------------------------------

const FOOTPRINT_CACHE_SIZE = 64;
const EMPTY_KEY = Number.POSITIVE_INFINITY;

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

let _cacheTTL = 1.0;

function quantizeCoord(v: number): number {
    return Math.round(v * 100);
}

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
    _cacheTTL = CONFIG.ground.cacheTTL ?? 1.0;
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

const _fpBatchPositions = new Float32Array(20);
const _fpBatchHeights = new Float32Array(10);

/**
 * Sample a circular footprint around (x, z).
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

    const count = points + 1;
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
