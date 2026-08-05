# GPU Compute as Default (Tier 4)

GPU compute is now the **preferred** path for high-volume simulation when WebGPU is ready. WASM/JS tiers remain fallbacks and the tier-parity reference (`npm run test:tier-parity`).

## What moved to GPU

| Subsystem                                | GPU module                               | Fallback                                     |
| ---------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| Instanced foliage LOD                    | `batcher-gpu-lod.ts` → `LOD_SELECT_WGSL` | `batcher-lod.ts` CPU distance loop           |
| Foliage scalar batches (sway/bounce/hop) | `foliage-gpu-batch.ts` (`?gpuFoliage=1`) | AssemblyScript via `foliage-batcher-core.ts` |
| SimpleFlower pose (pilot) | `gpu-plant-pose.ts` (`?gpuFoliage=1`) | `PlantPoseMachine` |
| Particles (integrated systems)           | `compute-particles.ts` raw WebGPU        | `cpu-particle-system.ts`                     |
| Frustum/LOD culling (library)            | `gpu-culling-system.ts` + `cullAsync()`  | `cpuCull()`                                  |

Instanced musical batchers (trees, flowers) already deform in **TSL vertex shaders** at draw time; pose machines still run on CPU for audio reactivity. Full GPU pose migration is a follow-up.

## Policy & toggles

- **Default:** `CONFIG.compute.preferGpu = true`
- **Disable:** `?no_gpu_compute` or `window.__computeDisabled` (same as TSL compute passes)
- **CI/headless:** auto-falls back to WASM/JS
- **Status:** `window.__computeStatus()` / `window.__computeVramBytes()` in devtools

## VRAM audit (#1346)

`trackGpuBufferBytes()` in `compute-orchestrator.ts` accumulates buffer allocations from GPU LOD and foliage batch paths. Check `__computeVramBytes()` after exploring a full world.

## Measurement

```bash
npm run budget:batchers   # before/after instance budgets
# In browser: window.__computeStatus() → { lastFrameGpuLod, lastFrameGpuLod, vramEstimateBytes }
```

## Parity

GPU foliage scalar shaders mirror `assembly/foliage.ts` `computeSway` / `computeBounce` / `computeHop` math. Plant pose WGSL mirrors `plant-pose-machine.ts`. Extend `tests/parity.mjs` (Path 4–5) when promoting a path to default-on. See `docs/GPU_FOLIAGE.md` for the `?gpuFoliage=1` pilot.

## Files

- `src/compute/compute-orchestrator.ts` — policy + VRAM tracking
- `src/compute/batcher-gpu-lod.ts` — pipelined instanced LOD (1-frame latency)
- `src/compute/foliage-gpu-batch.ts` — pipelined WASM replacement for simple batches
- `src/core/game-loop.ts` — `tickComputeOrchestrator()` each frame
- `src/core/deferred-init.ts` — `ensureGpuComputeReady()` at boot
