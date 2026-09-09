# GPU Compute as Default (Tier 4)

GPU compute is now the **preferred** path for high-volume simulation when WebGPU is ready. WASM/JS tiers remain fallbacks and the tier-parity reference (`npm run test:tier-parity`).

## What moved to GPU

| Subsystem                                | GPU module                               | Fallback                                     |
| ---------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| Instanced foliage LOD                    | `batcher-gpu-lod.ts` → `LOD_SELECT_WGSL` | `batcher-lod.ts` CPU distance loop           |
| Foliage scalar batches (sway/bounce/hop) | `foliage-gpu-batch.ts` (`?gpuFoliage=1`) | AssemblyScript via `foliage-batcher-core.ts` |
| SimpleFlower pose (pilot)                | `gpu-plant-pose.ts` (`?gpuFoliage=1`)    | `PlantPoseMachine`                           |
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
- `src/compute/chores/gpu-chores.ts` — shared Tier 4a job API (prefix sum / compact / reduce_f32)
- `src/compute/chores/gpu-chores-wgsl.ts` — the chore kernels

## GPU Chores (Tier 4a vs 4b)

- **Tier 4a — shared core primitives.** Generic, reusable jobs with no knowledge of what
  they are counting: `prefix_sum`, `compact`, `reduce_f32`. They live in `GPUChoresLibrary`
  (`src/compute/chores/`) and run on the shared renderer device, so a new consumer costs a
  bind group rather than a new shader.
- **Tier 4b — domain-specific sim.** Particle collide/update/spawn and foliage pose/wind
  stay in their own modules (`compute-particles.ts`, `gpu-plant-pose.ts`,
  `foliage-gpu-batch.ts`). They are not candidates for the shared kit: their bindings,
  audio-reactive state and gameplay authority are app-local by design.

> The tracking issue for the cross-app rollout used the opposite lettering (4a for domain
> sim, 4b for chores). This repo has shipped 4a = chores since #1643; the distinction, not
> the letters, is what matters.

### Using the chores API

Two steps: build a job once against a fixed set of buffers, then encode it into a
caller-owned `GPUCommandEncoder` each frame.

```ts
import { GPUChoresLibrary, prefixSumBlockSumsBytes } from '../compute/chores/gpu-chores.ts';

const chores = new GPUChoresLibrary(device); // device borrowed, never requested
await chores.initialize();

const scan = chores.createPrefixSumJob(flagsBuffer, offsetsBuffer, blockSumsBuffer);
const compact = chores.createCompactJob({
    inputFlags,
    inputLods,
    offsets,
    outIndices,
    outLods,
    outCount,
    indirectArgs,
});

// per frame, into one encoder:
chores.encodePrefixSum(encoder, scan, liveCount);
chores.encodeCompact(encoder, compact, liveCount);
```

Contract worth knowing:

- **`liveCount` comes from a uniform, not `arrayLength()`.** Size buffers for a worst-case
  capacity and pass the live count; the kernels ignore the stale tail. Each job owns its
  params buffer, so encode a given job at most once per submitted command buffer.
- **`prefix_sum` is inclusive.** For flags, `offsets[i] - 1` is element `i`'s destination
  slot and `offsets[liveCount - 1]` is the total.
- **Block-sums scratch** must be at least `prefixSumBlockSumsBytes(capacity)` bytes.
- **`compact` publishes the survivor count** to `outCount[0]` and to `indirectArgs[1]` —
  the `instanceCount` word of both the 4-word `draw` and 5-word `drawIndexed` layouts.
- **Workgroup size is 256** for every 1D kernel, which is what the block-sums sizing assumes.

### Live consumer

`GPUCullingSystem` (`src/compute/gpu-culling-system.ts`) runs frustum cull → LOD select →
`encodePrefixSum` → `encodeCompact` in a single command buffer. The dense visible-index and
LOD lists drive the indirect draw and `readbackResults()` with the same 1-frame latency as
GPU LOD; `cull()` still returns the CPU result synchronously so existing callers are
unaffected.

### Fail-closed behaviour

- `?no_gpu_compute`, `window.__computeDisabled` and CI/headless all route `cull()` to
  `cpuCull()` via `preferGpuCompute()` — the chore pipelines are simply not encoded.
- If chore pipelines fail to compile (a Chrome/Edge device mismatch, say), the culling
  system logs the reason, drops to the CPU list build, and keeps rendering. It never
  requests a second `GPUDevice` and never opens a WebGL context "for resources".
- `window.__computeStatus().lastFrameGpuChores` reports whether a chore was encoded on the
  most recent frame; `disabledReason` reports why not.

> [!IMPORTANT]
> These WASM/JS fallbacks cover a **compute pass that could not run on a working device**.
> They are not a substitute for a **missing device**: if the WebGPU boot probe fails there is
> no renderer at all, and boot hard-fails rather than dropping to WebGL. Compute fails closed;
> the device does not. See [`WEBGPU_CONTEXT.md`](./WEBGPU_CONTEXT.md#boot-probe--hard-fail).

### VRAM

Chore params buffers are registered with `trackGpuBufferBytes()` by `GPUChoresLibrary`
itself and released on `destroy()`. The culling system's own scratch (offsets, block sums,
count, compacted lists, indirect args) is tracked alongside them, so
`window.__computeVramBytes()` accounts for the whole chores path.

### Parity

`npm run test:chores` (`tests/gpu-chores.test.mjs`) drives a JS mirror of the chores WGSL
(`tests/parity/refs/gpu-chores.mjs`) against naive references across the block boundaries
that matter — 256, 512, 513 and 65 792 elements — plus `reduce_f32`. It is part of
`npm run test:integration`.

### Not adopted

`luma_histogram_bt709` is not in the kit. Nothing in this app reads back an exposure or
debug histogram today, and an unused kernel is a maintenance cost, not a capability.
