/**
 * Unified ground-height query (terrain + platforms + lake/island + cache).
 * Mirrors assembly/ground.ts and src/systems/ground-height-core.ts.
 */
#include <emscripten.h>
#include <cmath>
#include <cstdint>

extern "C" float getGroundHeight(float x, float z);
extern "C" void batchGroundHeight_simd(float* positions, int count, float* output);

// -----------------------------------------------------------------------------
// Lake / island constants
// -----------------------------------------------------------------------------

static constexpr float LAKE_MIN_X = -38.0f;
static constexpr float LAKE_MAX_X = 78.0f;
static constexpr float LAKE_MIN_Z = -28.0f;
static constexpr float LAKE_MAX_Z = 68.0f;
static constexpr float LAKE_BOTTOM = -2.0f;

static constexpr float ISLAND_CENTER_X = 20.0f;
static constexpr float ISLAND_CENTER_Z = 20.0f;
static constexpr float ISLAND_RADIUS = 12.0f;
static constexpr float ISLAND_RADIUS_SQ = ISLAND_RADIUS * ISLAND_RADIUS;
static constexpr float ISLAND_PEAK = 3.0f;
static constexpr float ISLAND_FALLOFF = 4.0f;
static constexpr int ISLAND_ENABLED = 1;
static constexpr float WATER_LEVEL = 1.5f;

// -----------------------------------------------------------------------------
// Platform registry
// -----------------------------------------------------------------------------

static constexpr int MAX_PLATFORMS = 64;
static constexpr int PLATFORM_STRIDE = 5;

static float _platformData[MAX_PLATFORMS * PLATFORM_STRIDE];
static int _platformCount = 0;

// -----------------------------------------------------------------------------
// Height cache
// -----------------------------------------------------------------------------

static constexpr int CACHE_SLOTS = 256;
static constexpr int CACHE_STRIDE = 4;
static constexpr double EMPTY_KEY = 1.0e300;
static constexpr double CACHE_TTL_MS = 1000.0;

static double _cache[CACHE_SLOTS * CACHE_STRIDE];
static int _cacheInitialized = 0;
static double _lastPurge = 0.0;

static inline void ensureCacheInit() {
    if (_cacheInitialized) return;
    for (int i = 0; i < CACHE_SLOTS * CACHE_STRIDE; i++) {
        _cache[i] = EMPTY_KEY;
    }
    _cacheInitialized = 1;
}

static inline int quantizeCoord(float v) {
    return (int)roundf(v * 100.0f);
}

static inline int hashSlot(int qx, int qz) {
    int h = qx * 73856093;
    h ^= qz * 19349663;
    h ^= (unsigned)h >> 16;
    if (h < 0) h = -h;
    return h % CACHE_SLOTS;
}

static inline void cacheWrite(int slot, double qx, double qz, double height, double time) {
    int off = slot * CACHE_STRIDE;
    _cache[off] = qx;
    _cache[off + 1] = qz;
    _cache[off + 2] = height;
    _cache[off + 3] = time;
}

static bool lookupCachedHeight(int qx, int qz, double now, float& outHeight) {
    ensureCacheInit();
    int slot = hashSlot(qx, qz);
    for (int probe = 0; probe < CACHE_SLOTS; probe++) {
        int off = slot * CACHE_STRIDE;
        double kx = _cache[off];
        if (kx == EMPTY_KEY) return false;
        if ((int)kx == qx && (int)_cache[off + 1] == qz) {
            if (now - _cache[off + 3] <= CACHE_TTL_MS) {
                outHeight = (float)_cache[off + 2];
                return true;
            }
            cacheWrite(slot, EMPTY_KEY, EMPTY_KEY, 0.0, 0.0);
            return false;
        }
        slot = (slot + 1) % CACHE_SLOTS;
    }
    return false;
}

static void storeCachedHeight(int qx, int qz, float height, double now) {
    int slot = hashSlot(qx, qz);
    for (int probe = 0; probe < CACHE_SLOTS; probe++) {
        int off = slot * CACHE_STRIDE;
        double kx = _cache[off];
        if (kx == EMPTY_KEY || ((int)kx == qx && (int)_cache[off + 1] == qz)) {
            cacheWrite(slot, (double)qx, (double)qz, (double)height, now);
            return;
        }
        slot = (slot + 1) % CACHE_SLOTS;
    }
    cacheWrite(slot, (double)qx, (double)qz, (double)height, now);

    if (now - _lastPurge > 1000.0) {
        for (int s = 0; s < CACHE_SLOTS; s++) {
            int off = s * CACHE_STRIDE;
            if (_cache[off] != EMPTY_KEY && now - _cache[off + 3] > CACHE_TTL_MS) {
                cacheWrite(s, EMPTY_KEY, EMPTY_KEY, 0.0, 0.0);
            }
        }
        _lastPurge = now;
    }
}

static float applyPlatformOverride(float x, float z, float terrainHeight) {
    float bestHeight = terrainHeight;
    for (int i = 0; i < _platformCount; i++) {
        int base = i * PLATFORM_STRIDE;
        float minX = _platformData[base];
        float maxX = _platformData[base + 1];
        float minZ = _platformData[base + 2];
        float maxZ = _platformData[base + 3];
        float maxY = _platformData[base + 4];
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
        if (maxY > bestHeight) bestHeight = maxY;
    }
    return bestHeight;
}

static float applyLakeModifiers(float x, float z, float height) {
    if (x <= LAKE_MIN_X || x >= LAKE_MAX_X || z <= LAKE_MIN_Z || z >= LAKE_MAX_Z) {
        return height;
    }

    if (ISLAND_ENABLED) {
        float dx = x - ISLAND_CENTER_X;
        float dz = z - ISLAND_CENTER_Z;
        float distSq = dx * dx + dz * dz;
        if (distSq < ISLAND_RADIUS_SQ) {
            float dist = sqrtf(distSq);
            float normalizedDist = dist / ISLAND_RADIUS;
            float islandHeight = ISLAND_PEAK * cosf(normalizedDist * (float)(M_PI / 2.0));
            float edgeDist = ISLAND_RADIUS - dist;
            float edgeBlend = fminf(1.0f, edgeDist / ISLAND_FALLOFF);
            float finalIslandHeight = WATER_LEVEL + islandHeight * edgeBlend;
            return fmaxf(height, finalIslandHeight);
        }
    }

    float distX = fminf(x - LAKE_MIN_X, LAKE_MAX_X - x);
    float distZ = fminf(z - LAKE_MIN_Z, LAKE_MAX_Z - z);
    float distEdge = fminf(distX, distZ);
    float blend = fminf(1.0f, distEdge / 10.0f);
    float targetHeight = height + (LAKE_BOTTOM - height) * blend;
    return targetHeight < height ? targetHeight : height;
}

static float unifiedFromTerrain(float x, float z, float terrainHeight, double nowMs) {
    int qx = quantizeCoord(x);
    int qz = quantizeCoord(z);
    float cached;
    if (lookupCachedHeight(qx, qz, nowMs, cached)) return cached;

    float height = applyPlatformOverride(x, z, terrainHeight);
    height = applyLakeModifiers(x, z, height);
    storeCachedHeight(qx, qz, height, nowMs);
    return height;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
void clearGroundPlatforms() {
    _platformCount = 0;
}

EMSCRIPTEN_KEEPALIVE
void addGroundPlatform(float minX, float maxX, float minZ, float maxZ, float maxY) {
    if (_platformCount >= MAX_PLATFORMS) return;
    int base = _platformCount * PLATFORM_STRIDE;
    _platformData[base] = minX;
    _platformData[base + 1] = maxX;
    _platformData[base + 2] = minZ;
    _platformData[base + 3] = maxZ;
    _platformData[base + 4] = maxY;
    _platformCount++;
}

EMSCRIPTEN_KEEPALIVE
void invalidateGroundCache() {
    ensureCacheInit();
    for (int i = 0; i < CACHE_SLOTS * CACHE_STRIDE; i++) {
        _cache[i] = EMPTY_KEY;
    }
    _lastPurge = 0.0;
}

EMSCRIPTEN_KEEPALIVE
float getUnifiedGroundHeight(float x, float z, double nowMs) {
    float terrain = getGroundHeight(x, z);
    return unifiedFromTerrain(x, z, terrain, nowMs);
}

EMSCRIPTEN_KEEPALIVE
void batchUnifiedGroundHeight(float* positions, int count, float* output, double nowMs) {
    // SIMD terrain pass, then per-point modifiers + cache
    batchGroundHeight_simd(positions, count, output);
    for (int i = 0; i < count; i++) {
        float x = positions[i * 2];
        float z = positions[i * 2 + 1];
        output[i] = unifiedFromTerrain(x, z, output[i], nowMs);
    }
}

}  // extern "C"
