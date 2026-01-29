/**
 * @file particle_physics.h
 * @brief Header for particle physics WASM module
 * 
 * Defines the interface for GPU-style particle physics computed on CPU via WASM.
 * Designed to be called from TypeScript's ComputeParticleSystem when WASM is available.
 */

#ifndef PARTICLE_PHYSICS_H
#define PARTICLE_PHYSICS_H

#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Update particle positions and velocities
 * 
 * Processes all particles in a single batch update. Each particle has:
 * - Position buffer: [x, y, z, life] * count
 * - Velocity buffer: [vx, vy, vz, speed] * count
 * 
 * Physics applied:
 * - Gravity on Y axis
 * - Audio-reactive speed boost
 * - Life decay
 * - Automatic respawn when life < 0
 * 
 * @param positions Pointer to position buffer (x, y, z, life) * count
 * @param velocities Pointer to velocity buffer (vx, vy, vz, speed) * count
 * @param count Number of particles
 * @param deltaTime Time step in seconds
 * @param gravityY Gravity force on Y axis (typically negative)
 * @param audioPulse Audio intensity for reactive speed boost (0-1)
 * @param spawnX Spawn center X coordinate
 * @param spawnY Spawn center Y coordinate
 * @param spawnZ Spawn center Z coordinate
 */
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
);

/**
 * @brief Get the WASM module version
 * @return Version number (major * 100 + minor)
 */
int getParticlePhysicsVersion(void);

/**
 * @brief Initialize the random seed for particle respawning
 * @param seed Initial seed value
 */
void initParticleRandom(uint32_t seed);

#ifdef __cplusplus
}
#endif

#endif // PARTICLE_PHYSICS_H
