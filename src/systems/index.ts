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
export { AssetStreamer } from './asset-streaming/index.ts';
export { RegionManager, CellLoader } from './region-manager.ts';

// Supporting classes from asset-streaming
export {
    LRUCache,
    NetworkManager,
    ProgressiveTextureLoader,
    AudioStreamingLoader,
    GeometryLODLoader,
    PlaceholderManager
} from './asset-streaming/index.ts';

// Enums from asset-streaming (LoadState renamed from LoadingState for consistency)
export {
    AssetPriority,
    AssetType,
    TextureFormat,
    LoadState,
    QualityLevel,
    MemoryPressure
} from './asset-streaming/index.ts';

// Enums from region-manager
export {
    CellState
} from './region-manager.ts';

// Types from asset-streaming
export type {
    AssetMetadata,
    AssetManifest,
    LoadedAsset,
    LoadingProgress,
    NetworkStats,
    StreamingConfig,
    StreamingStats,
    AssetRequest,
    AssetBatch
} from './asset-streaming/index.ts';

// Types from region-manager
export type {
    GridCell,
    CellBounds,
    CellWithBounds,
    RegionConfig,
    RegionStats,
    LODTransition,
    SpatialQueryResult
} from './region-manager.ts';

// Utility functions
export {
    createSampleManifest,
    estimateTextureMemory,
    estimateGeometryMemory
} from './asset-streaming/index.ts';

export {
    getCellKey,
    parseCellKey,
    worldToCell,
    cellToBounds,
    distanceToCell
} from './region-manager.ts';

// Default export
export { default } from './asset-streaming/index.ts';
