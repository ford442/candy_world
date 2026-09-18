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

| Option             | Value                                     | Rationale                                                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `powerPreference`  | `'high-performance'`                      | The compute devices already asked for it; the main renderer did not. On a hybrid laptop that could put the renderer on the iGPU and compute on the dGPU — two heaps and cross-adapter copies. One device, one preference.                                        |
| `antialias`        | `true`                                    | Unchanged from before. The post chain has no full-screen AA resolve of its own, so swap-chain MSAA is still the only geometric AA. Swapping to post-AA is a visual change and out of scope.                                                                      |
| `alpha`            | `true` → `alphaMode: 'premultiplied'`     | Three's default, pinned explicitly. HUD, loading screen, badges, and the accessibility menu are DOM layers composited over the canvas and depend on premultiplied blending.                                                                                      |
| `requiredLimits`   | see below                                 | Adapter-aware: `min(adapter, desired)`, spec defaults on software adapters.                                                                                                                                                                                      |
| `outputColorSpace` | `'display-p3'` / `'srgb'` string literals | Chosen in `init.ts` (P3 only when `(dynamic-range: high)` matches). The canvas `colorSpace` is set to match — see [Swap chain vs HDR render targets](#swap-chain-vs-hdr-render-targets). The Three enum regression is tracked separately — do not "fix" it here. |

### Limits matrix

A `requiredLimits` entry is a **guarantee**; anything the UA grants above it is luck. So the probe
does not just hope for more — `resolveRequiredLimits(adapter, adapterInfo)` asks for

```
requested[k] = min(adapter.limits[k], ceiling[k])
ceiling      = GPU_DESIRED_LIMITS      on hardware adapters
             = spec default            on software adapters (isFallbackAdapter, SwiftShader, llvmpipe, lavapipe, WARP)
```

Clamping to what the adapter advertises means `requestDevice` still cannot be rejected for asking too
much, and the software cap means CI requests exactly what it requested before this change.
`maxStorageBufferBindingSize` is additionally clamped to the requested `maxBufferSize`.

| Limit                               | Floor (`GPU_REQUIRED_LIMITS`, spec default) | Hardware ceiling (`GPU_DESIRED_LIMITS`) | Requested on SwiftShader CI | Why                                                                                                                            |
| ----------------------------------- | ------------------------------------------- | --------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `maxBufferSize`                     | 268 435 456 (256 MiB)                       | 1 073 741 824 (1 GiB)                   | 268 435 456                 | A storage binding can never be larger than the buffer behind it                                                                |
| `maxStorageBufferBindingSize`       | 134 217 728 (128 MiB)                       | 1 073 741 824 (1 GiB)                   | 134 217 728                 | The floor is what `gpu-compute-library.ts` / `compute-particles.ts` used to request, so no binding that used to fit can shrink |
| `maxComputeWorkgroupSizeX`          | 256                                         | 256                                     | 256                         | Workgroup size declared by the particle and culling WGSL kernels; a larger grant buys nothing                                  |
| `maxComputeInvocationsPerWorkgroup` | 256                                         | 256                                     | 256                         | Same kernels, single-dimension dispatch                                                                                        |
| `maxComputeWorkgroupStorageSize`    | 16 384 (16 KiB)                             | 16 384                                  | 16 384                      | Headroom for tiled kernels                                                                                                     |

The UA may still grant more than requested. Both are published — `window.webgpuProbe.requestedLimits`
vs `window.webgpuProbe.grantedLimits` (same keys), and `window.__gpuContext.requestedLimits` next to
the full `limits` snapshot. The boot log prints `granted (requested)` per key.

Adapters usually grant more. Read what was actually granted rather than assuming the request:

```ts
import { getGpuLimit } from '../rendering/gpu-context.ts';
import { clampStorageBufferSize, clampWorkgroupSizeX } from '../rendering/webgpu-limits.ts';

const cap = clampStorageBufferSize(desiredBytes);
```

`webgpu-limits.ts` sources its `getWebGPULimits()` from the shared context and only caches once a
real device has been seen, so an early caller cannot pin the defaults for the whole session.

## Swap chain vs HDR render targets

Two formats are in play, and they are not the same thing:

| Surface                                 | Format                                                                                                 | Color space                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Canvas swap chain (`context.configure`) | `navigator.gpu.getPreferredCanvasFormat()` — usually `bgra8unorm` (Three forces `bgra8unorm` on Quest) | `colorSpace` = renderer `outputColorSpace` (`srgb` / `display-p3`) |
| Scene + post chain render targets       | `rgba16float` (HalfFloat)                                                                              | Linear working space                                               |

Lighting, fog, bloom, and the rest of the post chain run on `rgba16float` targets, so values above
1.0 survive until the final output pass. That pass tone-maps (ACES on SDR, linear on HDR displays)
and encodes to `outputColorSpace`, writing into the 8-bit swap chain. The swap chain's `colorSpace`
tells the compositor how to interpret those bytes; if it disagreed with `outputColorSpace`, P3 output
would be shown as sRGB (desaturated) or vice versa.

Order matters:

1. `probeWebGPU()` configures the canvas with an explicit `colorSpace: 'srgb'`.
2. `renderer.init()` (inside `armGpuContext`) — Three 0.171's `WebGPUBackend.init()` calls
   `context.configure()` **again, without `colorSpace`**, resetting it to the `srgb` default.
3. `init.ts` picks `outputColorSpace`, then calls `configureCanvasColorSpace(probe, outputColorSpace)`,
   which re-applies format / usage / alphaMode with the matching `colorSpace`. If the canvas rejects
   `display-p3`, init falls back to `srgb` for both.

The applied config is published as `canvas: { format, colorSpace, alphaMode }` on both
`window.__gpuContext` and `window.webgpuProbe`.

The swap chain is **not** configured with `toneMapping: { mode: 'extended' }`, so it is clamped to
SDR range even on HDR displays; the `rgba16float` internals are for precision through the post chain,
not for HDR presentation. Extended-range output is out of scope here.

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
`powerPreference`, `requiredLimits` (floors), `requestedLimits`, `canvas`, `adapter`, `adapterName`,
`limits` (granted), `alpha`, and `antialias`.
It is published from module load, so it is always readable — before arming it reports
`available: false`. The smoke test asserts its shape on the WebGPU path.

## Boot probe & hard-fail

`probeWebGPU(canvas)` in `gpu-context.ts` is the single gate, and the only caller of
`requestAdapter` / `requestDevice` in the app. It walks the whole path the world needs, in order,
and names the step that broke:

| Stage       | What it proves                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `navigator` | `navigator.gpu` exists at all                                                                  |
| `adapter`   | `requestAdapter()` yields an adapter — **this is where Chrome and Edge diverge**               |
| `device`    | `requestDevice()` grants the device, with every adapter feature and the adapter-clamped limits |
| `configure` | the real world canvas configures as a swap chain                                               |
| `pipeline`  | an empty `@compute` kernel compiles — culling, particles and gpu-chores all need this          |

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
  "limits": null,               // full granted snapshot, once a device exists
  "requiredLimits": { ... },    // spec-default floors
  "requestedLimits": null,      // what requestDevice was asked for (null: adapter never answered)
  "grantedLimits": null,        // device.limits for exactly the requested keys
  "canvas": null                // { format, colorSpace, alphaMode } once configured
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

WebGPU is the only backend. There is no WebGL fallback and no debug-only WebGL renderer; this is the
single story README, `AGENTS.md`, `src/core/init.ts`, and [`webgl-fallback.md`](./webgl-fallback.md)
all tell.

| Input                                   | Status                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `?renderer=webgl` / `webgl2` / `?webgl` | Warn, then ignored — `resolveRendererBackend()` always returns `webgpu` |
| `?webglLite=1`                          | No WebGL boot. `?lite` only trims world density                         |
| `?wireframe` / `?matDebug`              | Inert — `initWebGLDebug()` returns early off WebGL                      |
| `localStorage candy.renderer`           | Ignored; `switchRendererPreference('webgl')` refuses out loud           |
| `RENDERER=webgl npm run test`           | The smoke runner exits 1 rather than booting GL to make CI green        |

None of these can rescue boot. A green run on a backend the app will not ship is worse than no run
at all, so CI is expected-fail here rather than silently passing on GL.

`src/rendering/webgl-debug.ts` and the `mode === 'webgl'` branches downstream are unreachable but
still imported; removing them is a cleanup, not a behaviour change. The old opt-in WebGL2 design is
archived at [`docs/archive/webgl-fallback.md`](./archive/webgl-fallback.md) for a possible future
restore — it does not describe current behaviour.
