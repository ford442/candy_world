/**
 * @file index.ts
 * @description Barrel export for rendering module
 */

// Material types and interfaces
export * from './material_types.js';

// Material creation functions and factory
export {
    // Factory class
    MaterialFactory,
    materialFactory,
    
    // Individual material creators
    createCandyMaterial,
    createGlowingCandyMaterial,
    createPetalMaterial,
    createIridescentMaterial,
    createJellyMaterial,
    createFrostedMaterial,
    createSwirledMaterial,
    createAudioReactiveMaterial,
    createGroundMaterial,
    
    // Audio uniforms and update
    uAudioPulse,
    uAudioColor,
    updateAudioReactiveMaterials
} from './materials.js';
