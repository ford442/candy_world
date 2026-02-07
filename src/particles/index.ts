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

// GPU particle systems
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
