# GPU Heightmap Displacement Plan

1. Created `src/world/ground-heightmap.ts`
   - Added `generateGroundHeightmap()`
   - Added `sampleHeightmapCPU()`
   - Added `disposeHeightmap()`
2. Updated `src/foliage/terrain.ts`
   - Added optional `heightMap` and `normalMap` to `createTerrainMaterial()`
   - Implemented TSL vertex displacement on `positionNode` and `normalNode`
3. Updated `src/world/generation.ts`
   - Added feature flag logic (`CONFIG.terrain?.useGpuHeightmap` or `?gpuTerrain`)
   - Added generation and application of the heightmap textures
4. Updated `src/core/config.ts`
   - Added `terrain.useGpuHeightmap` and `terrain.heightmapResolution` configuration
   - Implemented pre-commit checks and successfully built the project.

Status: Implemented ✅

We have finished the startup improvements.
- Loading phases reweighed and `shader-warmup` removed.
- `enterWorld` logic wrapped in robust `try...finally` to fix the `isGenerating` race condition.
- `getHeightmapBatch` implemented and integrated into ground geometry deformation loop to drastically reduce synchronous WASM calls.

Status: Implemented ✅
- Addressed memory allocation efficiency on WASM boundary.
- Refactored `batchGroundHeight`, `updateParticlesWASM`, and value noise functions to use a Zero-Allocation Bridge pattern (avoiding per-frame GC spikes and `_malloc`).
- Finished audio reactivity wiring for `wisteria-cluster.ts` and `portamento-batcher.ts` to `music-reactivity.ts`, with ADSR-driven scale/emission mapping.

Status: Implemented ✅
* Implementation Details: Built the `src/systems/ecs` core structure to facilitate scene graph replacement, targeting maximum performance and memory efficiency through dense arrays. Ran memory benchmarks yielding approx 40.03 MB memory usage for 100000 entities with standard components.

Status: Implemented ✅
* Implementation Details: Modularized src/world/generation.ts into generation-core.ts, generation-decorators.ts, and generation-utils.ts.

Status: Implemented ✅
* Implementation Details: Refactored `src/systems/region-manager.ts` into `region-manager-core.ts`, `region-manager-lod.ts`, and a barrel export, separating the core class logic from the LOD transitions and spatial queries.

Status: Implemented ✅
* Implementation Details: Refactored `src/ui/loading-screen.ts` into `loading-screen-types.ts`, `loading-screen-ui.ts`, and `loading-screen-progress.ts` with a barrel export, separating types, the UI class implementation, and the global APIs.

Status: Implemented ✅
* Implementation Details: Wired orphaned batchers (lake_features, aurora, chromatic, panning-pads, silence-spirits) to the music-reactivity pipeline by adding `global` and `sky_moon` biomes to the `sky_wave.target_biomes` array in `music-bindings.json` and mapping them in `music-reactivity.ts`.

Status: Implemented ✅
* Implementation Details: Refactored `src/ui/analytics-debug.ts` into `analytics-debug-types.ts` (merged into ui for simplicity based on length), `analytics-debug-ui.ts`, and `analytics-debug-handlers.ts` with a barrel export, separating the UI rendering logic from the state management and event handlers.
Next Step: Continue large file refactoring from `REFACTORING_PLAN_REMAINING.md` by targeting `src/audio/audio-system.ts`.

Status: Implemented ✅
* Implementation Details: Improved FCP (First Contentful Paint) for the `LoadingScreen` by moving heavy, synchronous DOM generation from `src/ui/loading-screen-ui.ts` into static HTML shells inside `index.html`. This ensures the overlay and loading indicator render immediately without JS-driven layout thrashing.
