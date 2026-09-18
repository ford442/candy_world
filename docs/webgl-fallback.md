# WebGL2 — Not Available

**Candy World does not boot on WebGL.** WebGPU is required to enter the world.

- There is **no** WebGL fallback and **no** debug-only WebGL renderer. A failed WebGPU boot probe
  stops at a diagnostics screen (`src/ui/webgpu-fatal.ts`); it never starts a GL renderer, because a
  silent GL render is exactly what hid the Chrome-vs-Edge adapter bug (#1625).
- `?renderer=webgl`, `?renderer=webgl2`, `?webgl`, `?webglLite=1`, and `localStorage candy.renderer`
  are **ignored** (with a console warning). `window.setRenderer('webgl')` refuses.
- `RENDERER=webgl npm run test` **exits 1** by design. Run `npm run test` (WebGPU) instead.
- `?wireframe`, `?matDebug`, and `candy_set_webgl_debug_mode()` are inert: `initWebGLDebug()` returns
  early unless the active backend is WebGL, which it never is.

What remains in the tree, and why:

| File                                   | Status                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| `src/rendering/renderer-mode.ts`       | Live — always resolves `webgpu`; publishes `window.rendererType` etc. |
| `src/rendering/webgl-debug.ts`         | Imported but inert (every entry point gates on `mode === 'webgl'`)    |
| `mode === 'webgl'` branches downstream | Unreachable; `SceneInitResult.mode` is always `'webgpu'`              |
| `renderer._getFallback = null` in init | Live — stops Three swapping in `WebGLBackend` behind our back         |

For the full contract see [`WEBGPU_CONTEXT.md` → WebGL: not available](./WEBGPU_CONTEXT.md#webgl-not-available).
The previous opt-in WebGL2 design (toggles, parity table, porting checklist) is preserved for a
future restore in [`docs/archive/webgl-fallback.md`](./archive/webgl-fallback.md). Do not follow it
for current work. Post-FX and shadow notes that used to live there are current in
[`POSTFX_STACK.md`](./POSTFX_STACK.md) and [`SHADOW_SOFTNESS.md`](./SHADOW_SOFTNESS.md).
