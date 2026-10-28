/**
 * @file particle_physics.h
 * @brief Header for particle physics WASM module
 * 
 * The CPU particle fallback (src/utils/wasm-particles-cpp.ts) when GPU
 * compute is unavailable. updateParticlesWASM and its version/seed helpers
 * had no caller and were deleted (#2026).
 */

#ifndef PARTICLE_PHYSICS_H
#define PARTICLE_PHYSICS_H

#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Batch update for CPU particle fallback (matches cpu-particle-simulate.ts)
 *
 * Buffer layouts: positions [x,y,z]*count, velocities [vx,vy,vz]*count,
 * lives, sizes, colors [rgba]*count, seeds.
 *
 * particleType: 0=fireflies, 1=pollen, 2=berries, 3=rain, 4=sparks, 5=gem_sparks
 */
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
);

#ifdef __cplusplus
}
#endif

#endif // PARTICLE_PHYSICS_H
