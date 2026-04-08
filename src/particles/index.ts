/**
 * @file index.ts
 * @description Barrel file for particle system exports
 * Re-exports all public APIs from the compute particle system modules
 * for backward compatibility.
 */

// Types and interfaces
export type {
    ComputeParticleType,
    ComputeParticleConfig,
    ParticleBuffers,
    ParticleAudioData,
    FireflyConfig,
    PollenConfig,
    BerryConfig,
    RainConfig,
    SparkConfig,
    ComputeSystemCollection
} from './compute-particles-types.ts';

// Shaders
export {
    UPDATE_PARTICLES_WGSL,
    RENDER_PARTICLES_WGSL,
    FRAGMENT_PARTICLES_WGSL
} from './compute-particles-shaders.ts';

// CPU fallback system
export { CPUParticleSystem } from './cpu-particle-system.ts';

// Main GPU compute system and factory functions
export {
    ComputeParticleSystem,
    createComputeFireflies,
    createComputePollen,
    createComputeBerries,
    createComputeRain,
    createComputeSparks,
    initComputeParticleSystems,
    addComputeSystem,
    removeComputeSystem,
    updateAllComputeSystems,
    disposeAllComputeSystems,
    getActiveComputeSystems
} from './compute-particles.ts';

// Default export
export { default } from './compute-particles.ts';
