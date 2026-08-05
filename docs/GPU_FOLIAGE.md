# GPU Foliage Pilot (#1496)

WebGPU compute path for high-count foliage pose and scalar animation on the **shared renderer-owned device** (#1448). CPU/WASM tiers remain fallbacks for WebGL, CI/headless, and device-lost recovery.

## Enable

| Toggle | Value |
|--------|-------|
| URL | `?gpuFoliage=1` (default **OFF** until parity is green) |
| Disable all GPU compute | `?no_gpu_compute` |
| DevTools | `window.__gpuFoliageFlag()` → `{ urlEnabled, pilotActive }` |
| Orchestrator | `window.__gpuFoliageOrchestrator()` → `{ active, disabledByDeviceLoss, animatorReady }` |

Requires `preferGpuCompute()` and a warm shared device (`ensureGpuComputeReady()`). **Zero new `requestDevice` call sites** — all paths borrow via `awaitGpuDevice()`.

## Pilot batchers

| Batcher | GPU module | CPU fallback |
|---------|-----------|--------------|
| `SimpleFlowerBatcher` | `gpu-plant-pose.ts` (ADSR → `aPoseState`) | `PlantPoseMachine` |
| `FoliageBatcher` scalar batches (sway/bounce/hop/gentleSway) | `foliage-gpu-batch.ts` | AssemblyScript via `foliage-batcher-core.ts` |

`GPUFoliageAnimator` (`gpu-foliage-animator.ts`) is initialised by `gpu-foliage-orchestrator.ts` when the pilot flag is on; full instanced-matrix migration is a follow-up slice.

## Storage layout

### Plant pose (`gpu-plant-pose.ts`)

- **Uniforms (64 B):** `delta`, `channelIntensity`, `dayNightBias`, ADSR config, optional wave origin + `radiusSq`, `count`
- **Positions (read-only storage):** `vec3` per instance (uploaded on register)
- **State (read-write storage):** `envelopeLevel`, `currentPose` per instance

### Scalar batches (`foliage-gpu-batch.ts`)

- **Uniforms:** `time`, `kick`, `count`, `mode`
- **Inputs:** `offsets[]`, `intensities[]`, `originalYs[]`
- **Output:** `outScalars[]`

### Full animator (`gpu-foliage-animator.ts`)

- **Instance buffer:** 48 B/instance (pos, animType, rot, animOffset, scale, intensity)
- **Output buffer:** position + rotation `vec4` pairs
- **Uniforms:** time, beatPhase, kick, groove, isDay, instanceCount

## Latency

Scalar batches and plant pose use **1-frame pipelining** (`submit` / `take` or async readback). First frame after enable may still run CPU until GPU results arrive.

## Device lost

`onGpuDeviceLost` in `gpu-foliage-orchestrator.ts` tears down GPU foliage buffers and sets `_disabledByDeviceLoss`. The render canvas stays up; batchers fall back to `PlantPoseMachine` / WASM without uncaught errors.

## Parity

```bash
npm run test:parity   # Path 4 (foliage scalar) + Path 5 (plant pose) — TS reference
```

Tolerance: `|Δ| ≤ 1e-5` for f32 scalars (same as existing tier-parity harness).

Visual regression: `circadian_night` viewpoint with `?gpuFoliage=1` after enabling default-on.

## Performance measurement

```bash
npm run budget:batchers
```

In browser:

```js
window.__computeStatus()  // lastFrameGpuFoliage, vramEstimateBytes
performance.measure('simple-flower-update')  // profiler marks in game-loop
```

### VRAM budget (pilot, 1000 flowers)

| Buffer | Approx size |
|--------|-------------|
| Plant pose positions | 12 KB |
| Plant pose state | 8 KB |
| Scalar batch (512 cap) | ~8 KB |
| GPUFoliageAnimator (10k cap) | ~640 KB (only when orchestrator active) |

Check `window.__computeVramBytes()` after exploring a full world.

## Files

- `src/compute/gpu-foliage-flag.ts` — `?gpuFoliage=1` gate
- `src/compute/gpu-foliage-orchestrator.ts` — shared-device lifecycle
- `src/compute/gpu-plant-pose.ts` — SimpleFlower pilot
- `src/compute/foliage-gpu-batch.ts` — scalar batch GPU path
- `src/compute/gpu-foliage-animator.ts` — full instance animator (orchestrator-owned)
- `src/foliage/simple-flower-batcher.ts` — pilot consumer
- `src/foliage/batcher/foliage-batcher-core.ts` — scalar batch wiring

## Next steps (15% rule)

1. Default-on for WebGPU when visual + parity green
2. GPU ADSR without readback stall (GPU→instance attribute buffer)
3. Second pilot: cloud scalar path or portamento SoA matrices
4. Extend `GPUFoliageAnimator` to additional species
