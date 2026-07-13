/**
 * @file particle_physics.cpp
 * @brief WASM particle physics implementation for Candy World
 * 
 * High-performance particle physics computed on CPU via WebAssembly.
 * Designed for compute particle systems when GPU compute isn't available
 * or for offloading certain hot loops from the main thread.
 * 
 * Features:
 * - SIMD-optimized particle updates (when available)
 * - OpenMP parallelization for multi-threaded builds
 * - Audio-reactive physics
 * - Automatic particle respawning with time-based variation
 */

#include <emscripten.h>
#include <cmath>
#include <cstdint>
#include "particle_physics.h"

// Simple xorshift random number generator
static uint32_t randState = 12345;

// Global time accumulator for respawn variation
static float globalTime = 0.0f;

inline float randFloat() {
    randState ^= randState << 13;
    randState ^= randState >> 17;
    randState ^= randState << 5;
    return static_cast<float>(randState) / static_cast<float>(0xFFFFFFFF);
}

inline float randRange(float min, float max) {
    return min + randFloat() * (max - min);
}

// World bounds — keep in sync with assembly/constants.ts and tests/wasm.mjs
static constexpr float WORLD_MIN_X = -128.0f;
static constexpr float WORLD_MAX_X = 128.0f;
static constexpr float WORLD_MIN_Y = -100.0f;
static constexpr float WORLD_MAX_Y = 500.0f;
static constexpr float WORLD_MIN_Z = -128.0f;
static constexpr float WORLD_MAX_Z = 128.0f;

enum CpuParticleType : int {
    CPU_FIREFLIES = 0,
    CPU_POLLEN = 1,
    CPU_BERRIES = 2,
    CPU_RAIN = 3,
    CPU_SPARKS = 4,
    CPU_GEM_SPARKS = 5
};

inline float particleRand(int i, uint32_t salt) {
    uint32_t s = randState ^ static_cast<uint32_t>(i) * 747796405u ^ salt;
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return static_cast<float>(s) / static_cast<float>(0xFFFFFFFF);
}

inline float wrapAxis(float pos, float center, float extent) {
    const float half = extent * 0.5f;
    float rel = pos - center;
    if (rel > half) rel -= extent;
    else if (rel < -half) rel += extent;
    return center + rel;
}

inline bool isOutOfWorldBounds(float px, float py, float pz) {
    return px < WORLD_MIN_X || px > WORLD_MAX_X ||
           py < WORLD_MIN_Y || py > WORLD_MAX_Y ||
           pz < WORLD_MIN_Z || pz > WORLD_MAX_Z;
}

static void setParticleColor(
    int type,
    float* colors,
    const float* seeds,
    int i
) {
    const int idx = i * 4;
    switch (type) {
        case CPU_FIREFLIES:
            colors[idx] = 0.88f; colors[idx + 1] = 1.0f;
            colors[idx + 2] = 0.0f; colors[idx + 3] = 1.0f;
            break;
        case CPU_POLLEN:
            colors[idx] = 0.0f; colors[idx + 1] = 1.0f;
            colors[idx + 2] = 1.0f; colors[idx + 3] = 0.8f;
            break;
        case CPU_BERRIES:
            colors[idx] = 1.0f; colors[idx + 1] = 0.4f;
            colors[idx + 2] = 0.0f; colors[idx + 3] = 1.0f;
            break;
        case CPU_RAIN:
            colors[idx] = 0.6f; colors[idx + 1] = 0.8f;
            colors[idx + 2] = 1.0f; colors[idx + 3] = 0.5f;
            break;
        case CPU_SPARKS:
            colors[idx] = 1.0f; colors[idx + 1] = 1.0f;
            colors[idx + 2] = 0.5f; colors[idx + 3] = 1.0f;
            break;
        case CPU_GEM_SPARKS: {
            const float huePick = sinf(seeds[i] * 12.9898f) * 0.5f + 0.5f;
            const float ruby0 = 0.88f, ruby1 = 0.07f, ruby2 = 0.37f;
            const float sapphire0 = 0.06f, sapphire2 = 0.73f;
            const float amethyst1 = 0.40f, amethyst2 = 0.80f;
            colors[idx] = ruby0 * (1.0f - huePick) + sapphire0 * huePick;
            colors[idx + 1] = ruby1 * (1.0f - huePick) + amethyst1 * huePick * huePick;
            colors[idx + 2] = ruby2 * (1.0f - huePick) + amethyst2 * huePick;
            colors[idx + 3] = 0.85f;
            break;
        }
    }
}

static void respawnCpuParticle(
    int i,
    int type,
    float* positions,
    float* velocities,
    float* lives,
    float* sizes,
    float* colors,
    float* seeds,
    float centerX, float centerY, float centerZ,
    float boundsX, float boundsY, float boundsZ,
    float sizeMin, float sizeMax,
    bool initial
) {
    const int idx = i * 3;
    const float r0 = particleRand(i, 0xA2C39Au);
    const float r1 = particleRand(i, 0xB3D4ABu);
    const float r2 = particleRand(i, 0xC4E5BCu);
    const float r3 = particleRand(i, 0xD5F6CDu);

    positions[idx] = (r0 - 0.5f) * boundsX + centerX;
    positions[idx + 1] = initial
        ? r1 * boundsY + centerY
        : centerY + boundsY;
    positions[idx + 2] = (r2 - 0.5f) * boundsZ + centerZ;

    switch (type) {
        case CPU_FIREFLIES:
            velocities[idx] = (particleRand(i, 1) - 0.5f) * 2.0f;
            velocities[idx + 1] = (particleRand(i, 2) - 0.5f) * 0.5f;
            velocities[idx + 2] = (particleRand(i, 3) - 0.5f) * 2.0f;
            lives[i] = 2.0f + particleRand(i, 4) * 4.0f;
            break;
        case CPU_POLLEN:
            velocities[idx] = (particleRand(i, 5) - 0.5f) * 0.5f;
            velocities[idx + 1] = (particleRand(i, 6) - 0.5f) * 0.2f;
            velocities[idx + 2] = (particleRand(i, 7) - 0.5f) * 0.5f;
            lives[i] = 2.0f + particleRand(i, 8) * 4.0f;
            break;
        case CPU_BERRIES:
            velocities[idx] = (particleRand(i, 9) - 0.5f) * 3.0f;
            velocities[idx + 1] = particleRand(i, 10) * 2.0f;
            velocities[idx + 2] = (particleRand(i, 11) - 0.5f) * 3.0f;
            lives[i] = 3.0f + particleRand(i, 12) * 5.0f;
            break;
        case CPU_RAIN:
            velocities[idx] = (particleRand(i, 13) - 0.5f) * 0.5f;
            velocities[idx + 1] = -5.0f - particleRand(i, 14) * 3.0f;
            velocities[idx + 2] = (particleRand(i, 15) - 0.5f) * 0.5f;
            lives[i] = 5.0f;
            break;
        case CPU_SPARKS: {
            const float angle = particleRand(i, 16) * 6.2831853f;
            const float speed = 3.0f + particleRand(i, 17) * 5.0f;
            velocities[idx] = cosf(angle) * speed;
            velocities[idx + 1] = particleRand(i, 18) * speed;
            velocities[idx + 2] = sinf(angle) * speed;
            lives[i] = 0.3f + particleRand(i, 19) * 0.5f;
            break;
        }
        case CPU_GEM_SPARKS:
            velocities[idx] = (particleRand(i, 20) - 0.5f) * 0.12f;
            velocities[idx + 1] = (particleRand(i, 21) - 0.5f) * 0.06f;
            velocities[idx + 2] = (particleRand(i, 22) - 0.5f) * 0.12f;
            lives[i] = 10.0f + particleRand(i, 23) * 14.0f;
            break;
    }

    sizes[i] = sizeMin + r3 * (sizeMax - sizeMin);
    seeds[i] = r0 * 1000.0f;
    setParticleColor(type, colors, seeds, i);
}

static void updateFirefly(
    int i, float dt,
    float* positions, float* velocities, const float* seeds,
    float centerX, float centerZ,
    float playerX, float playerY, float playerZ,
    float audioLow, float timeOffsetFirefly
) {
    const int idx = i * 3;
    float px = positions[idx];
    float py = positions[idx + 1];
    float pz = positions[idx + 2];
    float vx = velocities[idx];
    float vy = velocities[idx + 1];
    float vz = velocities[idx + 2];

    const float noiseX = sinf(px * 0.1f + seeds[i]) * timeOffsetFirefly;
    const float noiseY = sinf(py * 0.1f + seeds[i] + 10.0f) * timeOffsetFirefly;
    const float noiseZ = sinf(pz * 0.1f + seeds[i] + 20.0f) * timeOffsetFirefly;

    const float springX = (centerX - px) * 0.5f;
    const float springZ = (centerZ - pz) * 0.5f;

    const float toPlayerX = px - playerX;
    const float toPlayerY = py - playerY;
    const float toPlayerZ = pz - playerZ;
    const float distToPlayerSq = toPlayerX * toPlayerX + toPlayerY * toPlayerY + toPlayerZ * toPlayerZ;

    float repelX = 0.0f, repelY = 0.0f, repelZ = 0.0f;
    if (distToPlayerSq < 25.0f && distToPlayerSq > 0.0001f) {
        const float inv = 1.0f / distToPlayerSq;
        const float strength = (25.0f - distToPlayerSq) * 2.0f;
        repelX = toPlayerX * inv * strength;
        repelY = toPlayerY * inv * strength;
        repelZ = toPlayerZ * inv * strength;
    }

    vx += (noiseX * 2.0f + springX + repelX + audioLow * 5.0f) * dt;
    vy += (noiseY * 2.0f + repelY) * dt;
    vz += (noiseZ * 2.0f + springZ + repelZ) * dt;

    vx *= 0.95f; vy *= 0.95f; vz *= 0.95f;

    px += vx * dt; py += vy * dt; pz += vz * dt;

    if (py < 0.5f) {
        py = 0.5f;
        vy = fabsf(vy) * 0.3f;
    }

    positions[idx] = px; positions[idx + 1] = py; positions[idx + 2] = pz;
    velocities[idx] = vx; velocities[idx + 1] = vy; velocities[idx + 2] = vz;
}

static void updatePollen(
    int i, float dt,
    float* positions, float* velocities,
    float centerX, float centerZ,
    float playerX, float playerZ,
    float audioLow, float windX, float windZ, float timeOffsetPollen
) {
    const int idx = i * 3;
    float px = positions[idx];
    float py = positions[idx + 1];
    float pz = positions[idx + 2];
    float vx = velocities[idx];
    float vy = velocities[idx + 1];
    float vz = velocities[idx + 2];

    vx += windX * 0.05f * dt;
    vz += windZ * 0.05f * dt;

    const float noiseScale = 0.2f;
    const float noiseX = sinf(px * noiseScale + timeOffsetPollen);
    const float noiseY = sinf(py * noiseScale + timeOffsetPollen + 10.0f);
    const float noiseZ = sinf(pz * noiseScale + timeOffsetPollen + 20.0f);

    const float toPlayerX = px - playerX;
    const float toPlayerZ = pz - playerZ;
    const float distToPlayerSq = toPlayerX * toPlayerX + toPlayerZ * toPlayerZ;

    float repelX = 0.0f, repelZ = 0.0f;
    if (distToPlayerSq < 25.0f && distToPlayerSq > 0.0001f) {
        const float inv = 1.0f / distToPlayerSq;
        const float factor = (25.0f - distToPlayerSq) * 0.4f;
        repelX = toPlayerX * inv * factor;
        repelZ = toPlayerZ * inv * factor;
    }

    const float toCenterX = centerX - px;
    const float toCenterZ = centerZ - pz;
    const float distToCenterSq = toCenterX * toCenterX + toCenterZ * toCenterZ;

    float pullX = 0.0f, pullZ = 0.0f;
    if (distToCenterSq > 225.0f && distToCenterSq > 0.0001f) {
        const float inv = 1.0f / distToCenterSq;
        const float strength = (distToCenterSq - 225.0f) * 0.003f;
        pullX = toCenterX * inv * strength;
        pullZ = toCenterZ * inv * strength;
    }

    vx += (noiseX * 0.5f + audioLow * 2.0f + repelX + pullX) * dt;
    vy += noiseY * 0.5f * dt;
    vz += (noiseZ * 0.5f + audioLow * 2.0f + repelZ + pullZ) * dt;

    vx *= 0.98f; vy *= 0.98f; vz *= 0.98f;

    px += vx * dt; py += vy * dt; pz += vz * dt;

    if (py < 1.8f) {
        py = 1.8f;
        vy = fabsf(vy) * 0.3f;
    }

    positions[idx] = px; positions[idx + 1] = py; positions[idx + 2] = pz;
    velocities[idx] = vx; velocities[idx + 1] = vy; velocities[idx + 2] = vz;
}

static void updateBerry(int i, float dt, float* positions, float* velocities) {
    const int idx = i * 3;
    velocities[idx + 1] -= 9.8f * dt;
    positions[idx] += velocities[idx] * dt;
    positions[idx + 1] += velocities[idx + 1] * dt;
    positions[idx + 2] += velocities[idx + 2] * dt;

    if (positions[idx + 1] < 0.3f) {
        positions[idx + 1] = 0.3f;
        velocities[idx + 1] = fabsf(velocities[idx + 1]) * 0.5f;
        velocities[idx] *= 0.8f;
        velocities[idx + 2] *= 0.8f;
    }
}

static void updateRain(int i, float dt, float* positions, float* velocities, float* lives,
                       float windX, float windZ) {
    const int idx = i * 3;
    velocities[idx] = windX * 0.1f;
    velocities[idx + 2] = windZ * 0.1f;
    positions[idx] += velocities[idx] * dt;
    positions[idx + 1] += velocities[idx + 1] * dt;
    positions[idx + 2] += velocities[idx + 2] * dt;
    if (positions[idx + 1] < 0.5f) {
        lives[i] = 0.0f;
    }
}

static void updateSpark(int i, float dt, float* positions, float* velocities) {
    const int idx = i * 3;
    velocities[idx + 1] -= 4.9f * dt;
    velocities[idx] *= 0.99f;
    velocities[idx + 1] *= 0.99f;
    velocities[idx + 2] *= 0.99f;
    positions[idx] += velocities[idx] * dt;
    positions[idx + 1] += velocities[idx + 1] * dt;
    positions[idx + 2] += velocities[idx + 2] * dt;
}

static void updateGemSpark(
    int i, float dt,
    float* positions, float* velocities, const float* seeds,
    float centerX, float centerY, float centerZ,
    float boundsX, float boundsY, float boundsZ,
    float audioHigh, float timeSec
) {
    const int idx = i * 3;
    const float seed = seeds[i];
    float vx = velocities[idx];
    float vy = velocities[idx + 1];
    float vz = velocities[idx + 2];

    const float noiseX = sinf(positions[idx] * 0.12f + timeSec * 0.11f + seed) * 0.35f;
    const float noiseY = sinf(positions[idx + 1] * 0.12f + timeSec * 0.07f + seed * 1.3f) * 0.2f;
    const float noiseZ = sinf(positions[idx + 2] * 0.12f + timeSec * 0.09f + seed * 0.7f) * 0.35f;
    const float bobY = sinf(timeSec * 0.85f + seed) * 0.14f;
    const float audioLift = audioHigh * 0.25f;

    vx += noiseX * 0.55f * dt;
    vy += (noiseY * 0.08f + bobY * 0.08f + audioLift) * dt;
    vz += noiseZ * 0.55f * dt;

    vx *= 0.92f; vy *= 0.92f; vz *= 0.92f;

    positions[idx] += vx * dt;
    positions[idx + 1] += vy * dt;
    positions[idx + 2] += vz * dt;

    positions[idx] = wrapAxis(positions[idx], centerX, boundsX);
    positions[idx + 1] = wrapAxis(positions[idx + 1], centerY, boundsY);
    positions[idx + 2] = wrapAxis(positions[idx + 2], centerZ, boundsZ);

    velocities[idx] = vx; velocities[idx + 1] = vy; velocities[idx + 2] = vz;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
void initParticleRandom(uint32_t seed) {
    randState = seed > 0 ? seed : 12345;
    globalTime = 0.0f;
}

EMSCRIPTEN_KEEPALIVE
int getParticlePhysicsVersion() {
    // Version 1.0
    return 100;
}

EMSCRIPTEN_KEEPALIVE
void updateParticlesWASM(
    float* positions,
    float* velocities,
    int count,
    float deltaTime,
    float gravityY,
    float audioPulse,
    float spawnX,
    float spawnY,
    float spawnZ
) {
    // Clamp delta time to prevent physics explosions
    if (deltaTime > 0.1f) deltaTime = 0.1f;
    
    // Accumulate global time for respawn variation
    globalTime += deltaTime;
    
    // Pre-compute constants
    const float gravityDt = gravityY * deltaTime;
    const float audioBoost = 1.0f + audioPulse * 2.0f;
    const float decayRate = 0.3f * deltaTime;
    
    // Process particles in parallel when OpenMP is available
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < count; i++) {
        const int p4 = i * 4; // Position index (x, y, z, life)
        const int v4 = i * 4; // Velocity index (vx, vy, vz, speed)
        
        // Read current state
        float px = positions[p4];
        float py = positions[p4 + 1];
        float pz = positions[p4 + 2];
        float life = positions[p4 + 3];
        
        float vx = velocities[v4];
        float vy = velocities[v4 + 1];
        float vz = velocities[v4 + 2];
        float speed = velocities[v4 + 3];
        
        // Apply gravity
        vy += gravityDt;
        
        // Compute effective speed with audio boost
        const float effectiveSpeed = speed * audioBoost;
        
        // Update position
        px += vx * deltaTime * effectiveSpeed;
        py += vy * deltaTime * effectiveSpeed;
        pz += vz * deltaTime * effectiveSpeed;
        
        // Decay life
        life -= decayRate;
        
        // Respawn if dead
        if (life < 0.0f) {
            // Reset life
            life = 1.0f;
            
            // Respawn at center with time-varied offset
            // Use particle index AND global time for variation between respawns
            const float seed = static_cast<float>(i) * 0.123f + globalTime * 0.1f;
            const float offsetX = sinf(seed * 12.9898f) * 10.0f;
            const float offsetZ = cosf(seed * 78.233f) * 10.0f;
            
            px = spawnX + offsetX;
            py = spawnY;
            pz = spawnZ + offsetZ;
            
            // Reset velocity with time-varied upward burst
            const float velSeed = seed + static_cast<float>(i) * 0.456f;
            vy = 5.0f + cosf(velSeed) * 2.0f;
            vx = sinf(velSeed) * 2.0f;
            vz = cosf(velSeed * 1.5f) * 2.0f;
            speed = 1.0f;
        }
        
        // Write back
        positions[p4] = px;
        positions[p4 + 1] = py;
        positions[p4 + 2] = pz;
        positions[p4 + 3] = life;
        
        velocities[v4] = vx;
        velocities[v4 + 1] = vy;
        velocities[v4 + 2] = vz;
        velocities[v4 + 3] = speed;
    }
}

/**
 * Batch update matching src/particles/cpu-particle-simulate.ts layout:
 * positions [x,y,z]*count, velocities [vx,vy,vz]*count, lives, sizes, colors [rgba], seeds
 */
EMSCRIPTEN_KEEPALIVE
void updateCpuParticlesWASM(
    float* positions,
    float* velocities,
    float* lives,
    float* sizes,
    float* colors,
    float* seeds,
    int count,
    int particleType,
    float deltaTime,
    float centerX, float centerY, float centerZ,
    float boundsX, float boundsY, float boundsZ,
    float sizeMin, float sizeMax,
    float playerX, float playerY, float playerZ,
    float audioLow, float audioHigh,
    float windX, float windZ,
    float timeOffsetFirefly, float timeOffsetPollen, float timeSec
) {
    if (!positions || !velocities || !lives || count <= 0) return;
    if (deltaTime > 0.1f) deltaTime = 0.1f;

    #pragma omp parallel for schedule(static)
    for (int i = 0; i < count; i++) {
        lives[i] -= deltaTime;

        if (lives[i] <= 0.0f) {
            respawnCpuParticle(
                i, particleType,
                positions, velocities, lives, sizes, colors, seeds,
                centerX, centerY, centerZ,
                boundsX, boundsY, boundsZ,
                sizeMin, sizeMax,
                false
            );
            continue;
        }

        switch (particleType) {
            case CPU_FIREFLIES:
                updateFirefly(
                    i, deltaTime, positions, velocities, seeds,
                    centerX, centerZ, playerX, playerY, playerZ,
                    audioLow, timeOffsetFirefly
                );
                break;
            case CPU_POLLEN:
                updatePollen(
                    i, deltaTime, positions, velocities,
                    centerX, centerZ, playerX, playerZ,
                    audioLow, windX, windZ, timeOffsetPollen
                );
                break;
            case CPU_BERRIES:
                updateBerry(i, deltaTime, positions, velocities);
                break;
            case CPU_RAIN:
                updateRain(i, deltaTime, positions, velocities, lives, windX, windZ);
                break;
            case CPU_SPARKS:
                updateSpark(i, deltaTime, positions, velocities);
                break;
            case CPU_GEM_SPARKS:
                updateGemSpark(
                    i, deltaTime, positions, velocities, seeds,
                    centerX, centerY, centerZ,
                    boundsX, boundsY, boundsZ,
                    audioHigh, timeSec
                );
                break;
            default:
                break;
        }

        const int idx = i * 3;
        if (isOutOfWorldBounds(positions[idx], positions[idx + 1], positions[idx + 2])) {
            respawnCpuParticle(
                i, particleType,
                positions, velocities, lives, sizes, colors, seeds,
                centerX, centerY, centerZ,
                boundsX, boundsY, boundsZ,
                sizeMin, sizeMax,
                false
            );
        }
    }
}

} // extern "C"
