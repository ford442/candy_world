#include <emscripten.h>
#include <cmath>
#include <cstdint>
#include <algorithm>

extern "C" float getUnifiedGroundHeight(float x, float z, double nowMs);
extern "C" float getGroundHeight(float x, float z); // From math.cpp ?

static constexpr int MAX_BOIDS = 256;
static constexpr int GRID_DIM = 32;
static constexpr float CELL_SIZE = 8.0f;
static constexpr float WORLD_MIN = -128.0f;
static constexpr float WORLD_MAX = 128.0f;
static constexpr int BOID_STRIDE = 8;

static constexpr float SEP_RADIUS_SQ = 4.0f;       // 2m
static constexpr float ALIGN_RADIUS_SQ = 25.0f;    // 5m
static constexpr float COH_RADIUS_SQ = 64.0f;      // 8m
static constexpr float PLAYER_AVOID_RADIUS_SQ = 100.0f; // 10m

static int32_t _gridHeads[GRID_DIM * GRID_DIM];
static int32_t _gridNext[MAX_BOIDS];

static inline int cellIndex(float x, float z) {
    int cx = static_cast<int>(std::floor((x - WORLD_MIN) / CELL_SIZE));
    int cz = static_cast<int>(std::floor((z - WORLD_MIN) / CELL_SIZE));
    if (cx < 0 || cx >= GRID_DIM || cz < 0 || cz >= GRID_DIM) return -1;
    return cz * GRID_DIM + cx;
}

static void rebuildGrid(float* boidsPtr, int count) {
    const int cells = GRID_DIM * GRID_DIM;
    for (int i = 0; i < cells; i++) {
        _gridHeads[i] = -1;
    }

    for (int i = 0; i < count; i++) {
        float x = boidsPtr[i * BOID_STRIDE + 0];
        float z = boidsPtr[i * BOID_STRIDE + 2];
        int idx = cellIndex(x, z);
        if (idx < 0) continue;
        _gridNext[i] = _gridHeads[idx];
        _gridHeads[idx] = i;
    }
}

static inline float distSq(float ax, float ay, float az, float bx, float by, float bz) {
    float dx = bx - ax;
    float dy = by - ay;
    float dz = bz - az;
    return dx * dx + dy * dy + dz * dz;
}

static inline float maxSpeedForSpecies(int species) {
    if (species == 1) return 3.5f; // hopper
    if (species == 2) return 2.0f; // moth
    return 1.8f; // beetle
}

static inline float groundOffsetForSpecies(int species) {
    if (species == 1) return 0.22f;
    if (species == 2) return 0.0f;
    return 0.14f;
}

static inline float applyGroundFollow(int species, float x, float z, float y, float time, float phase) {
    float ground = getGroundHeight(x, z);
    if (species == 2) {
        // Sugar moth — drift above terrain
        float bob = std::sin(time * 1.2f + phase) * 0.6f;
        return ground + 2.5f + bob;
    }
    if (species == 1) {
        // Jellybean hopper — periodic hop
        float hop = std::abs(std::sin(time * 4.0f + phase)) * 0.35f;
        return ground + groundOffsetForSpecies(species) + hop;
    }
    return ground + groundOffsetForSpecies(species);
}

extern "C" {
    EMSCRIPTEN_KEEPALIVE
    void _updateBoids_c(float* boidsPtr, int count, float dt, float playerX, float playerZ, float time) {
        if (count <= 0 || boidsPtr == nullptr) return;
        int n = count > MAX_BOIDS ? MAX_BOIDS : count;
        float clampedDt = std::max(0.0f, std::min(dt, 0.1f));

        rebuildGrid(boidsPtr, n);

        for (int i = 0; i < n; i++) {
            float* base = boidsPtr + (i * BOID_STRIDE);
            float x = base[0];
            float y = base[1];
            float z = base[2];
            float vx = base[3];
            float vy = base[4];
            float vz = base[5];
            float phase = base[6];
            int species = static_cast<int>(base[7]);

            float sepX = 0.0f, sepY = 0.0f, sepZ = 0.0f;
            float aliX = 0.0f, aliY = 0.0f, aliZ = 0.0f;
            float cohX = 0.0f, cohY = 0.0f, cohZ = 0.0f;
            int aliCount = 0;
            int cohCount = 0;

            int homeCell = cellIndex(x, z);
            if (homeCell >= 0) {
                int cx0 = homeCell % GRID_DIM;
                int cz0 = homeCell / GRID_DIM;

                for (int dz = -1; dz <= 1; dz++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        int cx = cx0 + dx;
                        int cz = cz0 + dz;
                        if (cx < 0 || cx >= GRID_DIM || cz < 0 || cz >= GRID_DIM) continue;
                        int cell = cz * GRID_DIM + cx;
                        int j = _gridHeads[cell];
                        while (j >= 0) {
                            if (j != i) {
                                float* ob = boidsPtr + (j * BOID_STRIDE);
                                float ox = ob[0];
                                float oy = ob[1];
                                float oz = ob[2];
                                float ovx = ob[3];
                                float ovy = ob[4];
                                float ovz = ob[5];
                                float d2 = distSq(x, y, z, ox, oy, oz);

                                if (d2 < SEP_RADIUS_SQ && d2 > 0.0001f) {
                                    float inv = 1.0f / d2;
                                    sepX += (x - ox) * inv;
                                    sepY += (y - oy) * inv;
                                    sepZ += (z - oz) * inv;
                                }
                                if (d2 < ALIGN_RADIUS_SQ) {
                                    aliX += ovx;
                                    aliY += ovy;
                                    aliZ += ovz;
                                    aliCount++;
                                }
                                if (d2 < COH_RADIUS_SQ) {
                                    cohX += ox;
                                    cohY += oy;
                                    cohZ += oz;
                                    cohCount++;
                                }
                            }
                            j = _gridNext[j];
                        }
                    }
                }
            }

            // Player avoidance
            float pdx = x - playerX;
            float pdz = z - playerZ;
            float pd2 = pdx * pdx + pdz * pdz;
            if (pd2 < PLAYER_AVOID_RADIUS_SQ && pd2 > 0.01f) {
                float push = (1.0f - pd2 / PLAYER_AVOID_RADIUS_SQ) * 4.0f;
                sepX += (pdx / pd2) * push;
                sepZ += (pdz / pd2) * push;
            }

            // Wander noise
            float wanderX = std::sin(time * 0.7f + phase * 3.1f) * 0.4f;
            float wanderZ = std::cos(time * 0.6f + phase * 2.7f) * 0.4f;

            float ax = sepX * 2.5f + wanderX;
            float ay = sepY * 1.0f;
            float az = sepZ * 2.5f + wanderZ;

            if (aliCount > 0) {
                float inv = 1.0f / (float)aliCount;
                ax += (aliX * inv - vx) * 0.5f;
                ay += (aliY * inv - vy) * 0.3f;
                az += (aliZ * inv - vz) * 0.5f;
            }
            if (cohCount > 0) {
                float inv = 1.0f / (float)cohCount;
                ax += (cohX * inv - x) * 0.15f;
                ay += (cohY * inv - y) * 0.05f;
                az += (cohZ * inv - z) * 0.15f;
            }

            vx += ax * clampedDt;
            vy += ay * clampedDt;
            vz += az * clampedDt;

            float damp = 0.92f;
            vx *= damp;
            vy *= damp;
            vz *= damp;

            float maxSpd = maxSpeedForSpecies(species);
            float spd2 = vx * vx + vy * vy + vz * vz;
            if (spd2 > maxSpd * maxSpd) {
                float scale = maxSpd / std::sqrt(spd2);
                vx *= scale;
                vy *= scale;
                vz *= scale;
            }

            x += vx * clampedDt;
            z += vz * clampedDt;

            // World bounds — soft bounce
            if (x < WORLD_MIN) { x = WORLD_MIN; vx = std::abs(vx); }
            if (x > WORLD_MAX) { x = WORLD_MAX; vx = -std::abs(vx); }
            if (z < WORLD_MIN) { z = WORLD_MIN; vz = std::abs(vz); }
            if (z > WORLD_MAX) { z = WORLD_MAX; vz = -std::abs(vz); }

            y = applyGroundFollow(species, x, z, y, time, phase);
            if (species != 2) {
                vy *= 0.5f;
            }

            base[0] = x;
            base[1] = y;
            base[2] = z;
            base[3] = vx;
            base[4] = vy;
            base[5] = vz;
        }
    }
}
