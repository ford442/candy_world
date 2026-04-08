/**
 * @file index.ts
 * @description Barrel file for the culling system
 * 
 * Exports all types, components, and the main CullingSystem class.
 */

// Types and Enums
export {
    CullingGroup,
    EntityType,
    LODLevel,
    QualityTier
} from './culling-types.ts';

// Interfaces
export type {
    CullableObject,
    CullingConfig,
    CullingStats,
    LODLevelConfig,
    SpatialHashConfig,
    OcclusionQueryConfig
} from './culling-types.ts';

// Constants
export {
    DEFAULT_CULL_DISTANCES,
    LOD_THRESHOLDS,
    QUALITY_MULTIPLIERS,
    DISTANCE_MULTIPLIERS,
    DEFAULT_CULLING_CONFIG
} from './culling-types.ts';

// Utility Functions
export {
    getDitherValue,
    createLODMeshes,
    simplifyGeometry
} from './culling-types.ts';

// Components
export {
    SpatialHashGrid,
    OcclusionQueryManager,
    CullingDebugVisualizer
} from './culling-components.ts';

// Main System
export { CullingSystem } from './culling-system.ts';
export { CullingSystem as default } from './culling-system.ts';
