# Clustered Lighting

## Overview

Candy World uses a Forward+ / clustered shading approach for dynamic local lights (point/spot). This allows dozens of decorative/fill lights without dropping frame rate, bypassing the fragment cost explosion of traditional `MeshPhysicalMaterial` naive light loops.

## Implementation Details

- **Grid:** A 16x8x16 view-space grid.
- **Binning:** Currently performed on the CPU. Each frame, lights are transformed into view space and their bounding spheres are conservatively tested against the grid slices and tiles. The output is a flat Uint32Array (Count + Indices).
- **Storage Buffers (SSBOs):**
    - `lightBuffer`: Float32Array storing position, color, intensity, radius, and spot direction.
    - `clusterBuffer`: Uint32Array storing the number of lights and their indices per grid cell.
- **TSL Integration:** `createUnifiedMaterial` injects `globalClusteredLighting.getLightingNode()`, which resolves the cluster index from the fragment's view position, loops through the active lights in that cluster, and calculates attenuation (inverse square) and Lambertian diffuse. The result is added to the material's emissive node so it behaves as true additive light.

## Fallback

- **WebGL2:** The clustered shading path is skipped (`getLocalLightStats().webgl` check). Local lights degrade to the Three.js maximum limit.
- **Device Lost:** Fails closed gracefully.

## Budgets

- Configured in `CONFIG.lighting`.
- `maxClusterLights`: 128
- `maxLightsPerCluster`: 32
