# WebGL — not available

Candy World **requires WebGPU**. There is no WebGL renderer at runtime, not even as a debug path.

- A failed WebGPU boot probe stops boot at a diagnostics screen (`src/ui/webgpu-fatal.ts`). It does
  **not** start a WebGL renderer, and Three's internal `WebGLBackend` fallback is disabled.
- `?renderer=webgl`, `?renderer=webgl2`, `?webgl`, `?webglLite=1`, `localStorage candy.renderer`
  and `window.setRenderer('webgl')` are **ignored** — they log a warning and boot stays on WebGPU.
  (`?lite` still trims world density; it never selected a renderer on its own.)
- `?wireframe=1` / `?matDebug=1` (and the matching debug-panel buttons, now disabled) only ever
  applied on the WebGL path, so they do nothing.
- `RENDERER=webgl npm run test` exits 1 by design: a green run on a backend the app will not ship is
  worse than no run.

`src/rendering/webgl-debug.ts` and the `mode === 'webgl'` branches downstream are **dormant**: kept
so a future restore flips `resolveRendererBackend()` and the probe's fatality in one place, but they
never execute while the active backend is WebGPU.

- Current contract: [`WEBGPU_CONTEXT.md`](./WEBGPU_CONTEXT.md#webgl-not-available)
- Old WebGL2 reference-path notes (porting tips, parity table): [`archive/webgl-fallback-restore-notes.md`](./archive/webgl-fallback-restore-notes.md)
