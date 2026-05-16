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
