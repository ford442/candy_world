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

} // extern "C"
