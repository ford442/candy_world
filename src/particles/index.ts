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
    GemSparkConfig,
    SparkBurstConfig,
    CandyPuffConfig,
    ParticleAttractor,
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
    createComputeGemSparks,
    createComputeSparkBurst,
    createComputeCandyPuff,
    MAX_PARTICLE_ATTRACTORS,
    initComputeParticleSystems,
    addComputeSystem,
    removeComputeSystem,
    updateAllComputeSystems,
    disposeAllComputeSystems,
    getActiveComputeSystems
} from './compute-particles.ts';

// Default export
export { default } from './compute-particles.ts';

// Reusable emitter API (emitters, attractors, music hooks)
export {
    Emitter,
    createEmitter,
    getEmitter,
    getEmitters,
    disposeEmitter,
    disposeAllEmitters,
    updateEmitters,
    setEmitterParent,
    burstAt,
    isOneShotPreset
} from './emitter-api.ts';

export type {
    EmitterOptions,
    EmitterPreset,
    EmitterShape,
    EmitterShapeType,
    MusicBinding,
    MusicSource,
    MusicTarget,
    AttractorHandle
} from './emitter-api.ts';

// Integration
export {
    createIntegratedFireflies,
    createIntegratedPollen,
    createIntegratedSpores,
    createIntegratedSparks,
    createIntegratedBerries,
    createIntegratedGemSparks,
    createIntegratedRain,
    updateAllIntegratedSystems,
    registerIntegratedSystem,
    disposeIntegratedSystem,
    disposeAllIntegratedSystems,
    queueDeferredSystem,
    loadDeferredSystems,
    benchmarkParticleSystem,
    printBenchmarkResults
} from './compute-integration.ts';
