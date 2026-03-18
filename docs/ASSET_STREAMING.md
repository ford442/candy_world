# Asset Streaming System

## Overview

The Asset Streaming System enables **infinite world sizes without infinite loading times** for candy_world. Instead of loading all assets at startup, assets are streamed dynamically based on player position, priority, and system resources.

## Key Benefits

- **Fast Startup**: Load only critical assets initially (<3 seconds)
- **Scalable Worlds**: Support worlds of any size through streaming
- **Adaptive Quality**: Adjust quality based on bandwidth and hardware
- **Memory Efficient**: LRU cache with aggressive unloading
- **Seamless Experience**: No visible loading screens or popping

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AssetStreamer (Main Controller)                   │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────┐   │
│  │ RegionManager │  │  LRU Cache    │  │    NetworkManager     │   │
│  │  (Grid Cells) │  │ (Memory Mgmt) │  │ (HTTP/2, Retry, etc.) │   │
│  └───────────────┘  └───────────────┘  └───────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                      Specialized Loaders                             │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐    │
│  │ProgressiveTexture│ │AudioStreaming    │ │  GeometryLOD     │    │
│  │Loader            │ │Loader            │ │  Loader          │    │
│  │(Low→High res)    │ │(Play while dl)   │ │(Simple→Complex)  │    │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Asset Manifest (JSON)                           │
│  • Asset metadata (size, checksum, dependencies)                     │
│  • Grid cell mappings ("0,0" → [asset1, asset2])                     │
│  • Format variants (AVIF → WebP → PNG fallback)                      │
│  • LOD variants (high → medium → low detail)                         │
└─────────────────────────────────────────────────────────────────────┘
```

## Asset Categories and Priorities

| Priority | Distance | Assets | Load Strategy |
|----------|----------|--------|---------------|
| **CRITICAL** | 0m | Core shaders, player model, immediate terrain | Immediate, block startup |
| **HIGH** | <50m | Nearby foliage, UI textures | Load within 1 second |
| **MEDIUM** | 50-150m | Distant scenery, ambient audio | Load within 5 seconds |
| **LOW** | 150-300m | Far terrain, optional decorations | Background loading |
| **BACKGROUND** | 300m+ | Preload next likely areas | Idle time only |

## Streaming Regions

World divided into 50×50m grid cells:

```
Player at cell (2,1) with loadRadius=2, unloadRadius=3

    0   1   2   3   4   5
  ┌───┬───┬───┬───┬───┐
0 │ L │ L │ L │ L │   │    L = LOADED (within loadRadius)
  ├───┼───┼───┼───┼───┤      B = BUFFER (within unloadRadius)
1 │ L │ L │ P │ L │   │      U = UNLOADED (outside both)
  ├───┼───┼───┼───┼───┤      P = PLAYER position
2 │ L │ L │ L │ L │   │
  ├───┼───┼───┼───┼───┤
3 │ B │ B │ B │ B │ U │
  └───┴───┴───┴───┴───┘
```

### Cell Lifecycle

```
UNLOADED → QUEUED → LOADING → LOADED → UNLOADING → UNLOADED
    │          │         │          │           │
    │          │         │          │           └─ Unload delay expired
    │          │         │          └─ Schedule with delay
    │          │         └─ All assets loaded
    │          └─ Waiting for loader capacity
    └─ Outside all radii
```

## Asset Manifest Format

```json
{
  "version": "1.0.0",
  "totalSize": 1073741824,
  "assets": {
    "tree_oak_01": {
      "id": "tree_oak_01",
      "type": "geometry",
      "priority": "medium",
      "size": 5242880,
      "checksum": "sha256:a1b2c3...",
      "dependencies": ["bark_texture", "leaf_texture"],
      "lodVariants": ["tree_oak_01_high", "tree_oak_01_low"],
      "streamingSupported": true,
      "estimatedMemory": 20971520,
      "cellX": 2,
      "cellZ": 3
    },
    "bark_texture": {
      "id": "bark_texture",
      "type": "texture",
      "priority": "medium",
      "size": 1048576,
      "formats": ["ktx2", "webp", "png"],
      "dependencies": [],
      "streamingSupported": true
    }
  },
  "cells": {
    "2,3": ["tree_oak_01", "tree_pine_02", "grass_patch_01"],
    "2,4": ["rock_formation_01", "flower_patch_03"]
  },
  "dependencyGraph": {
    "tree_oak_01": ["bark_texture", "leaf_texture"],
    "bark_texture": ["bark_normal_map"]
  }
}
```

## Memory Management

### LRU Cache

```typescript
// Assets automatically evicted based on last access time
// Least Recently Used removed first when memory pressure
const cache = new LRUCache<string, LoadedAsset>(
    maxSizeBytes,
    (asset) => asset.metadata.estimatedMemory
);
```

### Memory Pressure Response

| Pressure Level | Memory Used | Action |
|----------------|-------------|--------|
| NONE | <50% | Normal operation |
| LOW | 50-70% | Reduce cache size |
| MEDIUM | 70-85% | Unload distant cells |
| HIGH | 85-95% | Aggressive unloading, skip LOD transitions |
| CRITICAL | >95% | Emergency unload, disable streaming |

## Loading Strategies

### Progressive Textures

```typescript
// Low-res loads first (instant), high-res refines
const texture = await progressiveLoader.loadProgressive({
    thumbnail: "tree_64px.webp",      // 4KB, loads in 10ms
    full: "tree_2048px.avif"          // 512KB, loads in 200ms
});
```

### Geometry LOD Streaming

```typescript
// Simple mesh arrives first, complex refines
const geometry = await geometryLoader.loadLOD({
    low: "tree_100verts.glb",         // 5KB, loads instantly
    medium: "tree_1000verts.glb",     // 50KB, loads in 100ms
    high: "tree_5000verts.glb"        // 250KB, loads in 500ms
});
```

### Audio Streaming

```typescript
// Start playing while downloading
const audioBuffer = await audioLoader.streamAudio(
    "ambient_forest.ogg",
    (progress) => console.log(`Streamed: ${progress * 100}%`)
);
```

## Network Optimization

### HTTP/2 Server Push

Critical assets pushed by server without request:
```
Server Push: core_shaders.glsl, player_model.glb, terrain_base.glb
```

### Range Requests

Resume interrupted downloads:
```http
GET /assets/level1.blk HTTP/1.1
Range: bytes=1048576-2097151
```

### Service Worker Caching

```javascript
// Cache-first strategy for static assets
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
```

## Fallback Handling

### Placeholder System

```typescript
// Show wireframe while loading
const placeholder = placeholderManager.getPlaceholder(
    AssetType.GEOMETRY,
    estimatedSize: 5  // meters
);
scene.add(placeholder);

// Replace when loaded
streamer.onAssetLoaded((asset) => {
    scene.remove(placeholder);
    scene.add(asset.data);
});
```

### Timeout Handling

```typescript
// If high-res doesn't load in 5s, use low-poly version
const timeoutId = setTimeout(() => {
    streamer.setQualityLevel(QualityLevel.LOW);
    showLowPolyVersion(assetId);
}, 5000);

streamer.onAssetLoaded((asset) => {
    clearTimeout(timeoutId);
    showFullVersion(asset);
});
```

### Retry with Exponential Backoff

```typescript
// 1s → 2s → 4s → fail
await networkManager.retryWithBackoff(
    () => fetchAsset(url),
    attempts: 3,
    baseDelay: 1000
);
```

## Usage Example

```typescript
import { AssetStreamer, AssetPriority, QualityLevel } from './systems/asset-streaming';

// Initialize
const streamer = new AssetStreamer(
    scene,
    assetManifest,
    {
        cellSize: 50,
        loadRadius: 3,
        maxTextureMemory: 512 * 1024 * 1024,  // 512MB
        enablePredictiveLoading: true
    },
    audioContext
);

// Events
streamer.onProgress((progress) => {
    loadingBar.value = progress.percent;
    statusText.textContent = `Loading ${progress.currentAsset}...`;
});

streamer.onAssetLoaded((asset) => {
    console.log(`Loaded: ${asset.id} in ${asset.loadTime}ms`);
});

// Start streaming
streamer.start();

// Game loop - update player position
function update(playerPosition: THREE.Vector3) {
    streamer.setPlayerPosition(
        playerPosition.x,
        playerPosition.y,
        playerPosition.z
    );
}

// Manual asset loading with priority
await streamer.loadAsset('special_item_01', AssetPriority.HIGH);

// Preload upcoming area
streamer.preloadRegion(500, 200, 2);

// Adapt to bandwidth
if (bandwidth < 1_000_000) {  // < 1 Mbps
    streamer.setQualityLevel(QualityLevel.LOW);
}

// Cleanup
streamer.dispose();
```

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Initial Load | <3 seconds | - |
| Streaming Overhead | <1ms/frame | - |
| LOD Transition | Seamless (no popping) | - |
| Memory Pressure Response | <100ms | - |
| Cache Hit Rate | >80% | - |

## File Structure

```
src/systems/
├── asset-streaming.ts    # Main AssetStreamer class
├── region-manager.ts     # Grid cell management
└── index.ts              # Re-exports

docs/
└── ASSET_STREAMING.md    # This documentation
```

## Future Enhancements

1. **Texture Compression**: Basis Universal, KTX2
2. **GPU-Driven Streaming**: WebGPU compute shaders for decompression
3. **ML-Based Prediction**: Learn player movement patterns
4. **Peer-to-Peer**: Nearby players share cached assets
5. **Procedural Fallback**: Generate low-detail content procedurally
