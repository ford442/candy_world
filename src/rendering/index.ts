/**
 * @file index.ts
 * @description Barrel export for rendering module
 */

// Culling system
export {
    CullingSystem,
    SpatialHashGrid,
    OcclusionQueryManager,
    CullingDebugVisualizer,
    CullingGroup,
    EntityType,
    LODLevel,
    QualityTier,
    createLODMeshes,
    getDitherValue,
    DEFAULT_CULL_DISTANCES,
    LOD_THRESHOLDS,
    QUALITY_MULTIPLIERS,
    DEFAULT_CULLING_CONFIG,
    type CullableObject,
    type CullingConfig,
    type CullingStats
} from './culling/index.ts';

// Material types and interfaces
export * from './material-types.ts';

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

// Shader warm-up (progressive compileAsync on the real scene)
export {
    compileSceneProgressively,
    collectCompileSet,
    WARMUP_LAYER,
    type CompileTarget,
    type ProgressiveCompileOptions,
    type ProgressiveCompileStats
} from './shader-warmup.ts';
