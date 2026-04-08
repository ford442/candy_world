/**
 * @file index.ts
 * @description Barrel file for asset-streaming module
 */

// Re-export all types and enums
export {
    // Enums
    AssetPriority,
    AssetType,
    TextureFormat,
    LoadState,
    QualityLevel,
    MemoryPressure,
    // Interfaces
    type AssetMetadata,
    type AssetManifest,
    type LoadedAsset,
    type LoadingProgress,
    type NetworkStats,
    type StreamingConfig,
    type StreamingStats,
    type AssetRequest,
    type AssetBatch,
    // Constants
    DEFAULT_STREAMING_CONFIG,
    PRIORITY_DISTANCES,
    QUALITY_FORMAT_PREFERENCES,
    // Utility functions
    createSampleManifest,
    estimateTextureMemory,
    estimateGeometryMemory
} from './asset-streaming-types.ts';

// Re-export infrastructure classes
export {
    LRUCache,
    NetworkManager
} from './asset-loading-infrastructure.ts';

// Re-export specialized loaders
export {
    ProgressiveTextureLoader,
    AudioStreamingLoader,
    GeometryLODLoader,
    PlaceholderManager
} from './asset-streaming.ts';

// Re-export main class as default and named export
export { AssetStreamer as default, AssetStreamer } from './asset-streaming.ts';

// Re-export region-manager types (for convenience)
export { RegionManager, GridCell, CellState } from '../region-manager.ts';
