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
import { RegionManager, GridCell, CellState } from '../region-manager.ts';
import {
    AssetPriority,
    AssetType,
    TextureFormat,
    LoadState,
    QualityLevel,
    MemoryPressure,
    AssetMetadata,
    AssetManifest,
    LoadedAsset,
    LoadingProgress,
    StreamingConfig,
    StreamingStats,
    AssetRequest,
    AssetBatch,
    DEFAULT_STREAMING_CONFIG,
    PRIORITY_DISTANCES,
    QUALITY_FORMAT_PREFERENCES
} from './asset-streaming-types.ts';
import { LRUCache, NetworkManager } from './asset-loading-infrastructure.ts';

const _scratchFuturePos = new THREE.Vector3();

// ============================================================================
// SPECIALIZED LOADERS
// ============================================================================

/**
 * Loads textures progressively - low resolution first, then refines.
 * Similar to progressive JPEG loading for better perceived performance.
 */
export class ProgressiveTextureLoader {
    private textureLoader: THREE.TextureLoader;
    private ktx2Loader?: unknown;  // Would be THREE.KTX2Loader if available

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
        // Type assertion needed since ktx2Loader is unknown type
        return (this.ktx2Loader as { loadAsync(url: string): Promise<THREE.CompressedTexture> }).loadAsync(url);
    }
}

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

/**
 * Loads geometry with LOD variants.
 * Simpler mesh arrives first, complex mesh refines it.
 */
export class GeometryLODLoader {
    private gltfLoader?: unknown;  // Would be THREE.GLTFLoader

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
    private loadingQueue: AssetRequest[] = [];
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
    // CONFIGURATION
    // ========================================================================

    /**
     * Update streaming configuration.
     */
    configure(config: Partial<StreamingConfig>): void {
        this.config = { ...this.config, ...config };
        
        // Recreate network manager if concurrent requests changed
        if (config.maxConcurrentRequests !== undefined || 
            config.retryAttempts !== undefined ||
            config.retryDelayMs !== undefined) {
            this.networkManager = new NetworkManager(this.config);
        }
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
        if (cached && cached.state === LoadState.LOADED) {
            cached.lastUsed = performance.now();
            cached.referenceCount++;
            this.stats.cacheHits++;
            return cached;
        }

        // Check if currently loading
        const existing = this.assets.get(id);
        if (existing && existing.state === LoadState.LOADING) {
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
     * Load a batch of assets together.
     */
    async loadBatch(batch: AssetBatch): Promise<LoadedAsset[]> {
        const { ids, priority, onProgress } = batch;
        const results: LoadedAsset[] = [];
        const errors: Error[] = [];
        let loaded = 0;

        const promises = ids.map(async (id) => {
            try {
                const asset = await this.loadAsset(id, priority);
                results.push(asset);
                loaded++;
                onProgress?.(loaded, ids.length);
                return asset;
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                errors.push(err);
                throw err;
            }
        });

        await Promise.all(promises);
        
        if (errors.length > 0 && batch.onError) {
            batch.onError(errors);
        }
        
        if (batch.onComplete) {
            batch.onComplete(results);
        }
        
        return results;
    }

    /**
     * Get an already loaded asset.
     * Returns undefined if not loaded.
     */
    getAsset(id: string): LoadedAsset | undefined {
        const asset = this.assetCache.get(id);
        if (asset && asset.state === LoadState.LOADED) {
            asset.lastUsed = performance.now();
            asset.referenceCount++;
            return asset;
        }
        return undefined;
    }

    /**
     * Release a reference to an asset.
     * Decrements reference count, actual unload happens when count reaches 0
     * and memory pressure requires it (or immediately if force=true).
     */
    releaseAsset(id: string, force: boolean = false): void {
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
            if (asset.state === LoadState.LOADED) {
                bytesLoaded += asset.metadata.size;
                assetsLoaded++;
            } else if (asset.state === LoadState.STREAMING) {
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
    // PRIORITY MANAGEMENT
    // ========================================================================

    /**
     * Change the priority of a queued asset.
     */
    setAssetPriority(id: string, priority: AssetPriority): void {
        const request = this.loadingQueue.find(r => r.id === id);
        if (request) {
            request.priority = priority;
            // Re-sort queue
            this.loadingQueue.sort((a, b) => a.priority - b.priority);
        }
    }

    /**
     * Get the current priority of an asset in queue.
     */
    getAssetPriority(id: string): AssetPriority | undefined {
        const request = this.loadingQueue.find(r => r.id === id);
        return request?.priority;
    }

    // ========================================================================
    // MEMORY MANAGEMENT
    // ========================================================================

    /**
     * Force memory pressure check and cleanup.
     */
    forceMemoryCleanup(): void {
        this.checkMemoryPressure();
        
        // If still high, perform aggressive unloading
        if (this.stats.currentMemoryPressure >= MemoryPressure.HIGH) {
            this.performAggressiveUnloading();
        }
    }

    /**
     * Get current memory usage breakdown.
     */
    getMemoryUsage(): { texture: number; geometry: number; audio: number; total: number } {
        return {
            texture: this.textureMemoryUsed,
            geometry: this.geometryMemoryUsed,
            audio: this.audioMemoryUsed,
            total: this.textureMemoryUsed + this.geometryMemoryUsed + this.audioMemoryUsed
        };
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
            this.releaseAsset(id);
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
            state: LoadState.LOADING,
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

            asset.state = LoadState.LOADED;
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
            asset.state = LoadState.ERROR;
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

        asset.state = LoadState.UNLOADED;
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
            if (asset.metadata.priority === AssetPriority.BACKGROUND && asset.referenceCount === 0) {
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

        // ⚡ OPTIMIZATION: Zero-allocation predictive loading to prevent GC spikes
        _scratchFuturePos.copy(this.playerVelocity)
            .multiplyScalar(this.config.predictiveLeadTime)
            .add(this.playerPosition);

        // Preload region around predicted position
        this.preloadRegion(_scratchFuturePos.x, _scratchFuturePos.z, 2);
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
            if (asset.state === LoadState.LOADING) {
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

export default AssetStreamer;
