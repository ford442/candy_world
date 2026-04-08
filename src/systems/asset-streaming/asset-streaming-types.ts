/**
 * @file asset-streaming-types.ts
 * @description Type definitions, enums, constants and utilities for asset streaming system
 */

import * as THREE from 'three';

// ============================================================================
// ENUMS
// ============================================================================

/** Asset priority levels for loading queue */
export enum AssetPriority {
    CRITICAL = 0,   // Core shaders, player model, immediate terrain
    HIGH = 1,       // Nearby foliage (within 50m), UI textures
    MEDIUM = 2,     // Distant scenery (50-150m), ambient audio
    LOW = 3,        // Far terrain (150m+), optional decorations
    BACKGROUND = 4  // Preload next likely areas
}

/** Asset types for specialized loading strategies */
export enum AssetType {
    TEXTURE = 'texture',
    GEOMETRY = 'geometry',
    AUDIO = 'audio',
    SHADER = 'shader',
    MATERIAL = 'material',
    ANIMATION = 'animation',
    DATA = 'data'
}

/** Texture format preferences (prioritize modern formats) */
export enum TextureFormat {
    AVIF = 'avif',      // Best compression, newer
    WEBP = 'webp',      // Good compression, widely supported
    PNG = 'png',        // Lossless fallback
    JPEG = 'jpeg',      // Photos only
    KTX2 = 'ktx2',      // Basis Universal compressed
    BASIS = 'basis'     // Basis Universal
}

/** Loading state of an asset */
export enum LoadState {
    PENDING = 'pending',
    LOADING = 'loading',
    STREAMING = 'streaming',  // For progressive/audio streaming
    LOADED = 'loaded',
    ERROR = 'error',
    UNLOADED = 'unloaded'
}

/** Quality levels for adaptive streaming */
export enum QualityLevel {
    MINIMAL = 'minimal',    // Emergency low-bandwidth mode
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    ULTRA = 'ultra'
}

/** Memory pressure levels */
export enum MemoryPressure {
    NONE = 'none',
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical'
}

// ============================================================================
// INTERFACES
// ============================================================================

/** Asset metadata from manifest */
export interface AssetMetadata {
    id: string;
    type: AssetType;
    priority: AssetPriority;
    size: number;              // bytes
    compressedSize?: number;   // bytes (compressed)
    checksum: string;          // SHA-256 for integrity
    dependencies: string[];    // Asset IDs this depends on
    formats?: TextureFormat[]; // Available formats
    lodVariants?: string[];    // LOD asset IDs (highest to lowest detail)
    streamingSupported: boolean;
    estimatedMemory: number;   // GPU memory in bytes
    cellX?: number;            // World grid position
    cellZ?: number;
}

/** Complete asset manifest */
export interface AssetManifest {
    version: string;
    totalSize: number;
    assets: Record<string, AssetMetadata>;
    cells: Record<string, string[]>;  // cell key -> asset IDs
    dependencyGraph: Record<string, string[]>;  // asset -> dependencies
}

/** Loaded asset data */
export interface LoadedAsset {
    id: string;
    metadata: AssetMetadata;
    state: LoadState;
    data: unknown;                    // THREE.Texture, AudioBuffer, etc.
    lowResData?: unknown;             // Progressive loading placeholder
    progress: number;                 // 0-1 for streaming assets
    lastUsed: number;                 // Timestamp for LRU
    referenceCount: number;
    quality: QualityLevel;
    loadTime: number;                 // ms to load
}

/** Loading progress info */
export interface LoadingProgress {
    bytesLoaded: number;
    bytesTotal: number;
    assetsLoaded: number;
    assetsTotal: number;
    currentAsset: string | null;
    queueLength: number;
    estimatedTimeRemaining: number;  // seconds
}

/** Network statistics for adaptive quality */
export interface NetworkStats {
    bandwidth: number;        // bytes/sec
    latency: number;          // ms
    connectionType: string;
    saveData: boolean;
    downlink?: number;        // Mbps (Network Information API)
    rtt?: number;             // Round-trip time
}

/** Streaming configuration */
export interface StreamingConfig {
    // Region settings
    cellSize: number;              // meters per grid cell (default: 50)
    loadRadius: number;            // cells to load around player
    unloadRadius: number;          // cells to unload (must be > loadRadius)
    unloadDelayMs: number;         // delay before unloading distant cells
    
    // Quality settings
    quality: QualityLevel;
    enableLODSwitching: boolean;
    lodTransitionDistance: number;
    
    // Memory settings
    maxTextureMemory: number;      // bytes
    maxGeometryMemory: number;     // bytes
    maxAudioMemory: number;        // bytes
    lruCacheSize: number;          // max cached assets
    
    // Network settings
    enableHttp2Push: boolean;
    enableRangeRequests: boolean;
    enableServiceWorker: boolean;
    maxConcurrentRequests: number;
    retryAttempts: number;
    retryDelayMs: number;
    
    // Loading settings
    enableProgressiveTextures: boolean;
    enableAudioStreaming: boolean;
    enablePredictiveLoading: boolean;
    predictiveLeadTime: number;    // seconds to preload ahead
    
    // Fallback settings
    placeholderTimeoutMs: number;
    lowQualityFallback: boolean;
    showPlaceholders: boolean;
}

/** Streaming statistics */
export interface StreamingStats {
    totalAssets: number;
    loadedAssets: number;
    loadingAssets: number;
    pendingAssets: number;
    errorAssets: number;
    memoryUsed: number;
    cacheHits: number;
    cacheMisses: number;
    networkBytesDownloaded: number;
    networkRequests: number;
    failedRequests: number;
    avgLoadTime: number;
    currentMemoryPressure: MemoryPressure;
    activeCells: number;
    queuedCells: number;
}

/** Asset request for loading queue */
export interface AssetRequest {
    id: string;
    priority: AssetPriority;
    resolve: (asset: LoadedAsset) => void;
    reject: (error: Error) => void;
    attempts?: number;
}

/** Batch of assets to load together */
export interface AssetBatch {
    ids: string[];
    priority: AssetPriority;
    onProgress?: (loaded: number, total: number) => void;
    onComplete?: (assets: LoadedAsset[]) => void;
    onError?: (errors: Error[]) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
    cellSize: 50,
    loadRadius: 3,           // 150m radius
    unloadRadius: 5,         // 250m radius (unload buffer)
    unloadDelayMs: 10000,    // 10 second buffer before unload
    
    quality: QualityLevel.HIGH,
    enableLODSwitching: true,
    lodTransitionDistance: 10,
    
    maxTextureMemory: 512 * 1024 * 1024,      // 512 MB
    maxGeometryMemory: 256 * 1024 * 1024,     // 256 MB
    maxAudioMemory: 64 * 1024 * 1024,         // 64 MB
    lruCacheSize: 1000,
    
    enableHttp2Push: true,
    enableRangeRequests: true,
    enableServiceWorker: true,
    maxConcurrentRequests: 6,
    retryAttempts: 3,
    retryDelayMs: 1000,
    
    enableProgressiveTextures: true,
    enableAudioStreaming: true,
    enablePredictiveLoading: true,
    predictiveLeadTime: 5,
    
    placeholderTimeoutMs: 5000,
    lowQualityFallback: true,
    showPlaceholders: true
};

/** Priority distance thresholds (meters) */
export const PRIORITY_DISTANCES: Record<AssetPriority, number> = {
    [AssetPriority.CRITICAL]: 0,       // Always load
    [AssetPriority.HIGH]: 50,
    [AssetPriority.MEDIUM]: 150,
    [AssetPriority.LOW]: 300,
    [AssetPriority.BACKGROUND]: 500
};

/** Quality level to texture format preference mapping */
export const QUALITY_FORMAT_PREFERENCES: Record<QualityLevel, TextureFormat[]> = {
    [QualityLevel.MINIMAL]: [TextureFormat.BASIS, TextureFormat.KTX2],
    [QualityLevel.LOW]: [TextureFormat.BASIS, TextureFormat.KTX2, TextureFormat.WEBP],
    [QualityLevel.MEDIUM]: [TextureFormat.KTX2, TextureFormat.AVIF, TextureFormat.WEBP],
    [QualityLevel.HIGH]: [TextureFormat.AVIF, TextureFormat.KTX2, TextureFormat.WEBP],
    [QualityLevel.ULTRA]: [TextureFormat.PNG, TextureFormat.AVIF, TextureFormat.KTX2]
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/** Create a sample asset manifest */
export function createSampleManifest(): AssetManifest {
    return {
        version: '1.0.0',
        totalSize: 0,
        assets: {},
        cells: {},
        dependencyGraph: {}
    };
}

/** Estimate memory usage for a texture */
export function estimateTextureMemory(
    width: number,
    height: number,
    format: THREE.PixelFormat = THREE.RGBAFormat,
    type: THREE.TextureDataType = THREE.UnsignedByteType
): number {
    const bitsPerChannel = type === THREE.UnsignedByteType ? 8 : 16;
    const channels = format === THREE.RGBAFormat ? 4 : 3;
    const mipmaps = 1.33;  // Mipmaps add ~33%
    
    return width * height * channels * (bitsPerChannel / 8) * mipmaps;
}

/** Estimate memory usage for geometry */
export function estimateGeometryMemory(geometry: THREE.BufferGeometry): number {
    let bytes = 0;
    
    for (const key in geometry.attributes) {
        const attr = geometry.attributes[key];
        bytes += attr.array.byteLength;
    }
    
    if (geometry.index) {
        bytes += geometry.index.array.byteLength;
    }
    
    return bytes;
}
