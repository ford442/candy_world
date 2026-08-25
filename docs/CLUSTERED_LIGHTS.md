# Clustered Lighting (Forward+)

Issue: **#1571**. Registry: [`src/rendering/lights.ts`](../src/rendering/lights.ts) (#1570).
Shader inject: [`src/foliage/material-core/unified-material.ts`](../src/foliage/material-core/unified-material.ts).
CPU bin: [`src/rendering/clustered-bin.ts`](../src/rendering/clustered-bin.ts).
System: [`src/rendering/clustered-lighting.ts`](../src/rendering/clustered-lighting.ts).

## Goal

Support dozens of dynamic local lights (stretch ~100) on the **WebGPU** path without a deferred rewrite and without a second `GPUDevice`. Candy `MeshPhysical` + transmission already pays a heavy fragment bill; looping every analytic `PointLight`/`SpotLight` in Three’s forward path does not scale.

## v1 choice: CPU binning

The 16×8×16 **view-space** grid is filled on the CPU each frame.

- Compute-pass binning would be another dispatch on the **shared** renderer device (`docs/WEBGPU_CONTEXT.md`). For ≤128 lights the CPU fill is cheaper than a new compute pipeline + barrier.
- Follow-up if profiler mark `ClusteredLighting` exceeds the budgets below.

WebGL has no storage-buffer TSL path here. Extra lights stay on the tiny Three.js GPU pool (8 point + 4 spot); decorative descriptors do not illuminate.

## Light list (SSBO layout)

CPU writes a reused `Float32Array` (`maxClusterLights * 12` floats). No per-frame allocations.

| Offset | Fields                                                   |
| ------ | -------------------------------------------------------- |
| 0–3    | world `position.xyz`, `radius` (attenuation cutoff)      |
| 4–7    | `color.rgb` (0–1), `intensity`                           |
| 8–11   | spot `dir.xyz` (world), `coneCos` — **negative ⇒ point** |

Cluster buffer: `Uint32Array`, stride `1 + maxLightsPerCluster`. Slot 0 is the count; the rest are light indices.

Caps (clamped at construct): `CONFIG.lighting.maxClusterLights` (8–128, default 128), `CONFIG.lighting.maxLightsPerCluster` (4–32, default 32).

## Shader (candy, not metallic-rough)

`createUnifiedMaterial` adds `getLightingNode()` to `emissiveNode` when `areClusteredLightsEnabled()`.

- Windowed inverse-square attenuation.
- Wrapped Lambert (`0.65 N·L + 0.35`) so Gummy/Crystal fills stay pastel.
- Result × albedo × 0.55 — **no extra specular lobe**.
- Spot cone via `smoothstep` on `dot(-L, spotDir)` vs `coneCos`.

GPU-pool Three.js lights are **muted** (`intensity = 0`) while clustered is active so they are not double-lit. Shadow casters stay analytic (1–2 extra maps). Clustered lights themselves are **unshadowed**.

## Fail closed

| Condition                                                   | Behaviour                                           |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `?no_clustered` / `FEATURE_FLAGS.clusteredLights === false` | Shader skip; analytic pool restored                 |
| graphics `low`                                              | Same (CI / smoke-friendly)                          |
| WebGL backend                                               | Same; decorative fills stay dark                    |
| `isGpuComputeAvailable() === false` or device-lost          | Light count uniform → 0; unmute analytics; no crash |

`onGpuDeviceLost` is the only device hook — **no `requestDevice`**.

## Profiler budget

Mark: `ClusteredLighting` in `src/core/game-loop-visuals.ts`.

| Lights packed | CPU bin + pack budget                    |
| ------------- | ---------------------------------------- |
| ≤32           | **2.0 ms** (`CLUSTER_BIN_BUDGET_MS_32`)  |
| ≤128          | **6.0 ms** (`CLUSTER_BIN_BUDGET_MS_128`) |

`window.__clusteredLighting` exposes `{ enabled, reason, lights, lastBinMs, budgetMs, … }`.

32+ decorative + pool lights are expected to stay under the 2 ms CPU mark on desktop; the fragment win is that materials loop **per-cluster** (≤32) instead of every light.

## Non-goals

Deferred shading, shadowed clustered lights, GI (GI can later sample the same list).
