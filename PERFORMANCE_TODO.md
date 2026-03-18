# Candy World Performance & Quality Checklist

This document outlines a prioritized roadmap to eliminate lag spikes (specifically the "solid freeze" at startup) and improve runtime performance.

**Current Status:**
- **Startup Freeze:** ✅ **FIXED** - Shader warmup implemented, materials use InstancedMesh
- **Runtime Lag:** ✅ **IMPROVED** - Batched systems, frustum culling with size-based distances
- **Load Time:** ✅ **IMPROVED** - WASM batching implemented for both C++ and ASC
- **Bundle Size:** ⚠️ **IN PROGRESS** - Main bundle 1.78MB (target: 200KB)

---

## ✅ Phase 1: Quick Wins (Configuration & Rendering) - MOSTLY COMPLETE
*Goals: stabilize frame rate without major refactoring.*

### ✅ Adjust Object Limits (`src/world/generation.ts`)
- [x] Raise `animatedFoliage` safety limit from 1000 to **3000**.
- [x] Reduce procedural "extras" count if density is too high.
- [x] **Action:** Ensure we target ~2000 initial objects, capping at 3000 max.

### ✅ Tune Frustum Culling (`src/systems/music-reactivity.ts`)
- [x] The current culling relies on `obj.userData.radius`.
- [x] **Task:** Audit `src/foliage/mushrooms.ts` and `flowers.ts` to ensure they explicitly set accurate `userData.radius`.
    - *Example:* A giant mushroom might need `radius: 8.0` while a flower needs `radius: 1.5`.
- [x] **Task:** Tighten render distance. Implemented dynamic value based on object size:
    - Small flowers cull at 80m
    - Regular mushrooms at 120m  
    - Giant mushrooms at 200m
    - Clouds at 250m

### ⏳ Optimize Shadow Settings (`src/core/init.js`)
- [ ] With 3000 objects, the shadow map is under heavy load.
- [ ] **Task:** Switch directional light shadow to `autoUpdate = false` and update it only when the sun moves significantly or foliage grows.

---

## ✅ Phase 2: The "Solid Freeze" Fix (Material Strategy) - COMPLETE
*Goal: Eliminate the 2-minute freeze by reducing shader programs from ~3000 to ~12.*

**Status:** ✅ **COMPLETE** - Using `InstancedMesh` with TSL materials

The mushroom-batcher.ts uses `InstancedMesh` which is even more efficient than 12 shared materials. Instead of creating materials per note, we use:
- Single `InstancedMesh` for all mushrooms
- Instance attributes for color, scale, animation timing
- TSL shaders for all visual effects

**Result:** Shader compilation reduced from 3000 unique variants to ~8 materials total across all batchers.

---

## ✅ Phase 3: Load Time & WASM Batching - COMPLETE
*Goal: Speed up world initialization by batching physics calls.*

### ✅ Create Batch API in C++ (`emscripten/physics.cpp`)
- [x] **Task:** Add exported function `addObstaclesBatch`.
- [x] **Signature:** `void addObstaclesBatch(float* data, int count)`
- [x] **Data Layout:** Flat array where each obstacle uses 9 floats: `[type, x, y, z, r, h, p1, p2, p3]`.

### ✅ Implement Batch Loader (`src/utils/wasm-loader.js`)
- [x] **Task:** Create `uploadObstaclesBatch(objects)` function for C++ physics.
- [x] **Task:** Create batch upload for AssemblyScript collision system.
- [x] **Logic:** Single batch upload instead of 3000 individual calls.

### ✅ Update Physics System (`src/systems/physics.ts`)
- [x] Replace sequential `foliageMushrooms.forEach` with single `uploadObstaclesBatch` call.

---

## 🏗️ Phase 4: Long-Term Architecture (Instancing) - COMPLETE
*Goal: Support 10,000+ objects at 60 FPS.*

**Status:** ✅ **COMPLETE**

Moving `THREE.Group` objects to `THREE.InstancedMesh` has been implemented:

- ✅ **MushroomBatcher:** 4000 instances with TSL animations
- ✅ **FlowerBatcher:** Instanced flowers with color variation
- ✅ **CloudBatcher:** Instanced clouds
- ✅ **FoliageBatcher:** General foliage instancing

All heavy lifting is now GPU-side via TSL shaders.

---

## 🚀 Phase 5: Bundle Size Optimization - IN PROGRESS
*Goal: Reduce initial load from 15MB to <500KB.*

### Current Status (from build optimizer)
| Metric | Budget | Actual | Status |
|--------|--------|--------|--------|
| Main | 200 KB | 1.78 MB | ❌ 910% over |
| Total | 2 MB | 13.46 MB | ❌ 673% over |

### Quick Wins Applied
- [x] **Asset Optimization:** splash.png 1.5MB → splash.webp 155KB (90% reduction)
- [ ] **Three.js Import:** Use dynamic imports for optional features
- [ ] **Tree Shaking:** Remove 525 unused exports (820KB potential)
- [ ] **Code Splitting:** Implement lazy loading (693KB potential)

### Recommended Chunks
1. **core** (Critical) - Scene, renderer, camera (~146KB)
2. **foliage** (Lazy) - Trees, flowers, batchers (~293KB)
3. **audio** (Interaction) - Audio system, music reactivity (~98KB)
4. **shaders** (Lazy) - TSL materials (~195KB)
5. **wasm** (Lazy) - Physics module (~98KB)

---

## 📋 Specific To-Dos for Next Session

### High Priority
1. **Implement Code Splitting in vite.config.ts**
   - Use dynamic imports for audio, foliage, weather systems
   - Add preload hints to index.html
   - Target: 50% reduction in initial load

2. **Configure Server Compression**
   - Enable gzip/brotli on production server
   - Target: 60-80% transfer size reduction

3. **Tree Shaking Cleanup**
   - Audit and remove unused exports from common.ts
   - Split large modules into smaller files

### Medium Priority  
4. **WASM Optimization**
   - Install wasm-opt (Binaryen): `apt install binaryen`
   - Add `-O3` flags to emscripten build
   - Target: 30-50% WASM size reduction

5. **Shader Caching**
   - Already implemented in shader-warmup.ts
   - Verify all materials are warmed up at startup

---

## 📈 Performance Targets

| Metric | Current | Target | Priority |
|--------|---------|--------|----------|
| First Contentful Paint | ~3s | < 1.0s | High |
| Time to Interactive | ~8s | < 2.0s | High |
| Largest Contentful Paint | ~10s | < 2.5s | High |
| Total Bundle Size | ~15 MB | < 2 MB | High |
| Initial Load Size | ~15 MB | < 500 KB | High |

---

## 📚 Generated Reports

All optimization reports available in `tools/build-optimizer/stats/`:
- `OPTIMIZATION_REPORT.md` - Comprehensive analysis
- `bundle-analysis.html` - Interactive bundle visualization  
- `tree-shaking-report.md` - Dead code analysis
- `code-splitting-plan.md` - Chunking strategy
- `budget-report.json` - Performance budget check
