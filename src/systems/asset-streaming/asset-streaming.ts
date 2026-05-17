/**
 * @file asset-streaming.ts
 * @description Barrel export file re-exporting all asset streaming modules
 * 
 * This file provides the public API for the asset streaming system, re-exporting:
 * - AssetStreamer (main orchestrator class from asset-streaming-core)
 * - Specialized loaders (ProgressiveTextureLoader, AudioStreamingLoader, etc.)
 * - Scheduler classes (AssetScheduler, BatchCoordinator, PriorityQueue)
 * - Types and constants (from asset-streaming-types)
 * 
 * Consumers should import from this barrel rather than individual modules to ensure
 * backward compatibility and stable public API boundaries.
 * 
 * Usage:
 * ```typescript
 * import { AssetStreamer, AssetPriority, LoadState } from './asset-streaming.ts';
 * 
 * const streamer = new AssetStreamer(scene, manifest);
 * streamer.start();
 * ```
 */

// Core orchestrator
export { AssetStreamer } from './asset-streaming-core.ts';

// Specialized loaders
export {
    ProgressiveTextureLoader,
    AudioStreamingLoader,
    GeometryLODLoader,
    PlaceholderManager
} from './asset-streaming-loader.ts';

// Scheduler infrastructure
export {
    AssetScheduler,
    BatchCoordinator,
    PriorityQueue
} from './asset-streaming-scheduler.ts';

// Types and constants
export type {
    AssetMetadata,
    AssetManifest,
    LoadedAsset,
    LoadingProgress,
    StreamingConfig,
    StreamingStats,
    AssetRequest,
    AssetBatch
} from './asset-streaming-types.ts';

export {
    AssetPriority,
    AssetType,
    TextureFormat,
    LoadState,
    QualityLevel,
    MemoryPressure,
    DEFAULT_STREAMING_CONFIG,
    PRIORITY_DISTANCES,
    PRIORITY_DISTANCES_SQ,
    QUALITY_FORMAT_PREFERENCES
} from './asset-streaming-types.ts';
