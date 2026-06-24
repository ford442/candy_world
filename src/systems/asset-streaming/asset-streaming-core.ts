/**
 * @file asset-streaming-core.ts
 * @description Core asset streaming orchestrator and main AssetStreamer class
 * 
 * This module contains the main AssetStreamer class which coordinates all streaming subsystems:
 * - RegionManager for grid cell management and spatial organization
 * - LRUCache for memory management and asset eviction
 * - NetworkManager for optimized HTTP/2 loading with retry logic
 * - Specialized loaders (ProgressiveTextureLoader, AudioStreamingLoader, GeometryLODLoader)
 * - PlaceholderManager for graceful fallback rendering
 * 
 * The AssetStreamer is the primary entry point for asset streaming. It manages:
 * - Priority-based loading queues (CRITICAL → BACKGROUND priority levels)
 * - Memory pressure responses with aggressive unloading strategies
 * - Quality level transitions based on available bandwidth
 * - Loading statistics and progress reporting
 * - Batch asset operations for efficiency
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
    PRIORITY_DISTANCES_SQ,
    QUALITY_FORMAT_PREFERENCES
} from './asset-streaming-types.ts';
import { LRUCache, NetworkManager } from './asset-loading-infrastructure.ts';
import {
    ProgressiveTextureLoader,
    AudioStreamingLoader,
    GeometryLODLoader,
    PlaceholderManager
} from './asset-streaming-loader.ts';

const _scratchFuturePos = new THREE.Vector3();

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
     * Load a single asset with priority.
     */
    async loadAsset(assetId: string, priority: AssetPriority = AssetPriority.NORMAL): Promise<LoadedAsset> {
        if (this.assets.has(assetId)) {
            this.stats.cacheHits++;
            return this.assets.get(assetId)!;
        }

        const manifest = this.manifest.assets[assetId];
        if (!manifest) throw new Error(`Asset not in manifest: ${assetId}`);

        this.stats.cacheMisses++;

        const request: AssetRequest = {
            id: crypto.randomUUID(),
            assetId,
            priority,
            timestamp: Date.now(),
            retries: 0,
            state: LoadState.PENDING
        };

        return new Promise((resolve, reject) => {
            const originalReject = reject;
            reject = (error: Error) => {
                this.onErrorCallbacks.forEach(cb => cb(error, assetId));
                originalReject(error);
            };

            this.loadingQueue.push(request);
            this.loadingQueue.sort((a, b) => b.priority - a.priority);

            // Timeout for ultra-slow connections
            const timeout = setTimeout(() => {
                reject(new Error(`Asset load timeout: ${assetId}`));
                this.activeLoads.delete(assetId);
            }, this.config.requestTimeoutMs);

            // Monitor load
            const onLoaded = (asset: LoadedAsset) => {
                if (asset.id === assetId) {
                    clearTimeout(timeout);
                    this.onAssetLoadedCallbacks = this.onAssetLoadedCallbacks.filter(cb => cb !== onLoaded);
                    resolve(asset);
                }
            };

            this.onAssetLoadedCallbacks.push(onLoaded);
        });
    }

    /**
     * Load multiple assets in a batch.
     */
    async loadBatch(batch: AssetBatch): Promise<LoadedAsset[]> {
        const loads: Promise<LoadedAsset>[] = [];
        for (let i = 0; i < batch.assetIds.length; i++) {
            loads.push(this.loadAsset(batch.assetIds[i], batch.priority));
        }
        return Promise.all(loads);
    }

    /**
     * Get a loaded asset from cache.
     */
    getAsset(assetId: string): LoadedAsset | null {
        return this.assets.get(assetId) || null;
    }

    /**
     * Release an asset and attempt to free memory.
     */
    releaseAsset(assetId: string): void {
        const asset = this.assets.get(assetId);
        if (!asset) return;

        // Dispose of THREE.js resources
        if (asset.type === AssetType.TEXTURE && asset.data instanceof THREE.Texture) {
            asset.data.dispose();
        } else if (asset.type === AssetType.GEOMETRY && asset.data instanceof THREE.BufferGeometry) {
            asset.data.dispose();
        }

        this.assets.delete(assetId);
        this.assetCache.remove(assetId);

        // Update memory tracking
        if (asset.type === AssetType.TEXTURE) {
            this.textureMemoryUsed = Math.max(0, this.textureMemoryUsed - asset.metadata.estimatedMemory);
        } else if (asset.type === AssetType.GEOMETRY) {
            this.geometryMemoryUsed = Math.max(0, this.geometryMemoryUsed - asset.metadata.estimatedMemory);
        } else if (asset.type === AssetType.AUDIO) {
            this.audioMemoryUsed = Math.max(0, this.audioMemoryUsed - asset.metadata.estimatedMemory);
        }
    }

    /**
     * Preload all assets in a region without loading to scene.
     */
    async preloadRegion(cellX: number, cellZ: number, radius: number): Promise<void> {
        const cells = this.regionManager.getCellsInRadius(cellX, cellZ, radius);
        for (const cell of cells) {
            const assets = this.manifest.assets;
            for (const [assetId, meta] of Object.entries(assets)) {
                if (meta.cell.x === cell.x && meta.cell.z === cell.z) {
                    await this.loadAsset(assetId, AssetPriority.LOW);
                }
            }
        }
    }

    /**
     * Get current loading progress.
     */
    getLoadingProgress(): LoadingProgress {
        return {
            totalAssets: this.stats.totalAssets,
            loadedAssets: this.stats.loadedAssets,
            loadingAssets: this.stats.loadingAssets,
            pendingAssets: this.stats.pendingAssets,
            percentComplete: this.stats.totalAssets > 0 
                ? this.stats.loadedAssets / this.stats.totalAssets 
                : 0,
            estimatedTimeRemaining: this.estimateLoadTime()
        };
    }

    /**
     * Set quality level for streaming (affects texture resolution, geometry LOD).
     */
    setQualityLevel(level: QualityLevel): void {
        this.config.qualityLevel = level;
        
        // Reload textures if quality changed
        for (const asset of this.assets.values()) {
            if (asset.type === AssetType.TEXTURE) {
                // Reload with new quality
                const manifest = this.manifest.assets[asset.id];
                if (manifest.formats) {
                    const preferredFormat = QUALITY_FORMAT_PREFERENCES[level];
                    if (preferredFormat && manifest.formats[preferredFormat]) {
                        this.loadAsset(asset.id, AssetPriority.HIGH);
                    }
                }
            }
        }
    }

    /**
     * Update player position for proximity-based loading.
     */
    setPlayerPosition(x: number, y: number, z: number): void {
        this.playerPosition.set(x, y, z);
        
        // Detect velocity (simple delta)
        if (this.lastUpdateTime > 0) {
            const dt = (Date.now() - this.lastUpdateTime) / 1000;
            this.playerVelocity.subVectors(this.playerPosition, this.playerPosition).divideScalar(dt);
        }
        this.lastUpdateTime = Date.now();
    }

    /**
     * Get streaming statistics.
     */
    getStats(): Readonly<StreamingStats> {
        return Object.freeze({ ...this.stats });
    }

    /**
     * Register progress callback.
     */
    onProgress(callback: (progress: LoadingProgress) => void): () => void {
        this.onProgressCallbacks.push(callback);
        return () => {
            this.onProgressCallbacks = this.onProgressCallbacks.filter(cb => cb !== callback);
        };
    }

    /**
     * Register asset loaded callback.
     */
    onAssetLoaded(callback: (asset: LoadedAsset) => void): () => void {
        this.onAssetLoadedCallbacks.push(callback);
        return () => {
            this.onAssetLoadedCallbacks = this.onAssetLoadedCallbacks.filter(cb => cb !== callback);
        };
    }

    /**
     * Register error callback.
     */
    onError(callback: (error: Error, assetId: string) => void): () => void {
        this.onErrorCallbacks.push(callback);
        return () => {
            this.onErrorCallbacks = this.onErrorCallbacks.filter(cb => cb !== callback);
        };
    }

    // ========================================================================
    // PRIORITY MANAGEMENT
    // ========================================================================

    /**
     * Update asset priority based on context (time-based or player state).
     */
    private updateAssetPriorities(): void {
        const now = Date.now();
        for (const request of this.loadingQueue) {
            const age = now - request.timestamp;
            
            // Gradually increase priority for stale requests
            if (age > 5000) {
                request.priority = Math.min(request.priority + 1, AssetPriority.CRITICAL);
            }
        }
        
        // Re-sort queue
        this.loadingQueue.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Calculate predicted future position for predictive loading.
     */
    private getPredictedPlayerPosition(dt: number): THREE.Vector3 {
        return _scratchFuturePos
            .copy(this.playerPosition)
            .addScaledVector(this.playerVelocity, dt);
    }

    // ========================================================================
    // MEMORY MANAGEMENT
    // ========================================================================

    /**
     * Check memory pressure and respond aggressively if needed.
     */
    private checkMemoryPressure(): void {
        const totalMemory = this.textureMemoryUsed + this.geometryMemoryUsed + this.audioMemoryUsed;
        this.stats.memoryUsed = totalMemory;

        if (totalMemory > this.config.maxMemoryMb * 0.9) {
            this.stats.currentMemoryPressure = MemoryPressure.CRITICAL;
            this.handleMemoryPressure(MemoryPressure.CRITICAL);
        } else if (totalMemory > this.config.maxMemoryMb * 0.7) {
            this.stats.currentMemoryPressure = MemoryPressure.HIGH;
            this.handleMemoryPressure(MemoryPressure.HIGH);
        } else if (totalMemory > this.config.maxMemoryMb * 0.5) {
            this.stats.currentMemoryPressure = MemoryPressure.MODERATE;
            this.handleMemoryPressure(MemoryPressure.MODERATE);
        } else {
            this.stats.currentMemoryPressure = MemoryPressure.NONE;
        }
    }

    /**
     * Respond to memory pressure by unloading non-critical assets.
     */
    private handleMemoryPressure(pressure: MemoryPressure): void {
        if (pressure === MemoryPressure.NONE) return;

        // Unload background priority assets under any pressure
        for (const request of this.loadingQueue) {
            if (request.priority === AssetPriority.BACKGROUND) {
                this.releaseAsset(request.assetId);
            }
        }

        if (pressure === MemoryPressure.HIGH) {
            // Also unload low priority
            for (const request of this.loadingQueue) {
                if (request.priority === AssetPriority.LOW) {
                    this.releaseAsset(request.assetId);
                }
            }
        } else if (pressure === MemoryPressure.CRITICAL) {
            // Unload everything except critical
            for (const request of this.loadingQueue) {
                if (request.priority !== AssetPriority.CRITICAL) {
                    this.releaseAsset(request.assetId);
                }
            }
        }
    }

    // ========================================================================
    // UPDATE LOOP & REGION LOADING
    // ========================================================================

    /**
     * Main streaming update loop.
     */
    private updateLoop(): void {
        if (!this.isRunning) return;

        this.updateAssetPriorities();
        this.loadNextAssets();
        this.checkMemoryPressure();
        this.updateRegionLoading();
        
        // Report progress
        const progress = this.getLoadingProgress();
        this.onProgressCallbacks.forEach(cb => cb(progress));

        // Schedule next update
        requestAnimationFrame(() => this.updateLoop());
    }

    /**
     * Load next batch of assets from queue.
     */
    private loadNextAssets(): void {
        const concurrentLimit = this.config.maxConcurrentRequests;
        const currentLoading = this.activeLoads.size;
        const available = Math.max(0, concurrentLimit - currentLoading);

        for (let i = 0; i < available && this.loadingQueue.length > 0; i++) {
            const request = this.loadingQueue.shift()!;
            this.loadAssetInternal(request);
        }
    }

    /**
     * Load individual asset from request.
     */
    private async loadAssetInternal(request: AssetRequest): Promise<void> {
        const assetId = request.assetId;
        const manifest = this.manifest.assets[assetId];

        if (!manifest) {
            this.stats.errorAssets++;
            this.onErrorCallbacks.forEach(cb => 
                cb(new Error(`Asset not in manifest: ${assetId}`), assetId)
            );
            return;
        }

        request.state = LoadState.LOADING;
        this.stats.loadingAssets++;

        const controller = new AbortController();
        this.activeLoads.set(assetId, controller);

        try {
            const asset = await this.loadAssetPipeline(assetId, manifest, controller.signal);
            
            this.assets.set(assetId, asset);
            this.assetCache.set(assetId, asset);
            
            request.state = LoadState.LOADED;
            this.stats.loadedAssets++;
            
            this.onAssetLoadedCallbacks.forEach(cb => cb(asset));
        } catch (error) {
            request.retries++;
            if (request.retries < this.config.retryAttempts) {
                // Re-queue with delay
                setTimeout(() => {
                    this.loadingQueue.push(request);
                    this.loadingQueue.sort((a, b) => b.priority - a.priority);
                }, this.config.retryDelayMs);
            } else {
                request.state = LoadState.ERROR;
                this.stats.errorAssets++;
                this.onErrorCallbacks.forEach(cb => cb(error as Error, assetId));
            }
        } finally {
            this.stats.loadingAssets--;
            this.activeLoads.delete(assetId);
        }
    }

    /**
     * Update region-based loading and culling.
     */
    private updateRegionLoading(): void {
        const playerCell = this.regionManager.getCellAtPosition(
            this.playerPosition.x,
            this.playerPosition.z
        );

        // Get cells within streaming radius
        const priorityCells = this.regionManager.getCellsInRadius(
            playerCell.x,
            playerCell.z,
            this.config.streamingRadiusCells
        );

        this.stats.activeCells = priorityCells.length;

        // Mark cells as active/inactive
        for (const cell of this.regionManager.getAllCells()) {
            const isActive = priorityCells.some(c => c.x === cell.x && c.z === cell.z);
            cell.state = isActive ? CellState.ACTIVE : CellState.INACTIVE;
        }
    }

    // ========================================================================
    // ASSET LOADING PIPELINE
    // ========================================================================

    /**
     * Main asset loading pipeline - routes to specialized loaders.
     */
    private async loadAssetPipeline(
        assetId: string,
        manifest: AssetMetadata,
        signal: AbortSignal
    ): Promise<LoadedAsset> {
        const startTime = Date.now();

        let data;
        const type = manifest.type;

        if (type === AssetType.TEXTURE) {
            data = await this.loadTextureAsset(manifest, signal);
        } else if (type === AssetType.GEOMETRY) {
            data = await this.loadGeometryAsset(manifest, signal);
        } else if (type === AssetType.AUDIO) {
            data = await this.loadAudioAsset(manifest, signal);
        } else if (type === AssetType.PLACEHOLDER) {
            data = this.placeholderManager.getPlaceholder(manifest.subType as string);
        } else {
            throw new Error(`Unknown asset type: ${type}`);
        }

        const loadTime = Date.now() - startTime;
        this.stats.networkRequests++;

        // Update average load time
        if (this.stats.avgLoadTime === 0) {
            this.stats.avgLoadTime = loadTime;
        } else {
            this.stats.avgLoadTime = (this.stats.avgLoadTime * 0.9) + (loadTime * 0.1);
        }

        return {
            id: assetId,
            type,
            data,
            metadata: manifest,
            loadTime,
            cached: false
        };
    }

    /**
     * Load texture asset with progressive loading.
     */
    private async loadTextureAsset(
        manifest: AssetMetadata,
        signal: AbortSignal
    ): Promise<THREE.Texture> {
        const format = QUALITY_FORMAT_PREFERENCES[this.config.qualityLevel];
        const url = manifest.url || '';

        let texture;
        if (manifest.progressive) {
            texture = await this.progressiveLoader.loadProgressive(
                url,
                manifest.formats?.[format] || url,
                signal
            );
        } else if (manifest.compressed) {
            texture = await this.progressiveLoader.loadCompressed(
                manifest.formats || {},
                signal
            );
        } else {
            // Fallback: load as standard THREE texture
            const loader = new THREE.TextureLoader();
            texture = await loader.loadAsync(url, undefined, undefined, signal);
        }

        this.textureMemoryUsed += manifest.estimatedMemory;
        return texture;
    }

    /**
     * Load geometry asset with LOD support.
     */
    private async loadGeometryAsset(
        manifest: AssetMetadata,
        signal: AbortSignal
    ): Promise<THREE.BufferGeometry> {
        const geometry = await this.geometryLoader.loadLOD(
            manifest.url || '',
            this.config.qualityLevel,
            signal
        );
        this.geometryMemoryUsed += manifest.estimatedMemory;
        return geometry;
    }

    /**
     * Load audio asset with streaming.
     */
    private async loadAudioAsset(
        manifest: AssetMetadata,
        signal: AbortSignal
    ): Promise<AudioBuffer> {
        if (!this.audioLoader) {
            throw new Error('Audio context not initialized');
        }
        const buffer = await this.audioLoader.streamAudio(
            manifest.url || '',
            signal
        );
        this.audioMemoryUsed += manifest.estimatedMemory;
        return buffer;
    }

    /**
     * Estimate time remaining based on current load rates.
     */
    private estimateLoadTime(): number {
        if (this.stats.avgLoadTime === 0 || this.stats.pendingAssets === 0) {
            return 0;
        }
        return (this.stats.pendingAssets * this.stats.avgLoadTime) / this.stats.loadingAssets;
    }
}
