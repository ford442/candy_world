# WebGPU Context — Single-Device Architecture

> Owner module: [`src/rendering/gpu-context.ts`](../src/rendering/gpu-context.ts)
> Issues: #1448 (single device), #1625 (hard-fail boot probe), #1753 (adapter-clamped limits, canvas color space), #1972 (run mode, platform capabilities, P3 registration); optional feature tiers and HDR output (extended-range swap chain)

> **WebGPU is preferred; WebGL2 is the fallback.** A failed boot probe boots the world on
> `WebGPURenderer({ forceWebGL: true })` and says so in the UI. Only when WebGL2 fails too does boot
> stop at a diagnostics screen. See [Boot probe & WebGL2 fallback](#boot-probe--webgl2-fallback)
> and [`webgl-fallback.md`](./webgl-fallback.md).

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
        └─ throws → WebGPURenderer({ forceWebGL: true }) + settleWebGLContext()  // fallback
  new WebGPURenderer({ canvas, device, context, antialias, alpha, ... })
  await armGpuContext(renderer, probe)
        └─ await renderer.init()          // adopts the probed device, requests nothing
        └─ throw unless backend.isWebGPUBackend   // Three's own WebGL swap-in is refused here
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

`awaitGpuDevice()` resolves `null` — never rejects, never hangs — after device loss, on the WebGL2
fallback (immediately: the failed probe settles the context), or when no context was armed at all
(a 10 s guard covers tools and tests that boot outside `initScene`). **Compute** fails closed to its
WASM/CPU tier; a **missing device** switches the renderer to WebGL2, where no GPU compute runs.

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

| Option             | Value                                     | Rationale                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `powerPreference`  | `'high-performance'`                      | The compute devices already asked for it; the main renderer did not. On a hybrid laptop that could put the renderer on the iGPU and compute on the dGPU — two heaps and cross-adapter copies. One device, one preference.                                                                                                              |
| `antialias`        | `false` (`true` only with `?postfx=off`)  | The world is drawn into the post-FX scene pass, which asks for its own 4× MSAA (`SCENE_PASS_SAMPLES`); the canvas only receives the fullscreen post quad, so canvas MSAA was a second 4× buffer for nothing. `?postfx=off` draws the world to the canvas directly and keeps it. See [POSTFX_STACK.md](./POSTFX_STACK.md#antialiasing). |
| `alpha`            | `true` → `alphaMode: 'premultiplied'`     | Three's default, pinned explicitly. HUD, loading screen, badges, and the accessibility menu are DOM layers composited over the canvas and depend on premultiplied blending.                                                                                                                                                            |
| `requiredLimits`   | adapter-clamped, see below                | Aligns the renderer's device with the compute tier's ceilings. Informational on the renderer: the device is already created by the probe.                                                                                                                                                                                              |
| `outputColorSpace` | `'display-p3'` / `'srgb'` string literals | Chosen by the probe and mirrored onto the canvas `colorSpace` — see [Color space](#color-space). String literals stay: the Three enum regression is tracked separately.                                                                                                                                                                |

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

## Optional features

The device is requested with an **allowlist**, never `Array.from(adapter.features)` and never a
requirement: `GPU_REQUIRED_FEATURES` is empty, and each entry of `GPU_OPTIONAL_FEATURES`
(`src/core/platform/capabilities.ts`, re-exported by `gpu-context.ts`) is asked for only when the
adapter advertises it (`selectRequiredFeatures()`). A device that lacks one boots the same world on
the slower path. SwiftShader as Chromium ships it advertises every tier except `shader-f16`, so CI
boots with four of them granted and exercises those paths (a headless boot shows 0 uncaptured GPU
errors with them on); the `shader-f16` fallbacks are what CI covers for that one.

| Feature                    | Used for                                                                                                                                                   | Without it                                           | Switch              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------- |
| `timestamp-query`          | GPU frame time → dynamic resolution and the performance budget ([below](#gpu-frame-time-timestamp-query))                                                  | no GPU time; the scene pass stays at full resolution | `?dynres=0` / `off` |
| `shader-f16`               | half precision (`enable f16;`) in foliage wind/sway and particle integrators                                                                               | f32                                                  | `?gpuFeatures=off`  |
| `float32-filterable`       | linear filtering of `r32float` / `rgba32float` (irradiance probes, atmosphere LUTs). Three r186 switches `FloatType` texture bindings to `float` by itself | `unfilterable-float`, manual bilinear                | `?gpuFeatures=off`  |
| `subgroups`                | subgroup prefix sum in the cull/compact pass. Three r186 adds `enable subgroups;` and `subgroupSize` to every compute shader                               | workgroup shared-memory scan                         | `?gpuFeatures=off`  |
| `indirect-first-instance`  | one instance buffer serving many `drawIndexedIndirect` calls (GPU-driven culling)                                                                          | one instance buffer per draw                         | `?gpuFeatures=off`  |
| `rg11b10ufloat-renderable` | a cheaper HDR scene target than `rgba16float`                                                                                                              | `rgba16float`                                        | `?gpuFeatures=off`  |

Three r186 asks for every adapter feature when it creates a device itself; we hand it ours, so the
allowlist is what keeps junk (and anything untested) out. `?gpuFeatures=off` (or `0` / `none`)
requests none of the tiers except `timestamp-query`, which keeps its own `?dynres` switch; use it to
bisect a rendering difference down to a feature.

Systems ask once, at init, never per frame:

```ts
import { getPlatformCapabilities } from '../core/platform/capabilities.ts';

const f16 = getPlatformCapabilities().gpu.has('shader-f16'); // false on WebGL2, always
```

`capabilities.gpu` is `{ features, has(name) }`, frozen: the granted optional features in list order
(`grantedOptionalFeatures(probe)`), empty on WebGL2. The probe report records, per feature, what the
adapter advertised, what was requested and what the device granted
(`window.webgpuProbe.features.optional['shader-f16'] = { adapter, requested, granted }`). The renderer
badge's tooltip and `data-features` list the granted ones, and the `?debug` panel shows ✓ / · for
each under **Renderer**.

So far the tiers are requested, reported and exposed; Three's own reactions to `subgroups` and
`float32-filterable` are the only behaviour they change. The consumers named in the table adopt them
one at a time, each behind `gpu.has()`.

## Color space

There are two surfaces:

| Surface                         | SDR swap chain (default)                                                     | HDR swap chain (extended range)                    |
| ------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| Post chain render targets       | `rgba16float` (`HalfFloatType`), linear working space                        | same                                               |
| Swap chain (`canvas.configure`) | `getPreferredCanvasFormat()` (usually `bgra8unorm`), `toneMapping: standard` | `rgba16float`, `toneMapping: { mode: 'extended' }` |
| Canvas `colorSpace`             | `srgb`                                                                       | `display-p3`                                       |
| Tone mapping                    | ACES filmic                                                                  | none, highlights rolled off at the HDR peak        |

The SDR column is what every SDR display, every WebGL2 boot and every browser that cannot report an
extended configure gets, unchanged from before HDR output existed.

### HDR output

`probeWebGPU()` tries an extended-range swap chain when `wantsExtendedRange()`:
`(dynamic-range: high)` matches **and** the player has not turned HDR off
(`src/core/platform/hdr-preference.ts`). It configures `rgba16float` +
`toneMapping: { mode: 'extended' }` + `display-p3`, then reads it back with
`context.getConfiguration()`. Browsers drop dictionary members they do not know, so a configure can
succeed and still be standard range; only a context that reports `extended` back keeps the HDR
configure. Otherwise (no `getConfiguration`, standard reported, or the configure threw) the probe
configures the SDR swap chain, the only configure that can fail the probe. `window.webgpuProbe.hdr`
records `{ display, preference, attempted, configured, reason }`.

What follows from `probe.canvas.toneMapping === 'extended'` (`extendedRangeConfigured(probe)`):

- `init.ts` builds the renderer with `outputType: HalfFloatType`. Three then configures the canvas
  as `rgba16float` + extended itself, and every pipeline that draws to the canvas targets
  `rgba16float`. SDR boots leave `outputType` unset, so their format is untouched.
- `initPlatformCapabilities({ extendedRange })` takes it from the probe (there is no constant any
  more), so `capabilities.hdr.extendedRange` is what was configured, not what was hoped for.
- `init.ts` registers Display P3 (`ensureOutputColorSpace()`), sets `outputColorSpace = 'display-p3'`
  and `NoToneMapping`. Not `LinearToneMapping`: Three r186's `linearToneMapping` clamps to [0, 1],
  which would clip exactly what extended range is for. Bloom, emissive lanterns, crystal ribs and blaster beams keep their
  values above 1.0 instead of being clipped by ACES.
- The post graph (`post-processing-webgpu.ts`, built with `hdr: { knee }`) rolls highlights off on
  the brightest channel: identity up to `0.75 × peak`, then an exponential shoulder that meets it
  with slope 1 and approaches the peak (`hdrRolloff()` is the tested CPU twin). One factor for all
  channels keeps hue. `uHdrPeak` follows the player's setting live. On SDR the node is not in the
  graph at all. `?postfx=off` draws straight to the canvas and has no roll-off.
- The badge reads **WEBGPU · HDR**, with `data-hdr="extended"`.

Player controls: **Accessibility → Visual → HDR Output** (`auto` / `off`, applies on reload: the
canvas format and every pipeline targeting it are fixed at boot) and **HDR Peak Brightness**
(1–8 × SDR white, default 4, applies at once). Both are stored in `localStorage candy.hdr`, outside the
accessibility settings, because the probe reads the mode before the menu's chunk has loaded. URL
overrides: `?hdr=off` / `?hdr=auto`, `?hdrPeak=<n>`.

### Keeping the two surfaces in agreement

- `resolveHdrSupport(display, extendedRange)` (`src/core/platform/capabilities.ts`) returns
  `canvas: 'display-p3'` only when both are true, and `resolveCanvasColorSpace(extendedRange)` applies
  it at probe time.
- Three (0.186 as in 0.171) registers only `srgb` / `srgb-linear`. An unregistered `outputColorSpace`
  makes the output transform's `ColorManagement.getPrimaries()` throw a TypeError on first render, and
  the `try` around the assignment never sees it. `ensureOutputColorSpace()`
  (`src/rendering/color-spaces.ts`) registers Display P3 from `three/addons/math/ColorSpaces.js` via
  `ColorManagement.define` before P3 is selected, and returns `srgb` for anything Three still doesn't
  know. If that happens on an extended swap chain the world renders sRGB + ACES into it, which looks
  like SDR.
- `NoToneMapping` is used only together with an extended-range P3 swap chain. Into an 8-bit swap
  chain it just clips highlights, so SDR keeps ACES.

The sequence:

1. `probeWebGPU()` picks format, tone mapping and color space once (above) and passes them on
   `configure`.
2. `init.ts` sets `renderer.outputColorSpace` from `probe.canvas.colorSpace` and
   `platformCaps.hdr`, going through `ensureOutputColorSpace()`.
3. `WebGPUBackend` (three 0.186) calls `configure()` again **without** `colorSpace`, which resets it
   to `srgb`: lazily on the first frame, and after every resize (`updateSize()` drops its cached
   context). `init.ts` calls `applyCanvasColorSpace(probe, outputColorSpace)` after arming, which
   re-tags the swap chain with the color space the renderer actually uses and pins it, together with
   the tone-mapping mode, on the context instance, so each of Three's later configures carries both.
4. Device recovery keeps the backend's parameters (`outputType` included), re-probes the same way and
   re-applies the pin.

`window.webgpuProbe.canvas` reports `{ format, alphaMode, colorSpace, toneMapping }` as finally
applied.

## Run mode & platform capabilities

Behaviour never branches on the user-agent string. `src/core/platform/` answers two separate
questions (#1972):

| Module            | Answers                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run-mode.ts`     | `getRunMode()`: `'automation'` only for `navigator.webdriver`, `window.__IS_FULL_BOOT_TEST` or a `HeadlessChrome/` token, otherwise `'player'`. `isAutomation()` |
| `capabilities.ts` | `getPlatformCapabilities()`: frozen `{ runMode, backend, tier, computeAvailable, timestampQuery, gpu, hdr, maxPixelRatio }`                                      |
| `user-agent.ts`   | `readUserAgent()`, the only raw `navigator.userAgent` read, for reporting (analytics, profiler, probe report)                                                    |

- The old `isCIorHeadless()` regex `/headless|playwright|ci|test/i` matched "Ma**ci**ntosh". Every
  Mac player booted in CI mode (low graphics, post-FX/GI/AO/shadows/compute off, 15% foliage) and
  never got `setAnimationLoop`. It is gone, and an ESLint `no-restricted-syntax` rule rejects
  `navigator.userAgent` outside `src/core/platform/`.
- Call sites ask the specific question: per-frame `renderer.compute()` dispatches check
  `computeAvailable` (WebGPU backend and a player); the reduced harness profile (post-FX/GI/AO/local
  shadows off, warmup skipped, particle stubs, `getCIAdjustedCount`) checks `isAutomation()`.
- `initPlatformCapabilities()` runs in `initScene()` once the backend, adapter and granted features
  are known, and publishes `window.__platformCapabilities`. Before that, `getPlatformCapabilities()`
  returns an uncached provisional answer.
- `tier` comes from `?graphics=`, backend / fallback adapter, `navigator.deviceMemory` and the
  adapter's light-load hint. It is published for diagnostics; graphics decisions still go through
  `StartupCapabilities` (`src/core/startup/capabilities.ts`). No GPU-time probe yet.
- `maxPixelRatio` is tier-scaled: `low` and every WebGL2 boot render at 1, `medium` at 1.25,
  `high` at 1.5 (Chrome reports at most 8 GB of `deviceMemory`, so most Chrome players are
  `medium`). See [Viewport](#viewport-pixel-ratio-and-resize).
- The animation loop always starts. `?freezeLoop=1` is the only way to boot to `__sceneReady`
  without it; the smoke, boot-timing, population and visual-regression harnesses pass it.
- `src/core/platform/` is a leaf with its own Vite chunk (`platform`). `weather` calls into it while
  it evaluates, before `app` has run, and module state inside `app` would still be in TDZ then.

## Viewport, pixel ratio and resize

`src/rendering/viewport.ts` is the only code that sizes the renderer. `initScene()` calls
`installViewport(renderer, camera, caps.maxPixelRatio)`, which:

- sets `pixelRatio = min(devicePixelRatio, maxPixelRatio)`, the window size and the camera aspect;
- re-applies all three on `window` `resize` (one listener; `init.ts` and both post-FX graphs used to
  add their own);
- watches `matchMedia('(resolution: <dpr>dppx)')` and re-applies when it stops matching (window
  dragged to a monitor with a different DPR, browser zoom), re-arming for the new DPR;
- then calls each `onViewportResize()` subscriber. `scene-pipeline.ts` subscribes the post-FX
  `syncSize` (`postProcessing.needsUpdate`; a no-op for `?postfx=off`).

The canvas sits directly in `<body>`, whose height is its content, so there is no viewport-sized
container a `ResizeObserver` could watch without missing height-only resizes; the window stays the
size source.

## Shader warmup

`compileSceneProgressively()` (`src/rendering/shader-warmup.ts`) calls `renderer.compileAsync()` on
the real scene with the real camera, in chunks of 48 objects with an event-loop turn between them.
It runs at boot (`core/main/shader-warmup.ts`, before world generation) and again 2 s after world
generation (`runDeferredWarmup()` in `core/deferred-init.ts`). Both skip automation; the boot pass
also skips `safeMode`, the deferred pass `?boot=instant`.

- **Why:** the old warm-up rendered a clone of each preset material into a 1×1 HalfFloat target
  without depth or MSAA, then disposed it, which released the pipeline. Only the browser shader
  cache benefited. Compiling the real objects keeps their render objects, node builder states and
  pipelines for the next frame.
- **Chunks without changing the program:** the scene stays the root of every call (so fog, the
  environment and the full light list are the frame's), and each chunk is selected through camera
  layer 31 (`WARMUP_LAYER`). Layers, `frustumCulled`, the render target and MRT are swapped and
  restored synchronously around the call: Three projects and builds before its first `await`.
- **Target:** Three keys render objects and pipelines on the render target. The post-FX scene pass
  draws into its own `rgba16float` target with its own 4× MSAA, so `initWebGPUPostProcessing()`
  exposes `compileTarget()` (the pass target, with samples mirrored from `PassNode.setup()`, and its
  MRT). Without post-FX the default is the target `render()` itself uses
  (`renderer._getFrameBufferTarget()`), or the canvas.
- **A failed pipeline cannot hang boot:** Three 0.171 wrapped `createRenderPipelineAsync()` in a
  promise that only resolved, so a rejection left `compileAsync()` pending forever; the warmup used
  to route rejections to the sync `createRenderPipeline()` around each call. Three r172+ always
  settles it (it logs, marks the pipeline failed and resolves), so that guard is gone. Warmup stops
  once the renderer reports `_isDeviceLost`.
- **Once per object:** each renderer remembers which objects it compiled with which material, so the
  deferred pass skips what the boot pass already built (`alreadyCompiled` in its stats).
- `forceFullSceneWarmup()` (never called) and the per-material `ShaderWarmup` class are gone.

## GPU frame time (timestamp-query)

`timestamp-query` is requested on every boot whose adapter advertises it, unless `?dynres=0` /
`?dynres=off` opts out (#2137), and the renderer is then built with `trackTimestamp`. Three writes every render and compute pass's
timestamps into a query pool per type; nothing reads it back unless the app asks, because the game
loop renders synchronously. `createGpuFrameTimer()` (`src/rendering/gpu-frame-timer.ts`) calls the
public `renderer.resolveTimestampsAsync('render' | 'compute')` every 30 frames and reports the sum
(the GPU time of the last frame in the pool) to `performanceBudget.setGpuFrameTime()` and to the
post graph, whose dynamic resolution runs on it
([`POSTFX_STACK.md`](./POSTFX_STACK.md#dynamic-resolution)). One resolve is in flight at a time;
Three skips the copy into a still-mapped result buffer, so nothing stalls. On r171 this had to wrap
the private `prepareTimestampBuffer()` and map Three's per-pass buffers itself. Without the feature
the timer is a no-op and `gpuFrameTime` stays `null`.

## Device-lost policy

1. `gpu-context.ts` registers **both** `device.lost` and `renderer.onDeviceLost`. Three's default
   handler logged and set `renderer._isDeviceLost`; ours sets that flag too, so `render()`,
   `compute()` and `compileAsync()` stop submitting work (r171's `compute()` ignored the flag and had
   to be stubbed). Both route into one handler that runs at most once per loss. Three r186 forwards
   `uncapturederror` to `renderer.onError`, whose default is a `console.error` per event;
   `gpu-context.ts` routes it into `recordGpuError()` (counted, console-capped) instead. On
   the WebGL2 fallback, `watchWebGLContextLoss()` routes `webglcontextlost` into the same handler
   (see [`webgl-fallback.md`](./webgl-fallback.md#context-loss)).
2. The shared context flips to `available: false`, `device: null`, `lost: true`. Any later
   `awaitGpuDevice()` returns `null`, so newly created systems start on their CPU tier.
3. Registered `onGpuDeviceLost` listeners fire. `GPUComputeLibrary` soft-disables itself and drops
   its pipeline and layout caches (they belonged to the dead device); each `ComputeParticleSystem`
   clears its GPU state and hides its points. A listener that throws is caught and logged — it
   cannot break the others.
4. **Recovery**, unless the device was `destroyed` (nothing in the app destroys the shared device,
   so that is a deliberate teardown, not a fault). The frame loop is paused (the scheduler runs
   inside it), and `device-recovery.ts`, a lazy chunk, rebuilds the renderer **in place**: a new
   device from the same probe as boot (adapter → device → canvas configure → compute pipeline), a
   new backend on it, and `Renderer.init()` again on the same renderer object. Three's `init()`
   builds every manager (nodes, textures, geometries, pipelines, bindings, render contexts) from
   scratch, so every GPU object of the dead device is dropped and re-created from its CPU-side
   source on first use: textures from their images and data, buffers from their arrays, materials,
   TSL compute and the post graph from their nodes. Every module holding the renderer keeps a valid
   reference. Then the loop resumes and `onGpuDeviceRestored` listeners fire: `GPUComputeLibrary`
   adopts the new device (plant pose, foliage batches and chores come back lazily) and compute
   particles rebuild their GPU path. What only ever lived on the GPU — render-target contents,
   compute results, TRAA history — starts over. The GPU foliage animator stays on its CPU tier
   for the session.
5. Two attempts, a second apart. Only when both fail (no adapter, a rejected device, a failed
   `init()`, or on WebGL2 no `webglcontextrestored` within 10 s) does a banner appear, styled after
   the renderer badge in `src/ui/mode-badge.ts`: a fixed `role="alert"` pill reading **Graphics
   stopped —** with a **Reload** button. A fourth loss inside a minute of three recoveries goes
   straight to the banner rather than chasing a GPU that keeps resetting.
6. Everything is logged at `warn` level and nothing throws. `window.__gpuContext` reports
   `recovering` and `recoveries`.

To check by hand, add `?debug_lose_device` (optionally `=<seconds>`, default 5): that long after
the scene is up it calls `device.destroy()`, marked as simulated so recovery runs despite the
`destroyed` reason. The world pauses for a moment and carries on; `window.__gpuContext.recoveries`
becomes 1. A plain `game.renderer.backend.device.destroy()` in devtools is a real destroy: the
banner appears and `window.__gpuContext.lost` stays `true`.

### Uncaptured errors

`armGpuContext()` also listens for the device's `uncapturederror`. Each error is recorded as
`{ type: 'validation' | 'out-of-memory' | 'internal' | 'unknown', message, at }` on
`window.__gpuContext.errors` (`count`, plus the last 20 in `recent`); the first three are echoed with
`console.warn`. The event is not cancelled, so the browser still logs it as well.

## Boot log

Logged once, and mirrored to `window.__gpuContext` for tests and the debug panel:

```
[GPUContext] Single WebGPU device owned by the renderer · adapter=google · swiftshader ·
powerPreference=high-performance · maxBufferSize=268435456/268435456
maxStorageBufferBindingSize=134217728/134217728 maxComputeWorkgroupSizeX=256/256 ...
```

Each limit is logged as `granted/requested`.

`window.__gpuContext` carries `backend`, `available`, `lost`, `lostReason`, `reason`,
`powerPreference`, `requiredLimits`, `adapter`, `adapterName`, `limits`, `alpha`, `antialias` (canvas MSAA),
`contextRestored` (WebGL2) and `errors` (`{ count, recent }`, see above).
It is published from module load, so it is always readable — before arming it reports
`available: false`. The smoke test asserts its shape on the WebGPU path.

## Boot probe & WebGL2 fallback

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

Any failure throws `WebGPUUnavailableError` (carrying `.stage`). `createRenderer()` catches it and
boots `WebGPURenderer({ forceWebGL: true })` instead, then calls `settleWebGLContext(reason)` so
`__gpuContext.backend` reads `webgl`. The probe report keeps the failing stage, and the renderer
badge, `window.rendererFallbackReason` and the console all name it — see
[`webgl-fallback.md`](./webgl-fallback.md).

Only when WebGL2 cannot start either (stage `webgl`) — or when the probe passed and the WebGPU
renderer still failed (stage `renderer`, see `armGpuContext`) — does `runScenePipeline` show the
blocking screen in [`src/ui/webgpu-fatal.ts`](../src/ui/webgpu-fatal.ts): advice for the stage, the
browser brand, and copyable diagnostics JSON.

`WebGPU.isAvailable()` is _not_ the gate — it only checks that `navigator.gpu` exists; the object
can be present while the adapter request dies later.

### Why the probe has to exist

`WebGPURenderer`'s constructor unconditionally installs a `getFallback` that swaps in `WebGLBackend`
whenever `WebGPUBackend.init()` throws, and `Renderer.init()` takes it with nothing but a
`console.warn`. The world then renders — on WebGL — and looks fine. That silent render is what hid
the Chrome-vs-Edge adapter failure. `init.ts` therefore clears `renderer._getFallback` on both
renderers, and `armGpuContext` throws if a probed WebGPU renderer lands on `WebGLBackend`. The
WebGL2 path is chosen explicitly, from the probe verdict, and is always announced.

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
  "features": { "adapter": [], "requested": [], "granted": null, "timestampQuery": false,
                "optional": { "shader-f16": { "adapter": false, "requested": false, "granted": false }, ... } },
  "canvas": null,               // { format, alphaMode, colorSpace, toneMapping } once configured
  "hdr": null                   // { display, preference, attempted, configured, reason }
}
```

`browser.name` comes from `navigator.userAgentData.brands` when available, falling back to a UA
regex that checks `Edg/` before `Chrome/` — Edge sends both, so a report that only said "Chromium"
could not tell the two failures apart. Device loss later rewrites the report with
`stage: "renderer"` and a `device-lost:` reason rather than dropping the original detail.

Unit coverage: [`tests/webgpu-probe.test.mjs`](../tests/webgpu-probe.test.mjs)
(`npm run test:webgpu-probe`) drives every stage against fakes and asserts one `requestAdapter` per
page.

## WebGL2 fallback

Covered in [`webgl-fallback.md`](./webgl-fallback.md): when it engages, how to force it
(`?renderer=webgl`, `?webglLite=1`, `localStorage candy.renderer`), what is reduced (low tier, no
GPU compute — `renderer.compute()` is a no-op), and how to smoke it (`RENDERER=webgl npm run test`).
