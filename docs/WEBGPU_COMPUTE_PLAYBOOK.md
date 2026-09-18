# WebGPU Compute Playbook — How to Add a Pass

> **Scope:** the recipe for adding _one new compute-based feature_ to Candy World.
> This is not a WGSL tutorial and not a rewrite plan for existing shaders.
>
> Read first, do not duplicate:
>
> - [`docs/WEBGPU_CONTEXT.md`](./WEBGPU_CONTEXT.md) — single-device architecture, limits matrix, device-lost policy
> - [`docs/COMPUTE_GPU_DEFAULT.md`](./COMPUTE_GPU_DEFAULT.md) — which subsystems are GPU-default, Tier 4a vs 4b
> - [`docs/COMPUTE_PARTICLES.md`](./COMPUTE_PARTICLES.md), [`docs/GPU_FOLIAGE.md`](./GPU_FOLIAGE.md) — worked, shipped examples
> - [`docs/webgl-fallback.md`](./webgl-fallback.md) — the WebGL2 reference path and `?webglLite=1`
> - [`docs/TIER_PARITY.md`](./TIER_PARITY.md) — golden-vector harness for fallback parity
>
> Owner modules: [`src/rendering/gpu-context.ts`](../src/rendering/gpu-context.ts),
> [`src/compute/compute-orchestrator.ts`](../src/compute/compute-orchestrator.ts),
> [`src/compute/gpu-compute-library.ts`](../src/compute/gpu-compute-library.ts).

Every compute feature in this repo — particles, foliage pose, LOD/culling, clustered lights, wind —
follows the same seven steps. Follow them in order and your pass will behave on WebGPU, on WebGL,
in CI, and after a device loss without any new code in the boot path.

---

## 0. Pick your tier first

| You are writing…                                                      | Use                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A reusable primitive (prefix sum, reduce, compact)                    | **Tier 4a** — `GPUChoresLibrary` already ships these (`src/compute/chores/gpu-chores.ts`)  |
| Domain simulation (your feature's kinematics, pose, binning)          | **Tier 4b** — a module scoped to your system, e.g. `src/compute/<feature>-gpu.ts`          |
| A pass that reads/writes Three.js node material data and nothing else | **TSL compute node** — `renderer.compute(node)` from `game-loop-compute.ts`; no raw device |

Before writing a Tier 4a kernel, check whether `GPUChoresLibrary` already has it —
`prefix_sum`, `compact` and `reduce_f32` are in the kit, and their contract (live count via
uniform, inclusive scan, 256-wide workgroups) is documented in
[`COMPUTE_GPU_DEFAULT.md`](./COMPUTE_GPU_DEFAULT.md#gpu-chores-tier-4a-vs-4b).

Prefer a TSL compute node when the data already lives in a `StorageBufferAttribute`. Drop to raw
WebGPU only when you need explicit buffer layout, readback, or a bind group Three does not model.
`compute-particles.ts` pays real complexity for that choice (see the `attributeUtils` bridge near the
end of its `update()`) — don't take it on without a reason.

---

## 1. `awaitGpuDevice()` / fail closed

**There is exactly one `GPUDevice` per page load and the renderer owns it.** Never call
`navigator.gpu.requestAdapter()` or `requestDevice()`. Borrow:

```ts
import { awaitGpuDevice, getGpuContextSync } from '../rendering/gpu-context.ts';

const device = await awaitGpuDevice();
if (!device) {
    // null — never a throw, never a hang — on WebGL, failed init, post-device-loss,
    // or no armed context (a 10 s guard covers tools and tests).
    const reason = getGpuContextSync().reason ?? 'device unavailable';
    console.warn(`[MyPass] CPU tier (${reason})`);
    return this.initCPUFallback();
}
```

Gate on policy before you allocate anything:

```ts
import { preferGpuCompute, isGpuComputeReady, ensureGpuComputeReady } from '../compute/index.ts';

await ensureGpuComputeReady(); // idempotent; resolves false when unavailable
if (!preferGpuCompute() || !isGpuComputeReady()) return false; // caller runs the CPU path
```

`preferGpuCompute()` already folds in `CONFIG.compute.preferGpu`, `?no_gpu_compute`,
`window.__computeDisabled`, and CI/headless. Do not re-derive those conditions yourself.

## 2. Buffers — alignment, storage vs uniform, bounded sizes

- **Uniform** for small, per-frame, read-only scalars (< 64 KiB): time, delta, counts, mode flags,
  a handful of vectors. **Storage** for anything per-instance.
- **Round uniform sizes up to 16 bytes** and pad `vec3` to 16 bytes in the struct. WGSL's std140-ish
  rules bite silently otherwise — a `vec3<f32>` followed by an `f32` is _not_ 16 bytes of packing you
  can assume. `compute-particles.ts` does `Math.ceil((floatCount * 4) / 16) * 16` and sizes vec3
  arrays at 16 B/element, not 12.
- **Never allocate an unbounded buffer.** Size from an explicit, clamped count, and clamp against the
  granted limit — not the requested one:

```ts
import { clampStorageBufferSize, clampWorkgroupSizeX } from '../rendering/webgpu-limits.ts';
import { getGpuLimit } from '../rendering/gpu-context.ts';

const bytes = clampStorageBufferSize(count * BYTES_PER_INSTANCE);
```

- **Minimum 4 bytes.** An empty registry (CORE world, `?webglLite=1`) still needs a bound buffer or
  WebGPU raises a binding-size validation error. `createStorageBuffer()` in `gpu-compute-library.ts`
  enforces this for you — one more reason to use it rather than raw `device.createBuffer`.
- **Report your allocations** so the VRAM audit stays honest:

```ts
import { trackGpuBufferBytes } from '../compute/compute-orchestrator.ts';
trackGpuBufferBytes(posBytes + stateBytes + uniformBytes); // and a negative delta in dispose()
```

- **Label everything.** `label: 'candy-glow-state'` is what you will see in a validation error at 2am.
- **Reuse the scratch typed array.** Allocating a `Float32Array` per dispatch shows up as GC churn in
  the render loop — own the array, refill it in place (see `compute-particles.ts`'s `uniformArray`).

## 3. Encoder scheduling — when to dispatch

Two legitimate places, and they are not interchangeable:

| Pass kind                             | Where it runs                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| TSL compute node                      | `updateComputePhase()` in [`src/core/game-loop-compute.ts`](../src/core/game-loop-compute.ts), via `rendererRef.compute(node)` |
| Raw WebGPU dispatch owned by a system | inside that system's own `update()`, called from its game-loop phase module                                                    |

Rules:

- **One encoder, one submit, per pass, per frame.** `dispatchCompute()` in `gpu-compute-library.ts`
  is the canonical shape; don't hand-roll it unless you need multiple passes in one encoder (then
  reuse the _encoder_, still one `queue.submit`).
- **Dispatch before the render phase reads the results**, or accept **one frame of latency** and say
  so. Foliage scalar batches and plant pose deliberately pipeline by a frame (`submit` / `take`) —
  that is cheaper than a stall and visually invisible at 60 FPS. Pick one and document it.
- **Never `await` a buffer readback in the frame that dispatched it.** Readback is a stall.
  Use the pipelined take-last-frame pattern, or `readBuffer()` off the hot path during init.
- **Skip empty work:** `gpu.shouldSkipDispatch(activeCount, 'MyPass')` — CORE mode registries are
  legitimately zero-length and a zero dispatch is wasted encoder time.
- **Never dispatch in CI/headless.** `updateComputePhase()` guards every `renderer.compute()` with
  `!isCIorHeadless()`; a raw pass gets the same guard for free via `preferGpuCompute()`.
- **Wrap the whole phase in try/catch and disable on throw.** One bad pass must not kill the loop —
  mirror `updateComputePhase()`: log, set `window.__computeDisabled = true`, keep rendering.

## 4. Device-lost and the WebGL skip

Device loss is owned by `gpu-context.ts`. You do **not** register a `device.lost` handler; you
subscribe and tear down:

```ts
import { onGpuDeviceLost } from '../rendering/gpu-context.ts';

this.unsubscribeDeviceLost = onGpuDeviceLost(() => {
    this.usingGPU = false;
    this.pipeline = this.bindGroup = this.buffers = null; // they belonged to the dead device
    trackGpuBufferBytes(-this.trackedBytes);
    // Don't leave stale GPU-driven visuals on screen: hide, or hand back to the CPU tier.
});
```

- **Never call `device.destroy()`.** The renderer owns the device's lifetime; your `dispose()`
  releases _your_ buffers and unsubscribes, nothing more.
- **A listener that throws is caught and logged** — but it still means your teardown was incomplete.
- On `?renderer=webgl` the context resolves as unavailable immediately, so step 1 already routed you
  to the CPU tier. There is nothing extra to write for WebGL — **if you find yourself branching on
  the backend name, you skipped step 1.**

## 5. Quality tier and `webglLite`

- `?no_gpu_compute` / `window.__computeDisabled` — kills every GPU compute path, yours included.
  Free if you gated on `preferGpuCompute()`.
- `?webglLite=1` (or `?lite`) — disables GPU compute _and_ forces CORE world generation. Your pass
  must survive **empty registries**: zero instances, 4-byte buffers, skipped dispatch, no NaNs.
- New features land **behind a flag, default OFF**, until parity is green — follow `?gpuFoliage=1`.
  Expose the flag state for devtools: `window.__myPassFlag()` → `{ urlEnabled, active }`.
- Scale your instance count with the effective quality tier rather than shipping one fixed number,
  and use `getCIAdjustedCount()` for anything that runs under Playwright.

## 6. Parity and fallback (TS or AS)

Every GPU pass needs a fallback that produces the _same_ numbers, because it will run on WebGL, in
CI, and after a device loss.

- Choose the canonical tier and mirror it — WGSL mirrors AssemblyScript (`assembly/foliage.ts`) or a
  TS reference, never the reverse.
- Add golden vectors to the parity harness before flipping a flag to default-on:

```bash
npm run test:parity        # add your path alongside Path 4 (foliage scalar) / Path 5 (plant pose)
npm run test:tier-parity   # AS ↔ C++ ↔ JS references
```

- Tolerance is `|Δ| ≤ 1e-5` for f32 scalars. If you cannot hit it, your WGSL and your reference are
  not doing the same math — fix the math, don't widen the epsilon.
- `withFallback(gpuFn, cpuFn, label)` in `gpu-compute-library.ts` gives you the runtime half of this
  for free.

## 7. Candy compute — keep it soft

Compute is a means to the look, not an excuse to abandon it. Candy World is pastel, glossy, and
dream-like; every example and every default in a new pass should read that way.

- **Yes:** drifting pollen and fireflies, soft bloom accumulation, gentle sway and bounce, dreamy
  volumetric glow, sparkle bursts, colour-bleeding indirect bounce.
- **No:** grimy screen-space AO dumps, harsh contact-hardening, gritty noise overlays, film grain,
  crunchy sharpening, blood/dirt/decal systems. If a debug view looks like a AAA shooter's G-buffer,
  it does not ship as an example in these docs.
- Prefer **additive/soft-light accumulation** over subtractive darkening; darken by _desaturating
  toward the fog colour_, not by multiplying toward black.
- Keep example screenshots and doc snippets in-palette (`CONFIG` colours,
  [`docs/CANDY_MATERIAL_COOKBOOK.md`](./CANDY_MATERIAL_COOKBOOK.md)).

---

## Hello, dispatch

A minimal Tier 4b pass, matching the shape of `foliage-gpu-batch.ts` and `batcher-gpu-lod.ts`.

```ts
// src/compute/candy-glow-gpu.ts
import { awaitGpuDevice, getGpuContextSync, onGpuDeviceLost } from '../rendering/gpu-context.ts';
import { clampStorageBufferSize } from '../rendering/webgpu-limits.ts';
import { getSharedGPUCompute } from './gpu-compute-library.ts';
import {
    preferGpuCompute,
    isGpuComputeReady,
    ensureGpuComputeReady,
    trackGpuBufferBytes,
} from './compute-orchestrator.ts';

const WORKGROUP_SIZE = 64; // matches GPU_REQUIRED_LIMITS.maxComputeWorkgroupSizeX headroom (256)

const CANDY_GLOW_WGSL = /* wgsl */ `
struct Uniforms {
    time: f32,
    delta: f32,
    kick: f32,
    count: u32,
};                                   // 16 B — already a multiple of 16, no padding needed

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read>       intensities: array<f32>;
@group(0) @binding(2) var<storage, read_write> outGlow:     array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u.count) { return; }    // always bounds-check: dispatch is rounded up
    // Soft, dreamy pulse — mirrors the TS reference in candy-glow-reference.ts
    let pulse = 0.5 + 0.5 * sin(u.time * 1.7 + f32(i) * 0.37);
    outGlow[i] = intensities[i] * mix(0.85, 1.15, pulse) + u.kick * 0.2;
}
`;

export class CandyGlowGPU {
    private gpu = getSharedGPUCompute();
    private pipeline: GPUComputePipeline | null = null;
    private bindGroup: GPUBindGroup | null = null;
    private uniformBuf: GPUBuffer | null = null;
    private inBuf: GPUBuffer | null = null;
    private outBuf: GPUBuffer | null = null;
    private uniformArray = new Float32Array(4); // owned; refilled in place, never reallocated
    private trackedBytes = 0;
    private unsubscribe: (() => void) | null = null;
    private count = 0;
    active = false;

    /** Returns false when the caller should keep running its CPU/WASM tier. */
    async init(intensities: Float32Array): Promise<boolean> {
        await ensureGpuComputeReady();
        if (!preferGpuCompute() || !isGpuComputeReady()) return false;

        const device = await awaitGpuDevice();
        if (!device) {
            console.warn(`[CandyGlow] CPU tier (${getGpuContextSync().reason ?? 'no device'})`);
            return false;
        }

        this.count = intensities.length;
        if (this.count === 0) return false;

        this.pipeline = await this.gpu.createComputePipeline({
            shader: CANDY_GLOW_WGSL,
            label: 'candy-glow',
            bindingLayout: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });

        const outBytes = clampStorageBufferSize(this.count * 4);
        this.uniformBuf = this.gpu.createUniformBuffer(this.uniformArray, 'candy-glow-uniforms');
        this.inBuf = this.gpu.createStorageBuffer(intensities, 'candy-glow-in', true);
        this.outBuf = this.gpu.createStorageBuffer(
            new Float32Array(outBytes / 4),
            'candy-glow-out'
        );
        this.bindGroup = this.gpu.createBindGroup(
            this.pipeline,
            [this.uniformBuf, this.inBuf, this.outBuf],
            'candy-glow-bg'
        );

        this.trackedBytes = 16 + intensities.byteLength + outBytes;
        trackGpuBufferBytes(this.trackedBytes);

        this.unsubscribe = onGpuDeviceLost(() => this.teardown());
        this.active = true;
        return true;
    }

    /** Called from the owning system's game-loop phase. Results are read next frame. */
    dispatch(time: number, delta: number, kick: number): void {
        if (!this.active || !this.pipeline || !this.bindGroup) return;
        if (this.gpu.shouldSkipDispatch(this.count, 'CandyGlow')) return;

        const u = this.uniformArray;
        u[0] = time;
        u[1] = delta;
        u[2] = kick;
        u[3] = this.count;
        this.gpu.writeUniformBuffer(this.uniformBuf!, u);

        this.gpu.dispatchCompute(
            this.pipeline,
            this.bindGroup,
            Math.ceil(this.count / WORKGROUP_SIZE)
        );
    }

    private teardown(): void {
        this.active = false;
        this.pipeline = this.bindGroup = null;
        this.uniformBuf = this.inBuf = this.outBuf = null;
        trackGpuBufferBytes(-this.trackedBytes);
        this.trackedBytes = 0;
        // No device.destroy() — the renderer owns the device.
    }

    dispose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.teardown();
    }
}
```

Call site, in the owning system's phase module:

```ts
if (glow.active) {
    glow.dispatch(t, dt, kick); // results consumed next frame (1-frame pipelined)
} else {
    cpuGlowFallback(t, dt, kick); // WASM / TS tier — identical math, see §6
}
```

---

## Anti-patterns

| ❌ Don't                                                        | ✅ Do                                                                       | Why                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `navigator.gpu.requestDevice()` in a new system                 | `await awaitGpuDevice()`                                                    | N devices = N VRAM heaps, N pipeline caches, disagreeing limits, and only one of them recovers from loss |
| `await navigator.gpu.requestAdapter()` during boot              | Nothing — `captureAdapterRequests()` already wrapped Three's single request | A blocking adapter request in the boot path stalls first paint and can double-request on some drivers    |
| `device.createBuffer({ size: someArray.length * 4 })` unbounded | `clampStorageBufferSize(count * STRIDE)` from a clamped count               | Exceeding `maxStorageBufferBindingSize` is a hard validation failure, worst on iGPUs and SwiftShader     |
| Assuming your requested limits were granted                     | `getGpuLimit(name)` / `clampWorkgroupSizeX()`                               | `GPU_REQUIRED_LIMITS` is a floor of spec defaults, not what the adapter handed you                       |
| A second bind group _layout_ for the same buffer shape          | Let `gpu-compute-library.ts` cache the layout by shape                      | Duplicate layouts defeat the pipeline cache and diverge on the next edit                                 |
| `device.destroy()` in `dispose()`                               | Release your buffers, unsubscribe, return                                   | You would tear down the renderer's device and black the canvas                                           |
| Registering your own `device.lost` handler                      | `onGpuDeviceLost(fn)`                                                       | `gpu-context.ts` owns the one handler and guarantees it runs at most once                                |
| `await readBuffer()` inside the frame that dispatched           | 1-frame pipelining, or read during init                                     | A synchronous readback stalls the queue and costs more than the pass saved                               |
| Branching on `backend === 'webgl'`                              | Fail closed on a `null` device                                              | One code path; the backend check drifts from the real availability answer                                |
| New `Float32Array` per dispatch                                 | An owned scratch array refilled in place                                    | GC churn in the render loop — the exact thing the compute path exists to avoid                           |
| Shipping GPU-only, "the CPU path is too slow anyway"            | A parity-tested fallback                                                    | WebGL, CI, `?webglLite=1`, and every device loss run the fallback                                        |
| `vec3` arrays sized at 12 B/element                             | 16 B/element, uniforms rounded to 16                                        | WGSL alignment; the symptom is garbage in every element after the first                                  |
| A gritty SSAO / grain / dirt example                            | Soft, pastel, additive                                                      | See §7 — the aesthetic is a constraint, not a preference                                                 |

---

## Consumers — read these before writing a new pass

| Feature                | Doc                                                  | Module                                                                                                                 |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Particles              | [`COMPUTE_PARTICLES.md`](./COMPUTE_PARTICLES.md)     | [`src/particles/compute-particles.ts`](../src/particles/compute-particles.ts) — raw device, bind group, dispatch       |
| Foliage pose / scalars | [`GPU_FOLIAGE.md`](./GPU_FOLIAGE.md)                 | `src/compute/foliage-gpu-batch.ts`, `src/compute/gpu-plant-pose.ts` — flagged pilot, 1-frame pipelining                |
| LOD / culling          | [`COMPUTE_GPU_DEFAULT.md`](./COMPUTE_GPU_DEFAULT.md) | `src/compute/batcher-gpu-lod.ts`, `src/compute/gpu-culling-system.ts` — Tier 4a chores usage                           |
| Clustered lights       | [`CLUSTERED_LIGHTS.md`](./CLUSTERED_LIGHTS.md)       | [`src/rendering/clustered-lighting.ts`](../src/rendering/clustered-lighting.ts) — CPU bin, GPU upload, no extra device |
| Irradiance probes / GI | [`IRRADIANCE_PROBES.md`](./IRRADIANCE_PROBES.md)     | [`src/rendering/irradiance-probes.ts`](../src/rendering/irradiance-probes.ts)                                          |
| Wind                   | [`WIND_OPTIMIZATION.md`](./WIND_OPTIMIZATION.md)     | `src/foliage/wind-compute.ts` — TSL compute node dispatched from `game-loop-compute.ts`                                |

---

## PR checklist

Copy-paste into the PR description and tick it:

```markdown
### WebGPU compute pass checklist

- [ ] Zero new `requestDevice` / `requestAdapter` call sites (`grep -rn "requestDevice\|requestAdapter" src/`)
- [ ] Device acquired via `awaitGpuDevice()`; `null` fails closed to the CPU/WASM tier (no throw)
- [ ] Gated on `preferGpuCompute()` + `isGpuComputeReady()`; `ensureGpuComputeReady()` awaited once
- [ ] Buffer sizes bounded and clamped (`clampStorageBufferSize`); uniforms 16-byte aligned; `vec3` at 16 B
- [ ] Every buffer and pipeline has a `label`
- [ ] `trackGpuBufferBytes(+/-)` on allocate and on teardown; `window.__computeVramBytes()` returns to baseline after dispose
- [ ] Bind group layout reused via `gpu-compute-library.ts` (no duplicate layout for an existing shape)
- [ ] Dispatch site named and latency documented (same-frame vs 1-frame pipelined)
- [ ] No buffer readback awaited inside a dispatching frame
- [ ] `shouldSkipDispatch()` (or equivalent) guards zero-count registries
- [ ] `onGpuDeviceLost` teardown drops pipeline/bind group/buffers; **no `device.destroy()`**
- [ ] No stale GPU-driven visuals after device loss (hidden or handed to the CPU tier)
- [ ] Verified on `?renderer=webgl`, `?webglLite=1`, and `?no_gpu_compute`
- [ ] CPU/WASM fallback exists and is parity-tested (`npm run test:parity`, `|Δ| ≤ 1e-5`)
- [ ] New path behind a URL flag, default OFF, until parity is green
- [ ] Instance counts scale with quality tier; `getCIAdjustedCount()` used for CI
- [ ] Phase wrapped in try/catch that disables compute rather than killing the frame
- [ ] Visuals stay soft/pastel (§7) — no grimy SSAO/grain examples
- [ ] `npm run test:wasm` + `npm run test` green; no new console errors in the smoke boot
```
