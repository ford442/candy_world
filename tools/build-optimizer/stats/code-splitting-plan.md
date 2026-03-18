# ✂️ Code Splitting Strategy Plan

> Generated: 3/19/2026, 12:22:22 AM

## Summary

- **Total Estimated Bundle Size**: 1.19 MB
- **Number of Chunks**: 9
- **Dynamic Import Opportunities**: 6
- **Estimated Lazy-Load Savings**: 693 KB

## 📦 Chunk Strategy

| Chunk | Priority | Strategy | Est. Size | Dependencies |
|-------|----------|----------|-----------|--------------|
| core | 🔴 critical | immediate | 146 KB | three |
| foliage | 🟠 high | lazy | 293 KB | core, three/tsl |
| audio | 🟡 medium | interaction | 98 KB | core |
| shaders | 🟠 high | lazy | 195 KB | core, three/tsl |
| wasm | 🟠 high | lazy | 98 KB | core |
| weather | 🟡 medium | idle | 146 KB | core, foliage |
| gameplay | 🟡 medium | interaction | 78 KB | core |
| effects | 🟢 low | idle | 117 KB | core, foliage |
| editor | 🟢 low | idle | 49 KB | core |

### Chunk Details

#### core

Essential runtime - scene, renderer, camera, basic input

- **Priority**: critical
- **Load Strategy**: immediate
- **Estimated Size**: 146 KB
- **Files**: 
  - `src/core/init.ts`
  - `src/core/input.ts`
  - `src/core/config.ts`
  - `src/core/cycle.ts`
  - `src/main.ts`
- **Dependencies**: three

#### foliage

Foliage rendering systems - trees, flowers, particles

- **Priority**: high
- **Load Strategy**: lazy
- **Estimated Size**: 293 KB
- **Files**: 
  - `src/foliage/common.ts`
  - `src/foliage/tree-batcher.ts`
  - `src/foliage/flower-batcher.ts`
  - `src/foliage/mushroom-batcher.ts`
  - `src/foliage/cloud-batcher.ts`
  - ... and 2 more
- **Dependencies**: core, three/tsl

#### audio

Audio system and music reactivity

- **Priority**: medium
- **Load Strategy**: interaction
- **Estimated Size**: 98 KB
- **Files**: 
  - `src/audio/audio-system.ts`
  - `src/audio/beat-sync.ts`
  - `src/systems/music-reactivity.ts`
- **Dependencies**: core

#### shaders

TSL shaders and materials

- **Priority**: high
- **Load Strategy**: lazy
- **Estimated Size**: 195 KB
- **Files**: 
  - `src/rendering/materials.ts`
  - `src/rendering/material_types.ts`
  - `src/rendering/shader-warmup.ts`
- **Dependencies**: core, three/tsl

#### wasm

WebAssembly physics module

- **Priority**: high
- **Load Strategy**: lazy
- **Estimated Size**: 98 KB
- **Files**: 
  - `src/wasm/candy_physics.wasm`
  - `src/utils/wasm-loader.js`
- **Dependencies**: core

#### weather

Weather system and effects

- **Priority**: medium
- **Load Strategy**: idle
- **Estimated Size**: 146 KB
- **Files**: 
  - `src/systems/weather.ts`
  - `src/systems/weather.core.ts`
  - `src/systems/weather-types.ts`
  - `src/foliage/rainbow.ts`
  - `src/foliage/aurora.ts`
  - ... and 1 more
- **Dependencies**: core, foliage

#### gameplay

Gameplay mechanics - blaster, mines, harpoon

- **Priority**: medium
- **Load Strategy**: interaction
- **Estimated Size**: 78 KB
- **Files**: 
  - `src/gameplay/rainbow-blaster.ts`
  - `src/gameplay/jitter-mines.ts`
  - `src/gameplay/harpoon-line.ts`
- **Dependencies**: core

#### effects

Visual effects - particles, impacts, ribbons

- **Priority**: low
- **Load Strategy**: idle
- **Estimated Size**: 117 KB
- **Files**: 
  - `src/foliage/impacts.ts`
  - `src/foliage/ribbons.ts`
  - `src/foliage/sparkle-trail.ts`
  - `src/foliage/pollen.ts`
  - `src/foliage/fireflies.ts`
- **Dependencies**: core, foliage

#### editor

Development tools and editor features

- **Priority**: low
- **Load Strategy**: idle
- **Estimated Size**: 49 KB
- **Files**: 
  - `src/ui/loading-screen.ts`
  - `src/utils/profiler.js`
  - `src/utils/startup-profiler.ts`
- **Dependencies**: core

## 📥 Dynamic Import Opportunities

### Audio System

**Current:**
```typescript
import { AudioSystem } from './audio/audio-system.ts';
```

**Proposed:**
```typescript
const { AudioSystem } = await import('./audio/audio-system.ts');
```

- **Trigger**: User interaction (first click) or settings toggle
- **Estimated Savings**: 98 KB

### Weather Effects

**Current:**
```typescript
import { WeatherSystem } from './systems/weather.ts';
```

**Proposed:**
```typescript
const { WeatherSystem } = await import('./systems/weather.ts');
```

- **Trigger**: Weather change event or after initial scene load
- **Estimated Savings**: 146 KB

### Debug Tools

**Current:**
```typescript
import { profiler } from './utils/profiler.js';
```

**Proposed:**
```typescript
const { profiler } = await import('./utils/profiler.js');
```

- **Trigger**: Development mode only - never load in production
- **Estimated Savings**: 29 KB

### Foliage Batching

**Current:**
```typescript
import { treeBatcher, flowerBatcher } from './foliage/index.ts';
```

**Proposed:**
```typescript
const { treeBatcher, flowerBatcher } = await import('./foliage/index.ts');
```

- **Trigger**: Near loading completion - preload strategy
- **Estimated Savings**: 244 KB

### WASM Physics

**Current:**
```typescript
import { initWasm } from './utils/wasm-loader.js';
```

**Proposed:**
```typescript
const { initWasm } = await import('./utils/wasm-loader.js');
```

- **Trigger**: After core scene initialization
- **Estimated Savings**: 98 KB

### Gameplay Weapons

**Current:**
```typescript
import { fireRainbow } from './gameplay/rainbow-blaster.ts';
```

**Proposed:**
```typescript
const { fireRainbow } = await import('./gameplay/rainbow-blaster.ts');
```

- **Trigger**: Weapon unlock or first use
- **Estimated Savings**: 78 KB

## 🚀 Preload Hints

| Resource | Type | As | Condition |
|----------|------|-----|-----------|
| /assets/map.json | preload | fetch | Critical path - needed for world generation |
| /chunks/foliage.js | prefetch | script | After core initialization completes |
| /chunks/wasm.js | prefetch | script | After scene is interactive |
| /chunks/audio.js | prefetch | script | When user shows intent (hovers over audio button) |
| /chunks/shaders.js | modulepreload | script | During loading screen after core ready |
| /assets/colorcode.png | preload | image | Critical texture needed immediately |
| /chunks/weather.js | prefetch | script | Idle time after initial load |
| /chunks/effects.js | prefetch | script | When approaching area with effects |

## 🛠️ Implementation Guide

### 1. Update Vite Config

See `code-splitting/vite.config.ts` for the complete configuration.

Key changes:
- Add manual chunking in `build.rollupOptions.output.manualChunks`
- Configure chunk naming for cache busting
- Optimize asset file names by type

### 2. Implement Dynamic Imports

See example implementations in `code-splitting/*.example.ts`:

- `audio-system.example.ts`
- `foliage-preload.example.ts`
- `wasm-loader.example.ts`
- `debug-tools.example.ts`
- `conditional-features.example.ts`

### 3. Add Preload Hints

Add to your `index.html`:

```html
<!-- Critical resource preloading -->
<head>
  <!-- Preload critical assets -->
  <link rel="preload" href="/assets/colorcode.png" as="image" type="image/png" />
  <link rel="preload" href="/assets/map.json" as="fetch" crossorigin />
  
  <!-- Preload core JavaScript -->
  <link rel="modulepreload" href="/chunks/vendor-[hash].js" />
  <link rel="modulepreload" href="/chunks/core-[hash].js" />
  
  <!-- Prefetch non-critical chunks (low priority) -->
  <link rel="prefetch" href="/chunks/foliage-[hash].js" as="script" />
  <link rel="prefetch" href="/chunks/shaders-[hash].js" as="script" />
  
  <!-- DNS prefetch for external resources -->
  <link rel="dns-prefetch" href="https://cdn.example.com" />
  
  <!-- Preconnect for critical origins -->
  <link rel="preconnect" href="https://api.example.com" />
</head>

<!-- Dynamic prefetch after load -->
<script>
  // Prefetch foliage when core is ready
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = '/chunks/foliage-[hash].js';
      document.head.appendChild(link);
    }, { timeout: 2000 });
  }
  
  // Prefetch on user intent
  document.querySelector('#audio-toggle')?.addEventListener('mouseenter', () => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = '/chunks/audio-[hash].js';
    document.head.appendChild(link);
  });
</script>

```

## ⏱️ Recommended Loading Sequence

```
1. [0ms]     Load HTML + Critical CSS
2. [50ms]    Parse & execute core chunk (scene, renderer, camera)
3. [200ms]   Initialize basic world (ground plane, sky)
4. [500ms]   Show interactive state (user can look around)
5. [800ms]   Start loading foliage (prefetched)
6. [1200ms]  Foliage ready, world fully rendered
7. [2000ms]  Start loading audio (idle callback)
8. [3000ms]  Preload weather effects (idle callback)
9. [on need] Load gameplay features on first interaction
```

## 🎯 Performance Targets

| Metric | Target | Current (Est.) |
|--------|--------|----------------|
| First Contentful Paint | < 1.0s | TBD |
| Time to Interactive | < 2.0s | TBD |
| Largest Contentful Paint | < 2.5s | TBD |
| Total Bundle Size | < 1MB | 1.19 MB |
| Initial Load Size | < 500KB | TBD |

## 📊 Monitoring Recommendations

Track these metrics in production:

- Chunk load times (Performance Observer)
- Dynamic import success rates
- Cache hit rates by chunk
- Memory usage per chunk
- User wait times for lazy-loaded features

