<<<<<<< HEAD
# WebGPU Context Architecture

## Overview
Candy World uses a unified WebGPU device and renderer context management system via the `gpuContext` singleton, located in `src/rendering/gpu-context.ts`.

Prior to this architecture, multiple sub-systems (renderer, particles, and compute) would opportunistically attempt to call `navigator.gpu.requestAdapter` and `adapter.requestDevice`. This led to high VRAM pressure, race conditions on startup, and silent black canvases if the device was ever lost due to OS resources.

The single-device architecture centralizes adapter and device request flow. The `GPUContext` object is initialized early in the render pipeline (within `src/core/init.ts`) and creates the `WebGPURenderer`, caching the created `adapter`, `device`, and `limits` for other subsystems to borrow safely.

## Core Features
1. **Single Owner:** `GPUContext` makes the request, no other system does.
2. **Explicit context:** `powerPreference: 'high-performance'` is forced globally.
3. **Graceful fail-closed:** Compute/particle systems degrade cleanly when the shared device is unavailable.
4. **Device lost recovery:** If `device.lost` fires, the application prevents a silent crash by overlaying an explicit modal UI prompting the user to reload the game.

## Interacting with `gpuContext`
The `gpuContext` must be ready before requesting the `device` or its limits.

```typescript
import { gpuContext } from '../rendering/gpu-context.ts';

if (gpuContext.isReady()) {
    const device = gpuContext.getDevice();
    const limits = gpuContext.getLimits();

    // Use device for buffer/pipeline allocations safely
} else {
    // Graceful degradation (e.g. CPU fallback or skipping compute passes)
}
```

## System Integration
* **`src/core/init.ts`**: Awaits `gpuContext.init(canvas)` to extract and return the configured `WebGPURenderer`.
* **`src/compute/gpu-compute-library.ts`**: Subscribes to the context's device. Will safely skip work if the GPU context drops.
* **`src/particles/compute-particles.ts`**: Subscribes to the context's device.
* **`src/rendering/webgpu-limits.ts`**: Bypasses fallback checking to extract real, hard limits from the `gpuContext`.
* **`src/utils/startup-profiler.ts`**: Replaces the global `GPUDevice.prototype` directly instead of tracking adapter promises since the `gpuContext` assumes adapter responsibilities.
=======
# WebGPU Context — Single-Device Architecture

> Owner module: [`src/rendering/gpu-context.ts`](../src/rendering/gpu-context.ts)
> Issue: #1448

Candy World creates **exactly one `GPUDevice` per page load**, and the Three.js renderer owns it.
Nothing else calls `navigator.gpu.requestDevice()`.

## Why

Before this change the happy WebGPU boot created three or more independent devices: one inside
`WebGPURenderer`, one in `GPUComputeLibrary`, and one per `ComputeParticleSystem`. Independent
devices do not share a VRAM budget, buffer pool, or pipeline cache, so the cost multiplied — worst
on integrated GPUs and on SwiftShader in CI. Three separate `requiredLimits` requests also meant the
renderer and the compute tier could disagree about storage-buffer ceilings. And because only the
compute devices registered `device.lost` handlers, an actual device loss left the render path with
no recovery and a black canvas.

## Ownership and lifecycle

```
src/core/init.ts
  captureAdapterRequests()          // wrap requestAdapter once, no extra request
  new WebGPURenderer({ canvas, antialias, alpha, powerPreference, requiredLimits })
  armGpuContext(renderer, mode)     // not awaited — initScene() is synchronous
        └─ await renderer.init()          // Three requests the adapter + the one device
        └─ adopt renderer.backend.device
        └─ register device.lost + renderer.onDeviceLost
        └─ resolve getGpuContext(), publish window.__gpuContext, log once
```

Consumers never construct a device. They await the shared one and **fail closed**:

```ts
import { awaitGpuDevice } from '../rendering/gpu-context.ts';

const device = await awaitGpuDevice();
if (!device) return this.initCPUFallback();   // WASM / CPU tier, never a throw
```

`awaitGpuDevice()` resolves `null` — never rejects, never hangs — when the backend is WebGL, when
WebGPU init failed, after device loss, or when no context was armed at all (a 10 s guard covers
tools and tests that boot outside `initScene`).

| Consumer | Behaviour without the shared device |
|---|---|
| `src/compute/gpu-compute-library.ts` | `initDevice()` rejects; `compute-init.ts` swallows it and the CPU/WASM path stays active |
| `src/particles/compute-particles.ts` | `initWebGPU()` rejects; constructor catch installs `CPUParticleSystem` |
| `src/utils/startup-profiler.ts` | telemetry hooks simply never attach |
| `src/rendering/webgpu-limits.ts` | reports WebGPU spec defaults |

Neither consumer calls `device.destroy()` in `dispose()` any more — they release their own buffers
and leave the device to the renderer.

## Renderer context options

Set explicitly in `src/core/init.ts`, with the values defined in `gpu-context.ts`:

| Option | Value | Rationale |
|---|---|---|
| `powerPreference` | `'high-performance'` | The compute devices already asked for it; the main renderer did not. On a hybrid laptop that could put the renderer on the iGPU and compute on the dGPU — two heaps and cross-adapter copies. One device, one preference. |
| `antialias` | `true` | Unchanged from before. The post chain has no full-screen AA resolve of its own, so swap-chain MSAA is still the only geometric AA. Swapping to post-AA is a visual change and out of scope. |
| `alpha` | `true` → `alphaMode: 'premultiplied'` | Three's default, pinned explicitly. HUD, loading screen, badges, and the accessibility menu are DOM layers composited over the canvas and depend on premultiplied blending. |
| `requiredLimits` | see below | Aligns the renderer's device with the compute tier's ceilings. |
| `outputColorSpace` | `'display-p3'` / `'srgb'` string literals | Untouched. The Three enum regression is tracked separately — do not "fix" it here. |

### Limits matrix

Every requested value is exactly a **WebGPU spec default**, so `requestDevice` can never be rejected
for asking too much — including on SwiftShader in CI. They are requested explicitly because compute
shaders bind against these ceilings.

| Limit | Requested | Why | Granted (SwiftShader CI) |
|---|---|---|---|
| `maxStorageBufferBindingSize` | 134 217 728 (128 MiB) | Identical to what `gpu-compute-library.ts` and `compute-particles.ts` used to request from their own devices, so moving them onto the renderer's device cannot shrink a binding that used to fit | 134 217 728 |
| `maxComputeWorkgroupSizeX` | 256 | Workgroup size declared by the particle and culling WGSL kernels | 256 |
| `maxComputeInvocationsPerWorkgroup` | 256 | Same kernels, single-dimension dispatch | 256 |
| `maxComputeWorkgroupStorageSize` | 16 384 (16 KiB) | Headroom for tiled kernels | 16 384 |

Adapters usually grant more. Read what was actually granted rather than assuming the request:

```ts
import { getGpuLimit } from '../rendering/gpu-context.ts';
import { clampStorageBufferSize, clampWorkgroupSizeX } from '../rendering/webgpu-limits.ts';

const cap = clampStorageBufferSize(desiredBytes);
```

`webgpu-limits.ts` sources its `getWebGPULimits()` from the shared context and only caches once a
real device has been seen, so an early caller cannot pin the defaults for the whole session.

## Device-lost policy

1. `gpu-context.ts` registers **both** `device.lost` and `renderer.onDeviceLost` (Three's default
   only logged). Both route into one handler that runs at most once.
2. The shared context flips to `available: false`, `device: null`, `lost: true`. Any later
   `awaitGpuDevice()` returns `null`, so newly created systems start on their CPU tier.
3. Registered `onGpuDeviceLost` listeners fire. `GPUComputeLibrary` soft-disables itself and drops
   its pipeline and layout caches (they belonged to the dead device); each `ComputeParticleSystem`
   clears its GPU state so `update()` stops dispatching. A listener that throws is caught and
   logged — it cannot break the others.
4. A soft-fallback banner appears, styled after the existing renderer badge in
   `src/ui/mode-badge.ts`: a fixed `role="status"` pill with a **Reload** button. No modal, no input
   capture, no new UI system.
5. Everything is logged at `warn` level and nothing throws, so a lost device degrades the session
   instead of ending it.

All losses are treated as faults, including `reason: 'destroyed'` — nothing in the app destroys the
shared device any more, so a destroy means something external tore it down.

## Boot log

Logged once, and mirrored to `window.__gpuContext` for tests and the debug panel:

```
[GPUContext] Single WebGPU device owned by the renderer · adapter=google · swiftshader ·
powerPreference=high-performance · maxStorageBufferBindingSize=134217728 maxComputeWorkgroupSizeX=256
maxComputeInvocationsPerWorkgroup=256 maxComputeWorkgroupStorageSize=16384
```

`window.__gpuContext` carries `backend`, `available`, `lost`, `lostReason`, `reason`,
`powerPreference`, `requiredLimits`, `adapter`, `adapterName`, `limits`, `alpha`, and `antialias`.
It is published from module load, so it is always readable — before arming it reports
`available: false`. The smoke test asserts its shape on the WebGPU path.

## WebGL reference path

`?renderer=webgl` keeps parity on `powerPreference` and `antialias`, and keeps the `'srgb'`
colorSpace string literal. `alpha` is deliberately **not** forced there: Three's WebGL default is
opaque while its WebGPU default is premultiplied, so setting it would change that path's
compositing. On this path `armGpuContext` resolves the context immediately as unavailable, and every
GPU consumer takes its CPU/WASM tier.

## Out of scope

`src/systems/performance-budget/performance-budget-core.ts` still calls `requestAdapter()` for
adapter info. It creates no device and is owned by another workstream; folding it into
`getGpuContext().adapterInfo` is a follow-up.
>>>>>>> ff6e32bf3c6218a7e2c8f1413dc8f9e3eefc43c7
