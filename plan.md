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

Next Step: Phase 4 Stage C — Scene Graph Replacement: Migrate scene hierarchy to the new ECS structure in WASM and call `device.queue.submit()` directly, fully replacing the Three.js scene graph.
