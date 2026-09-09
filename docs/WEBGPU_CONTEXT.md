# WebGPU Context — Single-Device Architecture

> Owner module: [`src/rendering/gpu-context.ts`](../src/rendering/gpu-context.ts)
> Issues: #1448 (single device), #1625 (hard-fail boot probe)

> **WebGPU is required to enter the world.** A failed boot probe stops boot at a
> diagnostics screen; it does **not** start a WebGL renderer. See
> [Boot probe & hard-fail](#boot-probe--hard-fail).

> Adding a compute pass? Follow [`docs/WEBGPU_COMPUTE_PLAYBOOK.md`](./WEBGPU_COMPUTE_PLAYBOOK.md) —
> this doc is the architecture; the playbook is the step-by-step recipe and PR checklist.

Candy World creates **exactly one `GPUDevice` per page load**. `gpu-context.ts` requests it and
hands it to the Three.js renderer; nothing else in the app calls `navigator.gpu.requestAdapter()` or
`requestDevice()`.

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
  await probeWebGPU(canvas)         // THE adapter + device request (see below)
  new WebGPURenderer({ canvas, device, context, antialias, alpha, ... })
        └─ renderer._getFallback = null   // no silent WebGL swap-in
  await armGpuContext(renderer, probe)
        └─ await renderer.init()          // adopts the probed device, requests nothing
        └─ throw unless backend.isWebGPUBackend
        └─ register device.lost + renderer.onDeviceLost
        └─ resolve getGpuContext(), publish window.__gpuContext, log once
```

Passing `device` and `context` makes `WebGPUBackend.init()` take its "already provided" branch, so
the renderer never issues a request of its own. That is what lets the probe be exhaustive without
costing a second device.

Consumers never construct a device. They await the shared one and **fail closed**:

```ts
import { awaitGpuDevice } from '../rendering/gpu-context.ts';

const device = await awaitGpuDevice();
if (!device) return this.initCPUFallback(); // WASM / CPU tier, never a throw
```

`awaitGpuDevice()` resolves `null` — never rejects, never hangs — after device loss, or when no
context was armed at all (a 10 s guard covers tools and tests that boot outside `initScene`). Note
the asymmetry, and it is deliberate: **compute** fails closed to its WASM/CPU tier, but a **missing
device** fails boot. A CPU tier is a substitute for a compute pass, never for a renderer.

| Consumer                              | Behaviour without the shared device                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/compute/gpu-compute-library.ts`  | `initDevice()` rejects; `compute-init.ts` swallows it and the CPU/WASM path stays active                                                                                              |
| `src/particles/compute-particles.ts`  | `initWebGPU()` rejects; constructor catch installs `CPUParticleSystem`                                                                                                                |
| `src/utils/startup-profiler.ts`       | telemetry hooks simply never attach                                                                                                                                                   |
| `src/rendering/webgpu-limits.ts`      | reports WebGPU spec defaults                                                                                                                                                          |
| `src/rendering/clustered-lighting.ts` | CPU-bins lights; uploads via Three `StorageInstancedBufferAttribute` on the renderer device. No extra `requestDevice`. Device-lost zeros the light count and unmutes analytic lights. |

Neither consumer calls `device.destroy()` in `dispose()` any more — they release their own buffers
and leave the device to the renderer.

## Renderer context options

Set explicitly in `src/core/init.ts`, with the values defined in `gpu-context.ts`:

| Option             | Value                                     | Rationale                                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `powerPreference`  | `'high-performance'`                      | The compute devices already asked for it; the main renderer did not. On a hybrid laptop that could put the renderer on the iGPU and compute on the dGPU — two heaps and cross-adapter copies. One device, one preference. |
| `antialias`        | `true`                                    | Unchanged from before. The post chain has no full-screen AA resolve of its own, so swap-chain MSAA is still the only geometric AA. Swapping to post-AA is a visual change and out of scope.                               |
| `alpha`            | `true` → `alphaMode: 'premultiplied'`     | Three's default, pinned explicitly. HUD, loading screen, badges, and the accessibility menu are DOM layers composited over the canvas and depend on premultiplied blending.                                               |
| `requiredLimits`   | see below                                 | Aligns the renderer's device with the compute tier's ceilings.                                                                                                                                                            |
| `outputColorSpace` | `'display-p3'` / `'srgb'` string literals | Untouched. The Three enum regression is tracked separately — do not "fix" it here.                                                                                                                                        |

### Limits matrix

Every requested value is exactly a **WebGPU spec default**, so `requestDevice` can never be rejected
for asking too much — including on SwiftShader in CI. They are requested explicitly because compute
shaders bind against these ceilings.

| Limit                               | Requested             | Why                                                                                                                                                                                              | Granted (SwiftShader CI) |
| ----------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `maxStorageBufferBindingSize`       | 134 217 728 (128 MiB) | Identical to what `gpu-compute-library.ts` and `compute-particles.ts` used to request from their own devices, so moving them onto the renderer's device cannot shrink a binding that used to fit | 134 217 728              |
| `maxComputeWorkgroupSizeX`          | 256                   | Workgroup size declared by the particle and culling WGSL kernels                                                                                                                                 | 256                      |
| `maxComputeInvocationsPerWorkgroup` | 256                   | Same kernels, single-dimension dispatch                                                                                                                                                          | 256                      |
| `maxComputeWorkgroupStorageSize`    | 16 384 (16 KiB)       | Headroom for tiled kernels                                                                                                                                                                       | 16 384                   |

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

## Boot probe & hard-fail

`probeWebGPU(canvas)` in `gpu-context.ts` is the single gate, and the only caller of
`requestAdapter` / `requestDevice` in the app. It walks the whole path the world needs, in order,
and names the step that broke:

| Stage       | What it proves                                                              |
| ----------- | --------------------------------------------------------------------------- |
| `navigator` | `navigator.gpu` exists at all                                               |
| `adapter`   | `requestAdapter()` yields an adapter — **this is where Chrome and Edge diverge** |
| `device`    | `requestDevice()` grants the device, with every adapter feature and our `requiredLimits` |
| `configure` | the real world canvas configures as a swap chain                            |
| `pipeline`  | an empty `@compute` kernel compiles — culling, particles and gpu-chores all need this |

Any failure throws `WebGPUUnavailableError` (carrying `.stage`), which `runScenePipeline` turns into
the blocking screen in [`src/ui/webgpu-fatal.ts`](../src/ui/webgpu-fatal.ts): advice for the stage,
the browser brand, and copyable diagnostics JSON. **No renderer is constructed.**

`WebGPU.isAvailable()` is *not* the gate — it only checks that `navigator.gpu` exists, which is
exactly the case that used to boot to WebGL: the object is present and the adapter request dies
later. It is kept only to surface Three's browser-specific advisory text.

### Why the probe has to exist

`WebGPURenderer`'s constructor unconditionally installs a `getFallback` that swaps in `WebGLBackend`
whenever `WebGPUBackend.init()` throws, and `Renderer.init()` takes it with nothing but a
`console.warn`. The world then renders — on WebGL — and looks fine. That silent render is what hid
the Chrome-vs-Edge adapter failure. `init.ts` now clears `renderer._getFallback`, and
`armGpuContext` throws if `backend.isWebGLBackend` is ever true.

### Reading the verdict

`window.webgpuProbe` is published on success *and* failure:

```jsonc
{
  "ok": false,
  "stage": "adapter",
  "reason": "requestAdapter() resolved null — no WebGPU adapter is available (...)",
  "browser": { "name": "Microsoft Edge", "version": "124.0.0.0", "brands": [...], "userAgent": "..." },
  "adapter": null,
  "adapterName": "unknown",
  "isFallbackAdapter": false,
  "limits": null
}
```

`browser.name` comes from `navigator.userAgentData.brands` when available, falling back to a UA
regex that checks `Edg/` before `Chrome/` — Edge sends both, so a report that only said "Chromium"
could not tell the two failures apart. Device loss later rewrites the report with
`stage: "renderer"` and a `device-lost:` reason rather than dropping the original detail.

Unit coverage: [`tests/webgpu-probe.test.mjs`](../tests/webgpu-probe.test.mjs)
(`npm run test:webgpu-probe`) drives every stage against fakes and asserts one `requestAdapter` per
page.

## WebGL: deferred

The WebGL path is **disabled this phase**, not deleted — restoring it is a later issue wave.

| Input                                | Status                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `?renderer=webgl` / `webgl2` / `?webgl` | Warn, then ignored — `resolveRendererBackend()` always returns `webgpu` |
| `?webglLite=1`                       | No longer implies a WebGL boot. `?lite` still only trims world density  |
| `localStorage candy.renderer`        | Ignored; `switchRendererPreference('webgl')` refuses out loud           |
| `RENDERER=webgl npm run test`        | The smoke runner exits 1 rather than booting GL to make CI green        |

None of these can rescue boot. A green run on a backend the app will not ship is worse than no run
at all, so CI is expected-fail here rather than silently passing on GL.

`src/rendering/webgl-debug.ts` and the `mode === 'webgl'` branches downstream are dead but kept, so
the restore wave flips `resolveRendererBackend()` and the probe's fatality in one place instead of
re-deriving them.
