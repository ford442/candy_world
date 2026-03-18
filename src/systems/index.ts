/**
 * @file systems/index.ts
 * @description Asset Streaming System exports
 * 
 * Main exports:
 * - AssetStreamer: Primary class for asset streaming
 * - RegionManager: Grid cell management
 * - CellLoader: Helper for loading cell assets
 * - LRUCache: Memory-efficient cache
 * - Enums: AssetPriority, AssetType, CellState, etc.
 * 
 * Usage:
 * ```typescript
 * import { AssetStreamer, AssetPriority, RegionManager } from './systems';
 * ```
 */

// Main classes
export { AssetStreamer } from './asset-streaming';
export { RegionManager, CellLoader } from './region-manager';

// Supporting classes from asset-streaming
export {
    LRUCache,
    NetworkManager,
    ProgressiveTextureLoader,
    AudioStreamingLoader,
    GeometryLODLoader,
    PlaceholderManager
} from './asset-streaming';

// Enums from asset-streaming
export {
    AssetPriority,
    AssetType,
    TextureFormat,
    LoadingState,
    QualityLevel,
    MemoryPressure
} from './asset-streaming';

// Enums from region-manager
export {
    CellState
} from './region-manager';

// Types from asset-streaming
export type {
    AssetMetadata,
    AssetManifest,
    LoadedAsset,
    LoadingProgress,
    NetworkStats,
    StreamingConfig,
    StreamingStats
} from './asset-streaming';

// Types from region-manager
export type {
    GridCell,
    CellBounds,
    CellWithBounds,
    RegionConfig,
    RegionStats,
    LODTransition,
    SpatialQueryResult
} from './region-manager';

// Utility functions
export {
    createSampleManifest,
    estimateTextureMemory,
    estimateGeometryMemory
} from './asset-streaming';

export {
    getCellKey,
    parseCellKey,
    worldToCell,
    cellToBounds,
    distanceToCell
} from './region-manager';

// Default export
export { default } from './asset-streaming';
