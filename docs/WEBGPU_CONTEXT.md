# WebGPU Context — Single-Device Architecture

> Owner module: [`src/rendering/gpu-context.ts`](../src/rendering/gpu-context.ts)
> Issues: #1448 (single device), #1625 (hard-fail boot probe), #1753 (adapter-clamped limits, canvas color space)

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
| `requiredLimits`   | adapter-clamped, see below                | Aligns the renderer's device with the compute tier's ceilings. Informational on the renderer: the device is already created by the probe.                                                                                 |
| `outputColorSpace` | `'display-p3'` / `'srgb'` string literals | Chosen by the probe and mirrored onto the canvas `colorSpace` — see [Color space](#color-space). String literals stay: the Three enum regression is tracked separately.                                                   |
| `trackTimestamp`   | `probe.timestampQuery`                    | `true` only when the device was granted `timestamp-query`. Three cannot add a feature to a device it did not create, so asking for timings without the feature would leave Three warning and the queries dead.            |

### Feature allowlist

`requiredFeatures` is an allowlist (`resolveRequiredFeatures()` in `gpu-context.ts`), never
`[...adapter.features]`. Features are not independent booleans: requiring every advertised one can
reject `requestDevice` on adapters where a feature needs limits we did not ask for.

| List                    | Contents                                                                                    | Requested when                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GPU_REQUIRED_FEATURES` | _(empty)_ — boot runs on core WebGPU                                                        | always (a missing one fails the `device` stage)                                       |
| `GPU_OPTIONAL_FEATURES` | `depth32float-stencil8`, `float32-filterable`, `rg11b10ufloat-renderable`, `clip-distances` | the adapter advertises it — each is read by Three r171                                |
| `GPU_TIMING_FEATURE`    | `timestamp-query`                                                                           | `?debug`, `?postfx=high`, or `?gpuTiming=1` (`=0` forces off), and the adapter has it |

Everything else the adapter supports is only logged, in `window.webgpuProbe.features.adapter`.
With timings granted, [`src/rendering/gpu-timestamps.ts`](../src/rendering/gpu-timestamps.ts)
reads each pass's timestamp buffer every 30 frames, off the hot path — see
[`PERF_BUDGETS.md`](PERF_BUDGETS.md#runtime-overlay).

### Limits matrix

`requiredLimits` are **adapter-aware**. `resolveRequiredLimits()` asks for, per key:

```
software / fallback adapter (SwiftShader, llvmpipe, isFallbackAdapter):  floor
hardware adapter:  min(adapter.limits[k], max(floor, desired))
key not reported:  floor            (spec-guaranteed)
```

so `requestDevice` can never be rejected for asking more than the adapter advertises, and SwiftShader
in CI is never asked for more than the spec defaults. `maxStorageBufferBindingSize` is additionally
capped at the requested `maxBufferSize`.

| Limit                               | Floor (spec default)  | Desired (hardware)    | Why                                                                                                                                                                   | SwiftShader CI requests |
| ----------------------------------- | --------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `maxBufferSize`                     | 268 435 456 (256 MiB) | 536 870 912 (512 MiB) | A storage binding can never exceed its buffer                                                                                                                         | 268 435 456             |
| `maxStorageBufferBindingSize`       | 134 217 728 (128 MiB) | 536 870 912 (512 MiB) | Floor is what `gpu-compute-library.ts` / `compute-particles.ts` used to request from their own devices; the soft ceiling lets big adapters grow particle/cull buffers | 134 217 728             |
| `maxComputeWorkgroupSizeX`          | 256                   | 256                   | Workgroup size declared by the particle and culling WGSL kernels                                                                                                      | 256                     |
| `maxComputeInvocationsPerWorkgroup` | 256                   | 256                   | Same kernels, single-dimension dispatch                                                                                                                               | 256                     |
| `maxComputeWorkgroupStorageSize`    | 16 384 (16 KiB)       | 16 384 (16 KiB)       | Headroom for tiled kernels                                                                                                                                            | 16 384                  |

`GPU_REQUIRED_LIMITS` is the floor (also what `getGpuLimit()` falls back to before a device exists);
`GPU_DESIRED_LIMITS` is the soft ceiling. `window.webgpuProbe.limitRequest` records the whole
negotiation per key — `{ floor, desired, adapter, requested, granted }` — so a report shows what we
asked for next to what the device actually has.

Adapters usually grant more. Read what was actually granted rather than assuming the request:

```ts
import { getGpuLimit } from '../rendering/gpu-context.ts';
import { clampStorageBufferSize, clampWorkgroupSizeX } from '../rendering/webgpu-limits.ts';

const cap = clampStorageBufferSize(desiredBytes);
```

`webgpu-limits.ts` sources its `getWebGPULimits()` from the shared context and only caches once a
real device has been seen, so an early caller cannot pin the defaults for the whole session.

## Color space

There are two different surfaces, and they are deliberately different:

| Surface                         | Format                                                                    | Color space                                |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| HDR render targets (post chain) | `rgba16float` (`HalfFloatType`)                                           | linear working space                       |
| Swap chain (`canvas.configure`) | `navigator.gpu.getPreferredCanvasFormat()` — usually `bgra8unorm` (8-bit) | `colorSpace` = `renderer.outputColorSpace` |

HDR lives in the half-float targets; tone mapping + Three's output transform write the 8-bit swap
chain. The swap chain is **not** `rgba16float` / `toneMapping: { mode: 'extended' }`, so "HDR" here
means wide-gamut `display-p3` output, not extended-range pixels.

How the two are kept in agreement:

1. `probeWebGPU()` picks the color space once — `display-p3` when `(dynamic-range: high)` matches,
   else `srgb` (`resolveCanvasColorSpace()`) — and passes it as `colorSpace` on `configure`.
2. `init.ts` sets `renderer.outputColorSpace` from `probe.canvas.colorSpace` (with the existing
   `srgb` fallback if Three rejects P3).
3. `WebGPUBackend.init()` (three 0.171) calls `configure()` again **without** `colorSpace`, which
   resets it to `srgb`. `init.ts` therefore calls `applyCanvasColorSpace(probe, outputColorSpace)`
   after arming, re-tagging the same device/format/alphaMode with the color space the renderer
   actually uses.

`window.webgpuProbe.canvas` reports `{ format, alphaMode, colorSpace }` as finally applied.

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
powerPreference=high-performance · maxBufferSize=268435456/268435456
maxStorageBufferBindingSize=134217728/134217728 maxComputeWorkgroupSizeX=256/256 ...
```

Each limit is logged as `granted/requested`.

`window.__gpuContext` carries `backend`, `available`, `lost`, `lostReason`, `reason`,
`powerPreference`, `requiredLimits`, `adapter`, `adapterName`, `limits`, `alpha`, and `antialias`.
It is published from module load, so it is always readable — before arming it reports
`available: false`. The smoke test asserts its shape on the WebGPU path.

## Boot probe & hard-fail

`probeWebGPU(canvas)` in `gpu-context.ts` is the single gate, and the only caller of
`requestAdapter` / `requestDevice` in the app. It walks the whole path the world needs, in order,
and names the step that broke:

| Stage       | What it proves                                                                           |
| ----------- | ---------------------------------------------------------------------------------------- |
| `navigator` | `navigator.gpu` exists at all                                                            |
| `adapter`   | `requestAdapter()` yields an adapter — **this is where Chrome and Edge diverge**         |
| `device`    | `requestDevice()` grants the device, with the feature allowlist and our `requiredLimits` |
| `configure` | the real world canvas configures as a swap chain                                         |
| `pipeline`  | an empty `@compute` kernel compiles — culling, particles and gpu-chores all need this    |

Any failure throws `WebGPUUnavailableError` (carrying `.stage`), which `runScenePipeline` turns into
the blocking screen in [`src/ui/webgpu-fatal.ts`](../src/ui/webgpu-fatal.ts): advice for the stage,
the browser brand, and copyable diagnostics JSON. **No renderer is constructed.**

`WebGPU.isAvailable()` is _not_ the gate — it only checks that `navigator.gpu` exists, which is
exactly the case that used to boot to WebGL: the object is present and the adapter request dies
later. It is kept only to surface Three's browser-specific advisory text.

### Why the probe has to exist

`WebGPURenderer`'s constructor unconditionally installs a `getFallback` that swaps in `WebGLBackend`
whenever `WebGPUBackend.init()` throws, and `Renderer.init()` takes it with nothing but a
`console.warn`. The world then renders — on WebGL — and looks fine. That silent render is what hid
the Chrome-vs-Edge adapter failure. `init.ts` now clears `renderer._getFallback`, and
`armGpuContext` throws if `backend.isWebGLBackend` is ever true.

### Reading the verdict

`window.webgpuProbe` is published on success _and_ failure:

```jsonc
{
  "ok": false,
  "stage": "adapter",
  "reason": "requestAdapter() resolved null — no WebGPU adapter is available (...)",
  "browser": { "name": "Microsoft Edge", "version": "124.0.0.0", "brands": [...], "userAgent": "..." },
  "adapter": null,
  "adapterName": "unknown",
  "isFallbackAdapter": false,
  "limits": null,               // granted device limits (all numeric keys)
  "requiredLimits": { ... },    // what requestDevice was asked for (adapter-clamped)
  "limitRequest": null,         // per key: { floor, desired, adapter, requested, granted }
  "features": null,             // { adapter: [...], requested: [...], granted: [...] | null, timingWanted }
  "canvas": null                // { format, alphaMode, colorSpace } once configured
}
```

`browser.name` comes from `navigator.userAgentData.brands` when available, falling back to a UA
regex that checks `Edg/` before `Chrome/` — Edge sends both, so a report that only said "Chromium"
could not tell the two failures apart. Device loss later rewrites the report with
`stage: "renderer"` and a `device-lost:` reason rather than dropping the original detail.

Unit coverage: [`tests/webgpu-probe.test.mjs`](../tests/webgpu-probe.test.mjs)
(`npm run test:webgpu-probe`) drives every stage against fakes and asserts one `requestAdapter` per
page.

## WebGL: not available

There is **no WebGL renderer**, not even as a debug path. Every WebGL input is ignored:

| Input                                   | Status                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `?renderer=webgl` / `webgl2` / `?webgl` | Warn, then ignored — `resolveRendererBackend()` always returns `webgpu` |
| `?webglLite=1`                          | No WebGL boot. `?lite` still only trims world density                   |
| `?wireframe=1` / `?matDebug=1`          | No-ops (WebGL-only helpers); debug-panel buttons are disabled           |
| `localStorage candy.renderer`           | Ignored; `switchRendererPreference('webgl')` refuses out loud           |
| `RENDERER=webgl npm run test`           | The smoke runner exits 1 rather than booting GL to make CI green        |

None of these can rescue boot. A green run on a backend the app will not ship is worse than no run
at all.

`src/rendering/webgl-debug.ts` and the `mode === 'webgl'` branches downstream are dormant — they
never execute while the active backend is WebGPU — and are kept only so a future, explicitly scoped
restore flips `resolveRendererBackend()` and the probe's fatality in one place. The old reference-path
notes are archived in [`archive/webgl-fallback-restore-notes.md`](./archive/webgl-fallback-restore-notes.md).
