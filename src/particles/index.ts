/**
 * @file index.ts
 * @description Barrel export for particles module
 */

// Configuration types
export * from './particle_config.ts';

// Audio integration
export {
    uPulseStrength,
    uPulseColor,
    uBeatPhase,
    uAudioLevel,
    updateParticleAudioUniforms,
    getParticleAudioState,
    resetParticleAudioUniforms
} from './audio_reactive.ts';

// GPU particle systems (TSL-based)
export {
    // Particle system creators
    createShimmerParticles,
    createBubbleStream,
    createPollenCloud,
    createLeafConfetti,
    createPulseRing,
    
    // Helper functions
    addAmbientParticles,
    disposeParticleSystems
} from './gpu_particles.ts';

// WebGPU Compute Shader particle systems (high performance)
export {
    // Main class
    ComputeParticleSystem,
    
    // Factory functions for different particle types
    createComputeFireflies,
    createComputePollen,
    createComputeBerries,
    createComputeRain,
    createComputeSparks,
    
    // System management
    initComputeParticleSystems,
    addComputeSystem,
    removeComputeSystem,
    updateAllComputeSystems,
    disposeAllComputeSystems,
    getActiveComputeSystems,
    
    // Types
    type ComputeParticleType,
    type ComputeParticleConfig,
    type ParticleBuffers,
    type ParticleAudioData,
    type FireflyConfig,
    type PollenConfig,
    type BerryConfig,
    type RainConfig,
    type SparkConfig,
    type ComputeSystemCollection,
    
    // Shader sources (for advanced use)
    UPDATE_PARTICLES_WGSL,
    RENDER_PARTICLES_WGSL,
    FRAGMENT_PARTICLES_WGSL,
} from './compute-particles.ts';

// Integration helpers for migrating existing systems
export {
    // Drop-in replacements
    createIntegratedFireflies,
    createIntegratedPollen,
    
    // System registry
    registerIntegratedSystem,
    updateAllIntegratedSystems,
    disposeIntegratedSystem,
    disposeAllIntegratedSystems,
    
    // Deferred loading
    queueDeferredSystem,
    loadDeferredSystems,
    
    // Benchmarking
    benchmarkParticleSystem,
    printBenchmarkResults,
    getParticleMetrics,
    getAllParticleMetrics,
    
    // Types
    type IntegratedFireflyOptions,
    type IntegratedPollenOptions,
    type BenchmarkResult,
} from './compute-integration.ts';
