# WebGL2 fallback

Candy World prefers **WebGPU**. When WebGPU cannot be brought up, the world boots on **WebGL2**
instead of stopping — through Three's GLSL node backend, `WebGPURenderer({ forceWebGL: true })`, so
TSL materials and fog keep working. (Legacy `THREE.WebGLRenderer` is not used: TSL node materials
need the node renderer.)

## When it engages

`createRenderer()` in `src/core/init.ts` runs the boot probe (`probeWebGPU()`, see
[`WEBGPU_CONTEXT.md`](./WEBGPU_CONTEXT.md#boot-probe--webgl2-fallback)). Any probe failure falls back:

| Probe stage                         | Typical cause                                                            |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `navigator`                         | `navigator.gpu` missing (Firefox, Safari, old Chromium, WebGPU disabled) |
| `adapter`                           | `requestAdapter()` resolved null (GPU blocklisted, old driver)           |
| `device`                            | `requestDevice()` rejected                                               |
| `canvas` / `configure` / `pipeline` | swap chain or compute could not start on this device                     |

If the probe got as far as `getContext('webgpu')`, `#glCanvas` is replaced by a fresh clone first
(a canvas holds one context type for life).

It can also be forced (first match wins):

| Source       | Example                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| URL param    | `?renderer=webgl`, `?renderer=webgl2`, `?webgl`, `?webglLite=1`                          |
| URL param    | `?renderer=webgpu` — prefer WebGPU (still falls back)                                    |
| localStorage | `candy.renderer` = `webgl` \| `webgpu` (set by `window.setRenderer()` / the debug panel) |

`?lite` on its own does **not** select WebGL2: it only trims world density, and a WebGPU-capable
browser keeps its better renderer.

Boot stops at the diagnostics screen (`src/ui/webgpu-fatal.ts`) only when WebGL2 cannot start
either (stage `webgl`), or when the probe passed and the WebGPU renderer then failed (stage
`renderer`).

## It is never silent

A quiet GL render once hid the Chrome-vs-Edge adapter bug, so the fallback is always announced:

- **Renderer badge** (top-left): `WEBGL2 FALLBACK` (`role="status"`, with an aria-label saying
  WebGPU is unavailable). Forced WebGL2 reads `WEBGL2 DEBUG`; WebGPU reads `WEBGPU`.
- `window.rendererFallbackReason` — `webgpu-unavailable: <stage>: <reason>` or `explicit-webgl`.
- `window.webgpuProbe` — keeps the failing WebGPU stage, reason and browser brand.
- `window.__gpuContext.backend === 'webgl'`, `available: false`.
- `window.rendererType`, `usingWebGL`, `#glCanvas[data-renderer="webgl"]`.
- Console: `[Init] WebGPU unavailable (<stage>) — falling back to WebGL2`.

## What is reduced on WebGL2

| Area              | WebGL2 behaviour                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graphics tier     | Clamped to `low` by `resolveStartupCapabilities()` (`forceWebGL`)                                                                                                           |
| Shadows / post-FX | Off (low tier)                                                                                                                                                              |
| GPU compute       | Off: `__computeDisabled` is set and `renderer.compute()` / `computeAsync()` are no-ops. Three runs TSL compute through transform feedback, which cannot express our kernels |
| Compute consumers | `awaitGpuDevice()` resolves `null` immediately → CPU/WASM tiers (particles, culling, chores)                                                                                |
| Fog               | TSL `scene.fogNode` still compiles to GLSL                                                                                                                                  |
| Physics / spawn   | Unchanged — ground height is WASM/JS, independent of the renderer                                                                                                           |

Full and Lite (`?lite`) both enter the world on WebGL2; the Play / Explore / Core paths are the same.

## Debug helpers (WebGL2 only)

| Param / shortcut       | Effect                        |
| ---------------------- | ----------------------------- |
| `?wireframe=1` / **G** | Scene-wide wireframe overlay  |
| `?matDebug=1` / **M**  | `MeshNormalMaterial` override |

```js
window.candy_set_webgl_debug_mode('wireframe', true);
window.candy_get_webgl_debug_state();
```

## Testing

```bash
RENDERER=webgl npm run test                    # Play path on the real fallback (navigator.gpu hidden)
RENDERER=webgl BOOT_PATH=explore npm run test  # enter the Full world on WebGL2
npm run test                                   # WebGPU; fails if the world lands on WebGL2
```

Headless runs never start the animation loop (`isCIorHeadless()`), so they do not exercise
physics. To check spawn/ground on WebGL2 in a real loop, open `?renderer=webgl&debugPlayer=1` and
watch `window.__groundMetrics` (`playerAboveEye` ≈ 0 when standing).

Older porting notes (parity table, WebGL → WebGPU checklist) are in
[`archive/webgl-fallback-restore-notes.md`](./archive/webgl-fallback-restore-notes.md).
