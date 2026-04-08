// src/foliage/index.ts
// Main export hub for foliage system - re-exports everything for backward compatibility

// =============================================================================
// MATERIAL CORE - Shared resources, TSL utilities, and material factory
// =============================================================================
export {
    // Shared geometries
    sharedGeometries,
    eyeGeo,
    pupilGeo,
    // Scratch vectors
    _scratchVec1,
    _scratchVec2,
    _scratchVec3,
    // Global uniforms
    uWindSpeed,
    uWindDirection,
    uTime,
    uGlitchIntensity,
    uGlitchExplosionCenter,
    uGlitchExplosionRadius,
    uAudioLow,
    uAudioHigh,
    uPlayerPosition,
    // Utility functions
    median,
    generateNoiseTexture,
    getCachedProceduralMaterial,
    // TSL utility functions
    triplanarNoise,
    perturbNormal,
    createRimLight,
    createJuicyRimLight,
    createSugarSparkle,
    addRimLight,
    colorFromNote,
    // Player interaction
    calculatePlayerPush,
    applyPlayerInteraction,
    // Wind and bloom
    calculateWindSway,
    calculateWindSwayLegacy,
    calculateFlowerBloom,
    getWindTextureData,
    windComputeSystem,
    // Material factory
    createUnifiedMaterial,
    UnifiedMaterialOptions,
    // Presets
    CandyPresets,
    // Legacy wrappers
    createClayMaterial,
    createCandyMaterial,
    createTexturedClay,
    createSugaredMaterial,
    createGradientMaterial,
    createStandardNodeMaterial,
    createTransparentNodeMaterial,
} from './material-core.ts';

// =============================================================================
// FOLIAGE MATERIALS - Pre-configured material instances
// =============================================================================
export {
    foliageMaterials,
} from './foliage-materials.ts';

// =============================================================================
// FOLIAGE REACTIVITY - Reactivity registry and validation helpers
// =============================================================================
export {
    // Reactivity registry
    reactiveObjects,
    reactiveMaterials,
    _foliageReactiveColor,
    // Reactivity functions
    registerReactiveMaterial,
    pickAnimation,
    attachReactivity,
    cleanupReactivity,
    // Validation helpers
    validateFoliageMaterials,
    validateNodeGeometries,
} from './foliage-reactivity.ts';

// =============================================================================
// LEGACY EXPORTS - For full backward compatibility
// These are aliases to maintain existing import patterns
// =============================================================================

// Note: UnifiedMaterialOptions is already exported above via './material-core.ts'

// Keep the FoliageMaterial type available
export { FoliageMaterial } from './types';

// Re-export glitch functionality
export { applyGlitch } from './glitch.ts';

// Re-export wind compute
export { 
    windComputeSystem as defaultWindComputeSystem,
    getWindTextureData as defaultGetWindTextureData 
} from './wind-compute.ts';
