/**
 * @file examples/asset-streaming-usage.ts
 * @description Example usage of the Asset Streaming System
 * 
 * This file demonstrates how to integrate the streaming system
 * into the candy_world game.
 */

import {
    AssetStreamer,
    AssetPriority,
    QualityLevel,
    RegionManager,
    createSampleManifest
} from '../systems';

import * as THREE from 'three';

// ============================================================================
// EXAMPLE 1: Basic Setup
// ============================================================================

export function setupAssetStreaming(scene: THREE.Scene, audioContext?: AudioContext): AssetStreamer {
    // Create or load your asset manifest
    const manifest = createSampleManifest();
    
    // Or load from JSON file:
    // const manifest = await (await fetch('assets/manifest.json')).json();

    // Create the streamer
    const streamer = new AssetStreamer(
        scene,
        manifest,
        {
            cellSize: 50,              // 50m grid cells
            loadRadius: 3,             // Load 3 cells around player
            unloadRadius: 5,           // Unload cells beyond 5 cells
            unloadDelayMs: 10000,      // 10 second delay before unload
            
            maxTextureMemory: 512 * 1024 * 1024,    // 512 MB
            maxGeometryMemory: 256 * 1024 * 1024,   // 256 MB
            maxAudioMemory: 64 * 1024 * 1024,       // 64 MB
            
            enableProgressiveTextures: true,
            enablePredictiveLoading: true,
            enableAudioStreaming: true,
            predictiveLeadTime: 5       // Preload 5 seconds ahead
        },
        audioContext
    );

    // Set up event handlers
    streamer.onProgress((progress) => {
        console.log(`Loading: ${progress.percent}%`);
        console.log(`Current: ${progress.currentAsset}`);
        console.log(`Estimated time: ${progress.estimatedTimeRemaining}s`);
    });

    streamer.onAssetLoaded((asset) => {
        console.log(`Asset loaded: ${asset.id} (${asset.loadTime}ms)`);
    });

    streamer.onError((error, assetId) => {
        console.error(`Failed to load ${assetId}:`, error);
    });

    // Start streaming
    streamer.start();

    return streamer;
}

// ============================================================================
// EXAMPLE 2: Game Loop Integration
// ============================================================================

export class GameWorld {
    private streamer: AssetStreamer;
    private player: THREE.Object3D;
    private scene: THREE.Scene;

    constructor(scene: THREE.Scene, player: THREE.Object3D, streamer: AssetStreamer) {
        this.scene = scene;
        this.player = player;
        this.streamer = streamer;
    }

    update(deltaTime: number): void {
        // Update player position for streaming
        const pos = this.player.position;
        this.streamer.setPlayerPosition(pos.x, pos.y, pos.z);

        // Get loading progress for UI
        const progress = this.streamer.getLoadingProgress();
        this.updateLoadingUI(progress);
    }

    private updateLoadingUI(progress: LoadingProgress): void {
        // Update loading bar, etc.
        // document.getElementById('loading-bar').style.width = `${progress.percent}%`;
    }

    async loadImportantAsset(assetId: string): Promise<void> {
        // Load a specific asset with high priority
        const asset = await this.streamer.loadAsset(assetId, AssetPriority.HIGH);
        
        if (asset.data instanceof THREE.Texture) {
            // Apply texture to material
        } else if (asset.data instanceof THREE.BufferGeometry) {
            // Create mesh with geometry
        }
    }

    preloadArea(x: number, z: number): void {
        // Preload region around a position (e.g., teleport destination)
        this.streamer.preloadRegion(x, z, 2);
    }

    adaptQuality(): void {
        // Adjust quality based on performance
        const stats = this.streamer.getStats();
        
        if (stats.currentMemoryPressure === 'critical') {
            this.streamer.setQualityLevel(QualityLevel.LOW);
        } else if (stats.networkBytesDownloaded > 100 * 1024 * 1024) {
            // Heavy network usage, reduce quality
            this.streamer.setQualityLevel(QualityLevel.MEDIUM);
        }
    }

    dispose(): void {
        this.streamer.dispose();
    }
}

// ============================================================================
// EXAMPLE 3: Region Manager Direct Usage
// ============================================================================

export function setupRegionManager(): RegionManager {
    const regionManager = new RegionManager({
        cellSize: 50,
        loadRadius: 3,
        unloadRadius: 5,
        unloadDelayMs: 10000,
        enableSeamlessTransitions: true
    });

    // Register cells with assets
    regionManager.registerCell(0, 0, ['tree_01', 'rock_01', 'grass_01']);
    regionManager.registerCell(1, 0, ['tree_02', 'flower_01']);
    regionManager.registerCell(0, 1, ['cabin_01', 'fence_01']);

    // Set up callbacks
    regionManager.onStateChange((cell, oldState, newState) => {
        console.log(`Cell ${cell.key}: ${oldState} → ${newState}`);
        
        if (newState === 'loaded') {
            // Spawn objects in this cell
            spawnCellObjects(cell);
        } else if (newState === 'unloaded') {
            // Remove objects from this cell
            despawnCellObjects(cell);
        }
    });

    regionManager.onLODTransition((transition) => {
        console.log(`Cell ${transition.cell.key} LOD: ${transition.fromLOD} → ${transition.toLOD}`);
        // Smoothly transition LOD levels
    });

    // Update with player position
    function onPlayerMove(x: number, z: number) {
        regionManager.updatePlayerPosition(x, z);
    }

    return regionManager;
}

function spawnCellObjects(cell: import('../systems').GridCell): void {
    // Spawn objects for this cell
    console.log(`Spawning ${cell.assetIds.length} objects in cell ${cell.key}`);
}

function despawnCellObjects(cell: import('../systems').GridCell): void {
    // Remove objects for this cell
    console.log(`Despawning objects in cell ${cell.key}`);
}

// ============================================================================
// EXAMPLE 4: Memory Pressure Handling
// ============================================================================

export function setupMemoryMonitoring(streamer: AssetStreamer): void {
    // Check memory pressure periodically
    setInterval(() => {
        const stats = streamer.getStats();
        
        console.log('Streaming Stats:', {
            loadedAssets: stats.loadedAssets,
            memoryUsed: `${(stats.memoryUsed / 1024 / 1024).toFixed(1)} MB`,
            pressure: stats.currentMemoryPressure,
            activeCells: stats.activeCells
        });

        // React to memory pressure
        switch (stats.currentMemoryPressure) {
            case 'critical':
                console.warn('Critical memory pressure! Unloading distant cells.');
                streamer.setQualityLevel(QualityLevel.LOW);
                break;
            case 'high':
                console.warn('High memory pressure. Reducing quality.');
                streamer.setQualityLevel(QualityLevel.MEDIUM);
                break;
        }
    }, 5000);  // Check every 5 seconds
}

// ============================================================================
// EXAMPLE 5: Progressive Loading with Fallbacks
// ============================================================================

export async function loadWithFallback(
    streamer: AssetStreamer,
    assetId: string,
    timeoutMs: number = 5000
): Promise<import('../systems').LoadedAsset | null> {
    
    return new Promise((resolve) => {
        let resolved = false;

        // Set timeout for fallback
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                console.warn(`Asset ${assetId} load timeout, using fallback`);
                streamer.setQualityLevel(QualityLevel.LOW);
                resolve(null);
            }
        }, timeoutMs);

        // Attempt to load
        streamer.loadAsset(assetId, AssetPriority.HIGH)
            .then((asset) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(asset);
                }
            })
            .catch((error) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    console.error(`Failed to load ${assetId}:`, error);
                    resolve(null);
                }
            });
    });
}

// ============================================================================
// EXAMPLE 6: Complete Integration
// ============================================================================

export async function initializeGame(): Promise<void> {
    const scene = new THREE.Scene();
    const player = new THREE.Object3D();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    // 1. Set up asset streaming
    const streamer = setupAssetStreaming(scene, audioContext);

    // 2. Create game world
    const world = new GameWorld(scene, player, streamer);

    // 3. Set up memory monitoring
    setupMemoryMonitoring(streamer);

    // 4. Load critical assets first
    await streamer.loadAsset('player_model', AssetPriority.CRITICAL);
    await streamer.loadAsset('core_shaders', AssetPriority.CRITICAL);

    // 5. Start game loop
    function gameLoop() {
        requestAnimationFrame(gameLoop);
        
        // Update player position (would come from input/physics)
        // player.position.add(velocity);
        
        // Update streaming
        world.update(1/60);
    }

    gameLoop();

    // 6. Handle page unload
    window.addEventListener('beforeunload', () => {
        world.dispose();
    });
}

// Import for types
import type { LoadingProgress } from '../systems';
