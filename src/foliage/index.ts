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
export { FoliageMaterial, FoliageObject } from './types';

// Re-export glitch functionality
export { applyGlitch } from './glitch.ts';

// Re-export wind compute
export { 
    windComputeSystem as defaultWindComputeSystem,
    getWindTextureData as defaultGetWindTextureData 
} from './wind-compute.ts';

// =============================================================================
// FOLIAGE OBJECT CREATORS - Sky, celestial bodies, mushrooms, flowers, trees
// =============================================================================
export { createCrescendoFogNode, createSky } from './sky.ts';
export { createStars } from './stars.ts';
export { createMoon } from './moon.ts';
export { createMushroom } from './mushrooms.ts';
export { 
    createFlower, 
    createGlowingFlower, 
    createStarflower,
    createBellBloom,
    createPuffballFlower,
    createPrismRoseBush,
    createVibratoViolet,
    createTremoloTulip,
    createLanternFlower,
    createGlowingFlowerPatch
} from './flowers.ts';
export { 
    createFloweringTree, 
    createShrub, 
    createVine, 
    createLeafParticle,
    createBubbleWillow,
    createHelixPlant,
    createBalloonBush,
    createVineCluster,
    createAccordionPalm,
    createFiberOpticWillow,
    createSwingableVine,
    VineSwing
} from './trees.ts';
export { createSubwooferLotus } from './lotus.ts';
export { createFloatingOrb, createFloatingOrbCluster, createKickDrumGeyser } from './environment.ts';
export { createRainingCloud } from './clouds.ts';
export { createWaveformWater } from './water.ts';
export { createFireflies } from './fireflies.ts';
export { initFallingBerries } from './berries.ts';
export { initGrassSystem, addGrassInstance } from './grass.ts';
export { 
    createArpeggioFern, 
    createPortamentoPine, 
    createCymbalDandelion, 
    createSnareTrap,
    createRetriggerMushroom
} from './musical_flora.ts';
export { createWisteriaCluster } from './wisteria-cluster.ts';
export { createPanningPad } from './panning-pads.ts';
export { createSilenceSpirit } from './silence-spirits.ts';
export { createInstrumentShrine } from './instrument.ts';
export { createMelodyMirror } from './mirrors.ts';
export { createIsland } from './lake_features.ts';
export { createCaveEntrance } from './cave.ts';
export { createNeonPollen } from './pollen.ts';
export { createTerrainMaterial } from './terrain.ts';
