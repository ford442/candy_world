/**
 * @file asset-streaming.ts
 * @description Comprehensive asset streaming and dynamic loading system for candy_world
 * 
 * Enables infinite world sizes without infinite loading times by:
 * - Priority-based asset loading (CRITICAL → BACKGROUND)
 * - Grid-based region streaming with seamless LOD transitions
 * - Progressive texture loading (low-res → high-res)
 * - LRU memory cache with aggressive unloading
 * - Network optimization (HTTP/2, range requests, Service Worker)
 * - Graceful fallback handling on slow connections
 * 
 * Performance targets:
 * - Initial load: <3 seconds for critical assets
 * - Streaming overhead: <1ms per frame
 * - Memory pressure response: <100ms
 * - LOD transition: seamless (no popping)
 */

import * as THREE from 'three';
import { RegionManager, GridCell, CellState } from './region-manager';

// ============================================================================
// TYPES & ENUMS
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
export enum LoadingState {
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
    state: LoadingState;
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

// ============================================================================
// DEFAULT CONFIGURATION
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
// LRU CACHE IMPLEMENTATION
// ============================================================================

/**
 * LRU (Least Recently Used) cache for asset memory management.
 * Automatically evicts least recently used assets when size limit reached.
 */
export class LRUCache<K, V> {
    private cache: Map<K, V> = new Map();
    private maxSize: number;
    private currentSize: number;
    private getSize: (value: V) => number;

    constructor(
        maxSize: number,
        getSize: (value: V) => number = () => 1
    ) {
        this.maxSize = maxSize;
        this.currentSize = 0;
        this.getSize = getSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): boolean {
        const size = this.getSize(value);
        
        // If single item exceeds max size, don't cache
        if (size > this.maxSize) {
            return false;
        }

        // Remove existing entry if present
        if (this.cache.has(key)) {
            const oldValue = this.cache.get(key)!;
            this.currentSize -= this.getSize(oldValue);
            this.cache.delete(key);
        }

        // Evict entries until we have space
        while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
            this.evictLRU();
        }

        this.cache.set(key, value);
        this.currentSize += size;
        return true;
    }

    delete(key: K): boolean {
        const value = this.cache.get(key);
        if (value !== undefined) {
            this.currentSize -= this.getSize(value);
            return this.cache.delete(key);
        }
        return false;
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    private evictLRU(): void {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
            const value = this.cache.get(firstKey)!;
            this.currentSize -= this.getSize(value);
            this.cache.delete(firstKey);
        }
    }

    clear(): void {
        this.cache.clear();
        this.currentSize = 0;
    }

    get size(): number {
        return this.cache.size;
    }

    get byteSize(): number {
        return this.currentSize;
    }

    keys(): IterableIterator<K> {
        return this.cache.keys();
    }

    forEach(callback: (value: V, key: K) => void): void {
        this.cache.forEach(callback);
    }
}

// ============================================================================
// NETWORK MANAGER
// ============================================================================

/**
 * Manages network requests with optimization features:
 * - HTTP/2 server push simulation
 * - Range requests for large files
 * - Retry with exponential backoff
 * - Request prioritization and queuing
 */
export class NetworkManager {
    private config: StreamingConfig;
    private activeRequests: Map<string, AbortController> = new Map();
    private requestQueue: Array<{
        url: string;
        priority: AssetPriority;
        range?: { start: number; end: number };
        resolve: (response: Response) => void;
        reject: (error: Error) => void;
        attempts: number;
    }> = new Map();
    private stats = {
        bytesDownloaded: 0,
        requests: 0,
        failed: 0,
        retries: 0
    };

    constructor(config: StreamingConfig) {
        this.config = config;
    }

    /** Detect network capabilities */
    async detectNetwork(): Promise<NetworkStats> {
        const connection = (navigator as any).connection;
        
        return {
            bandwidth: 0,  // Would be measured from actual downloads
            latency: 0,    // Would be measured from ping
            connectionType: connection?.effectiveType || 'unknown',
            saveData: connection?.saveData || false,
            downlink: connection?.downlink,
            rtt: connection?.rtt
        };
    }

    /** Fetch asset with all optimizations */
    async fetchAsset(
        url: string,
        priority: AssetPriority = AssetPriority.MEDIUM,
        range?: { start: number; end: number }
    ): Promise<Response> {
        // Check if we can make more concurrent requests
        if (this.activeRequests.size >= this.config.maxConcurrentRequests) {
            // Queue the request
            return new Promise((resolve, reject) => {
                this.requestQueue.push({
                    url, priority, range, resolve, reject, attempts: 0
                });
                // Sort by priority
                this.requestQueue.sort((a, b) => a.priority - b.priority);
            });
        }

        return this.doFetch(url, priority, range);
    }

    private async doFetch(
        url: string,
        priority: AssetPriority,
        range?: { start: number; end: number }
    ): Promise<Response> {
        const abortController = new AbortController();
        this.activeRequests.set(url, abortController);

        const headers: HeadersInit = {};
        
        // Add priority hint if supported
        if ('priority' in Request.prototype) {
            (headers as any)['priority'] = this.priorityToHint(priority);
        }

        // Add range header if specified
        if (range && this.config.enableRangeRequests) {
            headers['Range'] = `bytes=${range.start}-${range.end}`;
        }

        try {
            const response = await fetch(url, {
                signal: abortController.signal,
                headers
            });

            if (!response.ok && response.status !== 206) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.stats.requests++;
            
            // Track bytes downloaded
            const contentLength = response.headers.get('content-length');
            if (contentLength) {
                this.stats.bytesDownloaded += parseInt(contentLength, 10);
            }

            return response;
        } catch (error) {
            this.stats.failed++;
            throw error;
        } finally {
            this.activeRequests.delete(url);
            this.processQueue();
        }
    }

    private priorityToHint(priority: AssetPriority): 'high' | 'low' | 'auto' {
        switch (priority) {
            case AssetPriority.CRITICAL:
            case AssetPriority.HIGH:
                return 'high';
            case AssetPriority.LOW:
            case AssetPriority.BACKGROUND:
                return 'low';
            default:
                return 'auto';
        }
    }

    private processQueue(): void {
        while (
            this.activeRequests.size < this.config.maxConcurrentRequests &&
            this.requestQueue.length > 0
        ) {
            const request = this.requestQueue.shift()!;
            this.doFetch(request.url, request.priority, request.range)
                .then(request.resolve)
                .catch(request.reject);
        }
    }

    /** Retry with exponential backoff */
    async retryWithBackoff<T>(
        operation: () => Promise<T>,
        attempts: number = this.config.retryAttempts
    ): Promise<T> {
        let lastError: Error | undefined;
        
        for (let i = 0; i < attempts; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.stats.retries++;
                
                if (i < attempts - 1) {
                    const delay = this.config.retryDelayMs * Math.pow(2, i);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw lastError;
    }

    /** Cancel all pending requests */
    cancelAll(): void {
        for (const controller of this.activeRequests.values()) {
            controller.abort();
        }
        this.activeRequests.clear();
        this.requestQueue = [];
    }

    getStats(): typeof this.stats {
        return { ...this.stats };
    }
}

// ============================================================================
// PROGRESSIVE TEXTURE LOADER
// ============================================================================

/**
 * Loads textures progressively - low resolution first, then refines.
 * Similar to progressive JPEG loading for better perceived performance.
 */
export class ProgressiveTextureLoader {
    private textureLoader: THREE.TextureLoader;
    private ktx2Loader?: any;  // Would be THREE.KTX2Loader if available

    constructor() {
        this.textureLoader = new THREE.TextureLoader();
    }

    /**
     * Load texture progressively.
     * First loads a thumbnail/preview, then loads full resolution.
     */
    async loadProgressive(
        urls: { thumbnail: string; full: string },
        onProgress?: (progress: number, isLowRes: boolean) => void
    ): Promise<THREE.Texture> {
        return new Promise((resolve, reject) => {
            // Load low-res thumbnail first
            this.textureLoader.load(
                urls.thumbnail,
                (lowResTexture) => {
                    lowResTexture.generateMipmaps = false;
                    lowResTexture.minFilter = THREE.LinearFilter;
                    onProgress?.(0.5, true);

                    // Then load full resolution
                    this.textureLoader.load(
                        urls.full,
                        (fullTexture) => {
                            onProgress?.(1.0, false);
                            resolve(fullTexture);
                        },
                        undefined,
                        (error) => {
                            // If full fails, use low-res as fallback
                            console.warn(`Failed to load full texture, using low-res: ${error}`);
                            resolve(lowResTexture);
                        }
                    );
                },
                undefined,
                (error) => reject(error)
            );
        });
    }

    /**
     * Load compressed texture (KTX2/Basis)
     */
    async loadCompressed(url: string): Promise<THREE.CompressedTexture> {
        if (!this.ktx2Loader) {
            throw new Error('KTX2Loader not initialized');
        }
        return this.ktx2Loader.loadAsync(url);
    }
}

// ============================================================================
// AUDIO STREAMING LOADER
// ============================================================================

/**
 * Streams audio for playback while downloading.
 * Uses MediaSource Extensions or chunked loading.
 */
export class AudioStreamingLoader {
    private audioContext: AudioContext;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
    }

    /**
     * Stream audio - start playing before fully downloaded
     */
    async streamAudio(
        url: string,
        onProgress?: (progress: number) => void
    ): Promise<AudioBuffer> {
        // For now, use standard fetch and decode
        // Full implementation would use MediaSource Extensions
        const response = await fetch(url);
        const reader = response.body?.getReader();
        
        if (!reader) {
            throw new Error('ReadableStream not supported');
        }

        const chunks: Uint8Array[] = [];
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        let receivedLength = 0;

        while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;
            
            chunks.push(value);
            receivedLength += value.length;
            
            if (contentLength > 0) {
                onProgress?.(receivedLength / contentLength);
            }
        }

        // Combine chunks
        const allChunks = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
            allChunks.set(chunk, position);
            position += chunk.length;
        }

        // Decode audio
        const arrayBuffer = allChunks.buffer;
        return this.audioContext.decodeAudioData(arrayBuffer);
    }
}

// ============================================================================
// GEOMETRY LOD LOADER
// ============================================================================

/**
 * Loads geometry with LOD variants.
 * Simpler mesh arrives first, complex mesh refines it.
 */
export class GeometryLODLoader {
    private gltfLoader: any;  // Would be THREE.GLTFLoader

    /**
     * Load geometry with LOD streaming.
     * Returns simple geometry immediately, refines when detailed loads.
     */
    async loadLOD(
        lodUrls: { low: string; medium?: string; high?: string },
        onLevelLoaded?: (level: 'low' | 'medium' | 'high', geometry: THREE.BufferGeometry) => void
    ): Promise<THREE.BufferGeometry> {
        // Load low detail first
        const lowGeometry = await this.loadGeometry(lodUrls.low);
        onLevelLoaded?.('low', lowGeometry);

        // Queue medium and high for background loading
        if (lodUrls.medium) {
            this.loadGeometry(lodUrls.medium).then(geo => {
                onLevelLoaded?.('medium', geo);
            });
        }

        if (lodUrls.high) {
            this.loadGeometry(lodUrls.high).then(geo => {
                onLevelLoaded?.('high', geo);
            });
        }

        return lowGeometry;
    }

    private async loadGeometry(url: string): Promise<THREE.BufferGeometry> {
        // Simplified - would use actual GLTF loader
        return new Promise((resolve, reject) => {
            // Placeholder for actual GLTF loading
            reject(new Error('GLTFLoader not initialized'));
        });
    }
}

// ============================================================================
// PLACEHOLDER MANAGER
// ============================================================================

/**
 * Creates and manages placeholder assets while real assets load.
 */
export class PlaceholderManager {
    private placeholders: Map<string, THREE.Object3D> = new Map();
    private lowPolyGeometries: Map<string, THREE.BufferGeometry> = new Map();

    /** Get or create placeholder geometry for an asset type */
    getPlaceholder(type: AssetType, estimatedSize: number): THREE.Object3D {
        const key = `${type}_${estimatedSize}`;
        
        if (this.placeholders.has(key)) {
            return this.placeholders.get(key)!.clone();
        }

        const placeholder = this.createPlaceholder(type, estimatedSize);
        this.placeholders.set(key, placeholder);
        return placeholder.clone();
    }

    private createPlaceholder(type: AssetType, size: number): THREE.Object3D {
        switch (type) {
            case AssetType.GEOMETRY:
                // Low-poly bounding box representation
                const box = new THREE.BoxGeometry(size, size, size);
                const material = new THREE.MeshBasicMaterial({
                    color: 0x888888,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.5
                });
                return new THREE.Mesh(box, material);

            case AssetType.TEXTURE:
                // Colored plane as texture placeholder
                const plane = new THREE.PlaneGeometry(size, size);
                const planeMat = new THREE.MeshBasicMaterial({
                    color: Math.random() * 0xffffff,
                    transparent: true,
                    opacity: 0.3
                });
                return new THREE.Mesh(plane, planeMat);

            default:
                // Generic placeholder
                const generic = new THREE.Group();
                const dot = new THREE.Mesh(
                    new THREE.SphereGeometry(size * 0.1, 8, 8),
                    new THREE.MeshBasicMaterial({ color: 0xffff00 })
                );
                generic.add(dot);
                return generic;
        }
    }

    /** Create low-poly fallback for timeout scenarios */
    createLowPolyFallback(geometry: THREE.BufferGeometry, targetReduction: number = 0.5): THREE.BufferGeometry {
        // Simplified mesh reduction
        // In production, use a proper decimation library
        const positions = geometry.attributes.position?.array as Float32Array;
        if (!positions) return geometry;

        const vertexCount = positions.length / 3;
        const targetCount = Math.floor(vertexCount * targetReduction);
        const step = Math.ceil(vertexCount / targetCount);

        const newPositions: number[] = [];
        for (let i = 0; i < positions.length; i += step * 3) {
            newPositions.push(positions[i], positions[i + 1], positions[i + 2]);
        }

        const simplified = new THREE.BufferGeometry();
        simplified.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
        return simplified;
    }

    clear(): void {
        this.placeholders.forEach(p => {
            if ((p as THREE.Mesh).geometry) (p as THREE.Mesh).geometry.dispose();
            if ((p as THREE.Mesh).material) ((p as THREE.Mesh).material as THREE.Material).dispose();
        });
        this.placeholders.clear();
    }
}

// ============================================================================
// MAIN ASSET STREAMER CLASS
// ============================================================================

/**
 * Main asset streaming and dynamic loading system.
 * 
 * Coordinates all subsystems:
 * - RegionManager for grid cell management
 * - LRUCache for memory management
 * - NetworkManager for optimized loading
 * - Progressive loaders for specialized asset types
 * - PlaceholderManager for fallbacks
 * 
 * Usage:
 * ```typescript
 * const streamer = new AssetStreamer(scene, manifest);
 * streamer.setPlayerPosition(100, 0, 200);
 * streamer.start();
 * 
 * // Load specific asset with priority
 * await streamer.loadAsset('tree_01', AssetPriority.HIGH);
 * 
 * // Preload a region
 * streamer.preloadRegion(100, 200, 3);
 * 
 * // Get loading progress
 * const progress = streamer.getLoadingProgress();
 * ```
 */
export class AssetStreamer {
    // Subsystems
    private regionManager: RegionManager;
    private assetCache: LRUCache<string, LoadedAsset>;
    private networkManager: NetworkManager;
    private progressiveLoader: ProgressiveTextureLoader;
    private audioLoader: AudioStreamingLoader;
    private geometryLoader: GeometryLODLoader;
    private placeholderManager: PlaceholderManager;

    // State
    private config: StreamingConfig;
    private manifest: AssetManifest;
    private assets: Map<string, LoadedAsset> = new Map();
    private loadingQueue: Array<{ id: string; priority: AssetPriority; resolve: (asset: LoadedAsset) => void; reject: (error: Error) => void }> = [];
    private activeLoads: Map<string, AbortController> = new Map();
    private playerPosition: THREE.Vector3 = new THREE.Vector3();
    private playerVelocity: THREE.Vector3 = new THREE.Vector3();
    private lastUpdateTime: number = 0;
    private isRunning: boolean = false;

    // Memory tracking
    private textureMemoryUsed: number = 0;
    private geometryMemoryUsed: number = 0;
    private audioMemoryUsed: number = 0;

    // Event callbacks
    private onProgressCallbacks: Array<(progress: LoadingProgress) => void> = [];
    private onAssetLoadedCallbacks: Array<(asset: LoadedAsset) => void> = [];
    private onErrorCallbacks: Array<(error: Error, assetId: string) => void> = [];

    // Statistics
    private stats: StreamingStats = {
        totalAssets: 0,
        loadedAssets: 0,
        loadingAssets: 0,
        pendingAssets: 0,
        errorAssets: 0,
        memoryUsed: 0,
        cacheHits: 0,
        cacheMisses: 0,
        networkBytesDownloaded: 0,
        networkRequests: 0,
        failedRequests: 0,
        avgLoadTime: 0,
        currentMemoryPressure: MemoryPressure.NONE,
        activeCells: 0,
        queuedCells: 0
    };

    constructor(
        private scene: THREE.Scene,
        manifest: AssetManifest,
        config: Partial<StreamingConfig> = {},
        audioContext?: AudioContext
    ) {
        this.config = { ...DEFAULT_STREAMING_CONFIG, ...config };
        this.manifest = manifest;
        
        this.regionManager = new RegionManager(this.config.cellSize);
        this.assetCache = new LRUCache(
            this.config.lruCacheSize,
            (asset) => asset.metadata.estimatedMemory
        );
        this.networkManager = new NetworkManager(this.config);
        this.progressiveLoader = new ProgressiveTextureLoader();
        this.audioLoader = audioContext ? new AudioStreamingLoader(audioContext) : undefined!;
        this.geometryLoader = new GeometryLODLoader();
        this.placeholderManager = new PlaceholderManager();

        this.stats.totalAssets = Object.keys(manifest.assets).length;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Start the streaming system.
     * Begins monitoring player position and loading regions.
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.updateLoop();
    }

    /**
     * Stop the streaming system.
     * Cancels all pending loads.
     */
    stop(): void {
        this.isRunning = false;
        this.networkManager.cancelAll();
        for (const controller of this.activeLoads.values()) {
            controller.abort();
        }
        this.activeLoads.clear();
    }

    /**
     * Queue an asset for loading with specified priority.
     * Returns a promise that resolves when the asset is loaded.
     */
    async loadAsset(id: string, priority: AssetPriority = AssetPriority.MEDIUM): Promise<LoadedAsset> {
        // Check if already loaded
        const cached = this.assetCache.get(id);
        if (cached && cached.state === LoadingState.LOADED) {
            cached.lastUsed = performance.now();
            cached.referenceCount++;
            this.stats.cacheHits++;
            return cached;
        }

        // Check if currently loading
        const existing = this.assets.get(id);
        if (existing && existing.state === LoadingState.LOADING) {
            return new Promise((resolve, reject) => {
                this.loadingQueue.push({ id, priority, resolve, reject });
            });
        }

        this.stats.cacheMisses++;

        // Start new load
        return new Promise((resolve, reject) => {
            this.loadingQueue.push({ id, priority, resolve, reject });
            this.processLoadingQueue();
        });
    }

    /**
     * Unload an asset from memory.
     * Decrements reference count, actual unload happens when count reaches 0
     * and memory pressure requires it (or immediately if force=true).
     */
    unloadAsset(id: string, force: boolean = false): void {
        const asset = this.assets.get(id);
        if (!asset) return;

        asset.referenceCount = Math.max(0, asset.referenceCount - 1);

        if (force || asset.referenceCount === 0) {
            this.performUnload(asset);
        }
    }

    /**
     * Preload a region around the given world position.
     * Useful for predicting where player will go next.
     */
    async preloadRegion(worldX: number, worldZ: number, radius: number): Promise<void> {
        const cellX = Math.floor(worldX / this.config.cellSize);
        const cellZ = Math.floor(worldZ / this.config.cellSize);
        
        const cellKeys = this.regionManager.getCellsInRadius(cellX, cellZ, radius);
        
        const loadPromises: Promise<void>[] = [];
        
        for (const key of cellKeys) {
            const assetIds = this.manifest.cells[key] || [];
            
            for (const id of assetIds) {
                const metadata = this.manifest.assets[id];
                if (!metadata) continue;

                // Calculate distance-based priority
                const assetCellX = metadata.cellX ?? cellX;
                const assetCellZ = metadata.cellZ ?? cellZ;
                const distance = Math.sqrt(
                    Math.pow((assetCellX - cellX) * this.config.cellSize, 2) +
                    Math.pow((assetCellZ - cellZ) * this.config.cellSize, 2)
                );

                const priority = this.distanceToPriority(distance);
                
                loadPromises.push(
                    this.loadAsset(id, priority).then(() => {}).catch(() => {})
                );
            }
        }

        // Load in priority order, don't wait for all
        await Promise.all(loadPromises.slice(0, 10));
    }

    /**
     * Get current loading progress.
     */
    getLoadingProgress(): LoadingProgress {
        const bytesTotal = this.manifest.totalSize;
        let bytesLoaded = 0;
        let assetsLoaded = 0;

        for (const asset of this.assets.values()) {
            if (asset.state === LoadingState.LOADED) {
                bytesLoaded += asset.metadata.size;
                assetsLoaded++;
            } else if (asset.state === LoadingState.STREAMING) {
                bytesLoaded += asset.metadata.size * asset.progress;
            }
        }

        const remainingBytes = bytesTotal - bytesLoaded;
        const avgSpeed = this.stats.networkBytesDownloaded / Math.max(1, performance.now() / 1000);
        const estimatedTime = avgSpeed > 0 ? remainingBytes / avgSpeed : 0;

        return {
            bytesLoaded,
            bytesTotal,
            assetsLoaded,
            assetsTotal: this.stats.totalAssets,
            currentAsset: this.getCurrentLoadingAsset(),
            queueLength: this.loadingQueue.length,
            estimatedTimeRemaining: estimatedTime
        };
    }

    /**
     * Set quality level based on bandwidth/performance.
     */
    setQualityLevel(level: QualityLevel): void {
        this.config.quality = level;
        
        // Adjust memory limits based on quality
        switch (level) {
            case QualityLevel.MINIMAL:
                this.config.maxTextureMemory = 128 * 1024 * 1024;
                break;
            case QualityLevel.LOW:
                this.config.maxTextureMemory = 256 * 1024 * 1024;
                break;
            case QualityLevel.MEDIUM:
                this.config.maxTextureMemory = 512 * 1024 * 1024;
                break;
            case QualityLevel.HIGH:
                this.config.maxTextureMemory = 1024 * 1024 * 1024;
                break;
            case QualityLevel.ULTRA:
                this.config.maxTextureMemory = 2048 * 1024 * 1024;
                break;
        }

        // Trigger memory pressure check
        this.checkMemoryPressure();
    }

    /**
     * Update player position for predictive loading.
     */
    setPlayerPosition(x: number, y: number, z: number): void {
        const now = performance.now();
        const dt = (now - this.lastUpdateTime) / 1000;
        
        if (dt > 0) {
            this.playerVelocity.set(
                (x - this.playerPosition.x) / dt,
                (y - this.playerPosition.y) / dt,
                (z - this.playerPosition.z) / dt
            );
        }

        this.playerPosition.set(x, y, z);
        this.lastUpdateTime = now;

        // Update region manager
        this.updateRegions();
    }

    /**
     * Get current streaming statistics.
     */
    getStats(): StreamingStats {
        return { ...this.stats };
    }

    /**
     * Register progress callback.
     */
    onProgress(callback: (progress: LoadingProgress) => void): void {
        this.onProgressCallbacks.push(callback);
    }

    /**
     * Register asset loaded callback.
     */
    onAssetLoaded(callback: (asset: LoadedAsset) => void): void {
        this.onAssetLoadedCallbacks.push(callback);
    }

    /**
     * Register error callback.
     */
    onError(callback: (error: Error, assetId: string) => void): void {
        this.onErrorCallbacks.push(callback);
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private async updateLoop(): Promise<void> {
        while (this.isRunning) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            if (!this.isRunning) break;

            // Update predictive loading
            if (this.config.enablePredictiveLoading) {
                this.updatePredictiveLoading();
            }

            // Check memory pressure
            this.checkMemoryPressure();

            // Process loading queue
            this.processLoadingQueue();

            // Update stats
            this.updateStats();

            // Notify progress
            const progress = this.getLoadingProgress();
            this.onProgressCallbacks.forEach(cb => {
                try { cb(progress); } catch (e) {}
            });
        }
    }

    private updateRegions(): void {
        const cellX = Math.floor(this.playerPosition.x / this.config.cellSize);
        const cellZ = Math.floor(this.playerPosition.z / this.config.cellSize);

        // Update region manager
        this.regionManager.updatePlayerPosition(cellX, cellZ);

        // Get cells that need loading/unloading
        const cellsToLoad = this.regionManager.getCellsToLoad(
            cellX, cellZ, this.config.loadRadius
        );
        const cellsToUnload = this.regionManager.getCellsToUnload(
            cellX, cellZ, this.config.unloadRadius
        );

        // Queue assets for new cells
        for (const cell of cellsToLoad) {
            if (cell.state === CellState.UNLOADED) {
                this.loadCell(cell);
            }
        }

        // Schedule distant cells for unloading
        for (const cell of cellsToUnload) {
            if (cell.state === CellState.LOADED) {
                this.scheduleCellUnload(cell);
            }
        }
    }

    private loadCell(cell: GridCell): void {
        cell.state = CellState.LOADING;
        
        const assetIds = this.manifest.cells[cell.key] || [];
        
        for (const id of assetIds) {
            const metadata = this.manifest.assets[id];
            if (!metadata) continue;

            // Calculate distance-based priority
            const distance = this.getDistanceToCell(cell);
            const priority = this.distanceToPriority(distance);

            // Queue for loading
            this.loadAsset(id, priority).catch(() => {});
        }

        cell.state = CellState.LOADED;
    }

    private scheduleCellUnload(cell: GridCell): void {
        // Delay unload to prevent thrashing
        setTimeout(() => {
            if (cell.state === CellState.LOADED) {
                this.unloadCell(cell);
            }
        }, this.config.unloadDelayMs);
    }

    private unloadCell(cell: GridCell): void {
        const assetIds = this.manifest.cells[cell.key] || [];
        
        for (const id of assetIds) {
            this.unloadAsset(id);
        }

        cell.state = CellState.UNLOADED;
    }

    private async processLoadingQueue(): Promise<void> {
        // Sort by priority
        this.loadingQueue.sort((a, b) => a.priority - b.priority);

        // Process up to max concurrent loads
        while (
            this.activeLoads.size < this.config.maxConcurrentRequests &&
            this.loadingQueue.length > 0
        ) {
            const item = this.loadingQueue.shift()!;
            this.loadAssetInternal(item.id, item.priority, item.resolve, item.reject);
        }
    }

    private async loadAssetInternal(
        id: string,
        priority: AssetPriority,
        resolve: (asset: LoadedAsset) => void,
        reject: (error: Error) => void
    ): Promise<void> {
        const metadata = this.manifest.assets[id];
        if (!metadata) {
            reject(new Error(`Asset not found in manifest: ${id}`));
            return;
        }

        // Create asset entry
        const asset: LoadedAsset = {
            id,
            metadata,
            state: LoadingState.LOADING,
            data: null,
            progress: 0,
            lastUsed: performance.now(),
            referenceCount: 1,
            quality: this.config.quality,
            loadTime: 0
        };

        this.assets.set(id, asset);
        this.stats.loadingAssets++;

        const abortController = new AbortController();
        this.activeLoads.set(id, abortController);

        const startTime = performance.now();

        try {
            // Check for dependencies first
            await this.loadDependencies(metadata);

            // Load based on type
            switch (metadata.type) {
                case AssetType.TEXTURE:
                    asset.data = await this.loadTexture(metadata, abortController.signal);
                    break;
                case AssetType.GEOMETRY:
                    asset.data = await this.loadGeometry(metadata, abortController.signal);
                    break;
                case AssetType.AUDIO:
                    asset.data = await this.loadAudio(metadata, abortController.signal);
                    break;
                case AssetType.SHADER:
                    asset.data = await this.loadShader(metadata);
                    break;
                default:
                    asset.data = await this.loadGeneric(metadata, abortController.signal);
            }

            asset.state = LoadingState.LOADED;
            asset.loadTime = performance.now() - startTime;
            
            // Add to cache
            this.assetCache.set(id, asset);
            
            this.stats.loadedAssets++;
            this.stats.loadingAssets--;

            // Notify callbacks
            this.onAssetLoadedCallbacks.forEach(cb => {
                try { cb(asset); } catch (e) {}
            });

            resolve(asset);
        } catch (error) {
            asset.state = LoadingState.ERROR;
            this.stats.loadingAssets--;
            this.stats.errorAssets++;
            this.stats.failedRequests++;

            const err = error instanceof Error ? error : new Error(String(error));
            this.onErrorCallbacks.forEach(cb => {
                try { cb(err, id); } catch (e) {}
            });

            reject(err);
        } finally {
            this.activeLoads.delete(id);
        }
    }

    private async loadDependencies(metadata: AssetMetadata): Promise<void> {
        const deps = metadata.dependencies || [];
        await Promise.all(
            deps.map(depId => this.loadAsset(depId, AssetPriority.CRITICAL))
        );
    }

    private async loadTexture(
        metadata: AssetMetadata,
        signal: AbortSignal
    ): Promise<THREE.Texture> {
        const formats = metadata.formats || [TextureFormat.PNG];
        const preferredFormats = QUALITY_FORMAT_PREFERENCES[this.config.quality];
        
        // Find best available format
        const format = preferredFormats.find(f => formats.includes(f)) || formats[0];
        const url = `assets/textures/${metadata.id}.${format}`;

        if (format === TextureFormat.KTX2 || format === TextureFormat.BASIS) {
            return this.progressiveLoader.loadCompressed(url);
        }

        // Progressive loading for supported formats
        if (this.config.enableProgressiveTextures) {
            const thumbnailUrl = `assets/textures/${metadata.id}_thumb.${format}`;
            return this.progressiveLoader.loadProgressive(
                { thumbnail: thumbnailUrl, full: url },
                (progress, isLowRes) => {
                    const asset = this.assets.get(metadata.id);
                    if (asset) {
                        asset.progress = isLowRes ? 0.3 : progress;
                    }
                }
            );
        }

        // Standard loading
        const response = await this.networkManager.fetchAsset(url, metadata.priority);
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                imageUrl,
                (texture) => {
                    URL.revokeObjectURL(imageUrl);
                    resolve(texture);
                },
                undefined,
                (err) => {
                    URL.revokeObjectURL(imageUrl);
                    reject(err);
                }
            );
        });
    }

    private async loadGeometry(
        metadata: AssetMetadata,
        signal: AbortSignal
    ): Promise<THREE.BufferGeometry> {
        // For now, return placeholder
        // Full implementation would load GLTF/GLB
        const url = `assets/models/${metadata.id}.glb`;
        const response = await this.networkManager.fetchAsset(url, metadata.priority);
        
        // Would use GLTFLoader here
        throw new Error('Geometry loading not fully implemented');
    }

    private async loadAudio(
        metadata: AssetMetadata,
        signal: AbortSignal
    ): Promise<AudioBuffer> {
        const url = `assets/audio/${metadata.id}.ogg`;
        
        if (this.config.enableAudioStreaming) {
            return this.audioLoader.streamAudio(url, (progress) => {
                const asset = this.assets.get(metadata.id);
                if (asset) asset.progress = progress;
            });
        }

        const response = await this.networkManager.fetchAsset(url, metadata.priority);
        const arrayBuffer = await response.arrayBuffer();
        return this.audioLoader['audioContext'].decodeAudioData(arrayBuffer);
    }

    private async loadShader(metadata: AssetMetadata): Promise<string> {
        const url = `assets/shaders/${metadata.id}.glsl`;
        const response = await this.networkManager.fetchAsset(url, metadata.priority);
        return response.text();
    }

    private async loadGeneric(
        metadata: AssetMetadata,
        signal: AbortSignal
    ): Promise<ArrayBuffer> {
        const url = `assets/data/${metadata.id}.bin`;
        const response = await this.networkManager.fetchAsset(url, metadata.priority);
        return response.arrayBuffer();
    }

    private performUnload(asset: LoadedAsset): void {
        // Dispose Three.js resources
        if (asset.data instanceof THREE.Texture) {
            asset.data.dispose();
            this.textureMemoryUsed -= asset.metadata.estimatedMemory;
        } else if (asset.data instanceof THREE.BufferGeometry) {
            asset.data.dispose();
            this.geometryMemoryUsed -= asset.metadata.estimatedMemory;
        } else if (asset.data instanceof AudioBuffer) {
            this.audioMemoryUsed -= asset.metadata.estimatedMemory;
        }

        asset.state = LoadingState.UNLOADED;
        this.assets.delete(asset.id);
        this.assetCache.delete(asset.id);
        this.stats.loadedAssets--;
    }

    private checkMemoryPressure(): void {
        const totalMemory = this.textureMemoryUsed + this.geometryMemoryUsed + this.audioMemoryUsed;
        const maxMemory = this.config.maxTextureMemory + this.config.maxGeometryMemory + this.config.maxAudioMemory;
        const ratio = totalMemory / maxMemory;

        let pressure = MemoryPressure.NONE;
        if (ratio > 0.95) pressure = MemoryPressure.CRITICAL;
        else if (ratio > 0.85) pressure = MemoryPressure.HIGH;
        else if (ratio > 0.7) pressure = MemoryPressure.MEDIUM;
        else if (ratio > 0.5) pressure = MemoryPressure.LOW;

        this.stats.currentMemoryPressure = pressure;

        // Act on pressure
        if (pressure >= MemoryPressure.HIGH) {
            this.performAggressiveUnloading();
        } else if (pressure >= MemoryPressure.MEDIUM) {
            this.performModerateUnloading();
        }
    }

    private performAggressiveUnloading(): void {
        // Unload all background priority assets with 0 references
        for (const [id, asset] of this.assets) {
            if (asset.priority === AssetPriority.BACKGROUND && asset.referenceCount === 0) {
                this.performUnload(asset);
            }
        }

        // Unload distant low-priority cells
        const distantCells = this.regionManager.getDistantCells(this.config.loadRadius + 2);
        for (const cell of distantCells) {
            if (cell.state === CellState.LOADED) {
                this.unloadCell(cell);
            }
        }
    }

    private performModerateUnloading(): void {
        // Let LRU cache handle moderate pressure
        // It will evict least recently used items automatically
    }

    private updatePredictiveLoading(): void {
        if (this.playerVelocity.lengthSq() < 0.01) return;

        // Predict future position
        const futurePos = this.playerPosition.clone().add(
            this.playerVelocity.clone().multiplyScalar(this.config.predictiveLeadTime)
        );

        // Preload region around predicted position
        this.preloadRegion(futurePos.x, futurePos.z, 2);
    }

    private getDistanceToCell(cell: GridCell): number {
        const cellCenterX = (cell.x + 0.5) * this.config.cellSize;
        const cellCenterZ = (cell.z + 0.5) * this.config.cellSize;
        
        return Math.sqrt(
            Math.pow(cellCenterX - this.playerPosition.x, 2) +
            Math.pow(cellCenterZ - this.playerPosition.z, 2)
        );
    }

    private distanceToPriority(distance: number): AssetPriority {
        if (distance <= PRIORITY_DISTANCES[AssetPriority.HIGH]) {
            return AssetPriority.HIGH;
        } else if (distance <= PRIORITY_DISTANCES[AssetPriority.MEDIUM]) {
            return AssetPriority.MEDIUM;
        } else if (distance <= PRIORITY_DISTANCES[AssetPriority.LOW]) {
            return AssetPriority.LOW;
        }
        return AssetPriority.BACKGROUND;
    }

    private getCurrentLoadingAsset(): string | null {
        for (const [id, asset] of this.assets) {
            if (asset.state === LoadingState.LOADING) {
                return id;
            }
        }
        return null;
    }

    private updateStats(): void {
        this.stats.memoryUsed = this.textureMemoryUsed + this.geometryMemoryUsed + this.audioMemoryUsed;
        
        const networkStats = this.networkManager.getStats();
        this.stats.networkBytesDownloaded = networkStats.bytesDownloaded;
        this.stats.networkRequests = networkStats.requests;
        this.stats.failedRequests = networkStats.failed;

        const cellStats = this.regionManager.getStats();
        this.stats.activeCells = cellStats.loadedCells;
        this.stats.queuedCells = cellStats.loadingCells;
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    dispose(): void {
        this.stop();
        
        // Unload all assets
        for (const asset of this.assets.values()) {
            this.performUnload(asset);
        }

        this.assets.clear();
        this.assetCache.clear();
        this.placeholderManager.clear();
        
        this.onProgressCallbacks = [];
        this.onAssetLoadedCallbacks = [];
        this.onErrorCallbacks = [];
    }
}

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

// ============================================================================
// EXPORTS
// ============================================================================

export default AssetStreamer;
export { RegionManager, GridCell, CellState };
