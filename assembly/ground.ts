/**
 * Unified ground-height query (terrain + platforms + lake/island + cache).
 * Hot-path companion to src/systems/ground-height-core.ts — keep logic in sync.
 */

import { getGroundHeight } from "./math";
import { lerp } from "./math";

// -----------------------------------------------------------------------------
// Lake / island constants (mirror ground-system.ts)
// -----------------------------------------------------------------------------

const LAKE_MIN_X: f32 = -38.0;
const LAKE_MAX_X: f32 = 78.0;
const LAKE_MIN_Z: f32 = -28.0;
const LAKE_MAX_Z: f32 = 68.0;
const LAKE_BOTTOM: f32 = -2.0;

const ISLAND_CENTER_X: f32 = 20.0;
const ISLAND_CENTER_Z: f32 = 20.0;
const ISLAND_RADIUS: f32 = 12.0;
const ISLAND_RADIUS_SQ: f32 = ISLAND_RADIUS * ISLAND_RADIUS;
const ISLAND_PEAK: f32 = 3.0;
const ISLAND_FALLOFF: f32 = 4.0;
const ISLAND_ENABLED: i32 = 1;
const WATER_LEVEL: f32 = 1.5;

// -----------------------------------------------------------------------------
// Walkable platform registry (axis-aligned tops)
// -----------------------------------------------------------------------------

const MAX_PLATFORMS: i32 = 64;
const PLATFORM_STRIDE: i32 = 5; // minX, maxX, minZ, maxZ, maxY

// @ts-ignore StaticArray
const _platformData = new StaticArray<f32>(MAX_PLATFORMS * PLATFORM_STRIDE);
let _platformCount: i32 = 0;

// -----------------------------------------------------------------------------
// Fixed-size exact-position height cache (256 open-addressing slots)
// -----------------------------------------------------------------------------

const CACHE_SLOTS: i32 = 256;
const CACHE_STRIDE: i32 = 4; // qx, qz, height, timestamp
const EMPTY_KEY: f64 = 1.0e300;

// @ts-ignore StaticArray
const _cache = new StaticArray<f64>(CACHE_SLOTS * CACHE_STRIDE);
let _cacheInitialized: i32 = 0;
let _lastPurge: f64 = 0.0;
let _cacheTTLMs: f64 = 1000.0;

function ensureCacheInit(): void {
  if (_cacheInitialized != 0) return;
  for (let i: i32 = 0; i < CACHE_SLOTS * CACHE_STRIDE; i++) {
    _cache[i] = EMPTY_KEY;
  }
  _cacheInitialized = 1;
}

function quantizeCoord(v: f32): i32 {
  return i32(Mathf.round(v * 100.0));
}

function hashSlot(qx: i32, qz: i32): i32 {
  let h: i32 = qx * 73856093;
  h ^= qz * 19349663;
  // unsigned shift equivalent
  h = h ^ (h >> 16);
  if (h < 0) h = -h;
  return h % CACHE_SLOTS;
}

function cacheWrite(slot: i32, qx: f64, qz: f64, height: f64, time: f64): void {
  const off = slot * CACHE_STRIDE;
  _cache[off] = qx;
  _cache[off + 1] = qz;
  _cache[off + 2] = height;
  _cache[off + 3] = time;
}

function lookupCachedHeight(qx: i32, qz: i32, now: f64): f32 {
  ensureCacheInit();
  const qxF: f64 = f64(qx);
  const qzF: f64 = f64(qz);
  let slot: i32 = hashSlot(qx, qz);
  for (let probe: i32 = 0; probe < CACHE_SLOTS; probe++) {
    const off = slot * CACHE_STRIDE;
    const kx = _cache[off];
    if (kx == EMPTY_KEY) return -1.0e30; // miss sentinel
    if (i32(kx) == qx && i32(_cache[off + 1]) == qz) {
      const age = now - _cache[off + 3];
      if (age <= _cacheTTLMs) return <f32>_cache[off + 2];
      cacheWrite(slot, EMPTY_KEY, EMPTY_KEY, 0.0, 0.0);
      return -1.0e30;
    }
    slot = (slot + 1) % CACHE_SLOTS;
  }
  return -1.0e30;
}

function storeCachedHeight(qx: i32, qz: i32, height: f32, now: f64): void {
  const qxF: f64 = f64(qx);
  const qzF: f64 = f64(qz);
  let slot: i32 = hashSlot(qx, qz);
  for (let probe: i32 = 0; probe < CACHE_SLOTS; probe++) {
    const off = slot * CACHE_STRIDE;
    const kx = _cache[off];
    if (kx == EMPTY_KEY || (i32(kx) == qx && i32(_cache[off + 1]) == qz)) {
      cacheWrite(slot, qxF, qzF, f64(height), now);
      return;
    }
    slot = (slot + 1) % CACHE_SLOTS;
  }
  cacheWrite(slot, qxF, qzF, f64(height), now);

  if (now - _lastPurge > 1000.0) {
    purgeStaleCacheEntries(now);
    _lastPurge = now;
  }
}

function purgeStaleCacheEntries(now: f64): void {
  for (let slot: i32 = 0; slot < CACHE_SLOTS; slot++) {
    const off = slot * CACHE_STRIDE;
    const kx = _cache[off];
    if (kx != EMPTY_KEY && now - _cache[off + 3] > _cacheTTLMs) {
      cacheWrite(slot, EMPTY_KEY, EMPTY_KEY, 0.0, 0.0);
    }
  }
}

// -----------------------------------------------------------------------------
// Modifiers
// -----------------------------------------------------------------------------

function applyPlatformOverride(x: f32, z: f32, terrainHeight: f32): f32 {
  let bestHeight: f32 = terrainHeight;
  for (let i: i32 = 0; i < _platformCount; i++) {
    const base = i * PLATFORM_STRIDE;
    const minX = _platformData[base];
    const maxX = _platformData[base + 1];
    const minZ = _platformData[base + 2];
    const maxZ = _platformData[base + 3];
    const maxY = _platformData[base + 4];
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    if (maxY > bestHeight) bestHeight = maxY;
  }
  return bestHeight;
}

function applyLakeModifiers(x: f32, z: f32, height: f32): f32 {
  if (x <= LAKE_MIN_X || x >= LAKE_MAX_X || z <= LAKE_MIN_Z || z >= LAKE_MAX_Z) {
    return height;
  }

  if (ISLAND_ENABLED != 0) {
    const dx = x - ISLAND_CENTER_X;
    const dz = z - ISLAND_CENTER_Z;
    const distSq = dx * dx + dz * dz;
    if (distSq < ISLAND_RADIUS_SQ) {
      const dist = Mathf.sqrt(distSq);
      const normalizedDist = dist / ISLAND_RADIUS;
      const islandHeight = ISLAND_PEAK * Mathf.cos(normalizedDist * <f32>(Mathf.PI / 2.0));
      const edgeDist = ISLAND_RADIUS - dist;
      const edgeBlend = Mathf.min(1.0, edgeDist / ISLAND_FALLOFF);
      const finalIslandHeight = WATER_LEVEL + islandHeight * edgeBlend;
      return Mathf.max(height, finalIslandHeight);
    }
  }

  const distX = Mathf.min(x - LAKE_MIN_X, LAKE_MAX_X - x);
  const distZ = Mathf.min(z - LAKE_MIN_Z, LAKE_MAX_Z - z);
  const distEdge = Mathf.min(distX, distZ);
  const blend = Mathf.min(1.0, distEdge / 10.0);
  const targetHeight = lerp(height, LAKE_BOTTOM, blend);
  return targetHeight < height ? targetHeight : height;
}

// -----------------------------------------------------------------------------
// Public exports
// -----------------------------------------------------------------------------

/** Clear all registered walkable platforms. */
export function clearGroundPlatforms(): void {
  _platformCount = 0;
}

/** Register one axis-aligned walkable platform top surface. */
export function addGroundPlatform(
  minX: f32,
  maxX: f32,
  minZ: f32,
  maxZ: f32,
  maxY: f32
): void {
  if (_platformCount >= MAX_PLATFORMS) return;
  const base = _platformCount * PLATFORM_STRIDE;
  _platformData[base] = minX;
  _platformData[base + 1] = maxX;
  _platformData[base + 2] = minZ;
  _platformData[base + 3] = maxZ;
  _platformData[base + 4] = maxY;
  _platformCount++;
}

/** Sync cache TTL from CONFIG.ground.cacheTTL (seconds). */
export function setGroundCacheTTL(seconds: f32): void {
  _cacheTTLMs = f64(seconds) * 1000.0;
}

/** Invalidate the native height cache (call when platforms change). */
export function invalidateGroundCache(): void {
  ensureCacheInit();
  for (let i: i32 = 0; i < CACHE_SLOTS * CACHE_STRIDE; i++) {
    _cache[i] = EMPTY_KEY;
  }
  _lastPurge = 0.0;
}

/**
 * Authoritative unified ground height at (x, z).
 * @param nowMs - performance.now() from JS (cache TTL)
 */
export function getUnifiedGroundHeight(x: f32, z: f32, nowMs: f64): f32 {
  const qx = quantizeCoord(x);
  const qz = quantizeCoord(z);
  const cached = lookupCachedHeight(qx, qz, nowMs);
  if (cached > -1.0e29) return cached;

  const terrainHeight = getGroundHeight(x, z);
  let height = applyPlatformOverride(x, z, terrainHeight);
  height = applyLakeModifiers(x, z, height);

  storeCachedHeight(qx, qz, height, nowMs);
  return height;
}

/**
 * Batch unified ground height.
 * positions: [x0,z0,x1,z1,...], output: [y0,y1,...]
 */
export function batchUnifiedGroundHeight(
  positionsPtr: usize,
  count: i32,
  outputPtr: usize,
  nowMs: f64
): void {
  for (let i: i32 = 0; i < count; i++) {
    const posBase = positionsPtr + (<usize>i << 3);
    const x = load<f32>(posBase);
    const z = load<f32>(posBase + 4);
    const y = getUnifiedGroundHeight(x, z, nowMs);
    store<f32>(outputPtr + (<usize>i << 2), y);
  }
}
