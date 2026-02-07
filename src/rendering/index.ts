/**
 * @file index.ts
 * @description Barrel export for rendering module
 */

// Material types and interfaces
export * from './material_types.ts';

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
} from './materials.ts';

// WebGPU limits and fallback handling
export {
    getWebGPULimits,
    clearWebGPULimitsCache,
    supportsComplexInstancing,
    supportsBasicInstancing,
    createMaterialWithFallback,
    simplifyMaterial,
    isVertexBufferLimitError,
    WebGPUPipelineErrorHandler,
    pipelineErrorHandler,
    estimateVertexBufferUsage,
    logVertexBufferUsage,
    type WebGPULimits,
    type MaterialFallbackOptions
} from './webgpu-limits.ts';
