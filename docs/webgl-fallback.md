# WebGL2 Fallback Renderer

Candy World ships with **WebGPU** as the default renderer and an opt-in **WebGL2** reference path via Three.js `WebGLRenderer`. Both backends share the same scene graph, camera, controls, terrain, materials, animations, and music-reactivity hooks.

This mirrors the ford442 portfolio pattern used in Tetris_WebGPU, power_gen, mod-player, pachinball, Watershed, and HarborGlow.

## Why WebGL2?

- **Visual debugging** — agents and Playwright can screenshot `canvas.toDataURL()` reliably
- **Reference rendering** — compare candy materials, fog, and terrain while porting TSL features to WebGPU
- **CI / headless** — SwiftShader and software WebGPU stacks often fail; WebGL2 is the supported test path

## Selecting a Renderer

Priority (first match wins):

| Source | Example | Result |
|--------|---------|--------|
| URL param | `?renderer=webgl` | Force WebGL2 |
| URL param | `?renderer=webgpu` | Prefer WebGPU (fallback if unavailable) |
| localStorage | `candy.renderer` = `webgl` \| `webgpu` | Persisted preference |
| Default | *(none)* | WebGPU when available |

### Quick start

```bash
npm run dev
# open http://localhost:5173/?renderer=webgl
```

### Hot-switch (full reload)

```js
window.setRenderer('webgl');  // or 'webgpu'
```

The debug panel (`?debug=1`, press **D**) also exposes **WebGPU / WebGL2** buttons.

## WebGL Debug Helpers

Available when `?renderer=webgl`:

| Param / shortcut | Effect |
|------------------|--------|
| `?wireframe=1` / **G** | Scene-wide wireframe overlay |
| `?matDebug=1` / **M** | `MeshNormalMaterial` override |
| `?webglLite=1` | Disable GPU compute + recommend CORE world |

Programmatic API:

```js
window.candy_set_webgl_debug_mode('wireframe', true);
window.candy_set_webgl_debug_mode('material', true);
window.candy_get_webgl_debug_state();
```

## Playwright / CI

Recommended boot URL for smoke tests and screenshots:

```
http://localhost:4173/?renderer=webgl&webglLite=1
```

Environment variable shortcut:

```bash
RENDERER=webgl npm run test
```

Window breadcrumbs exposed for assertions:

```js
window.rendererType        // 'webgl' | 'webgpu'
window.usingWebGL          // boolean
window.usingWebGPU         // boolean
window.rendererFallbackReason  // null | 'explicit-webgl' | 'webgpu-unavailable'
document.querySelector('#glCanvas').dataset.renderer
```

Screenshot capture:

```js
import { captureCanvasScreenshot } from './src/rendering/renderer-mode.ts';
const png = await captureCanvasScreenshot(document.querySelector('#glCanvas'));
```

## Visual Parity Notes

| Feature | WebGPU | WebGL2 |
|---------|--------|--------|
| MeshPhysicalMaterial (candy gloss) | ✓ TSL + node path | ✓ Standard GLSL |
| TSL fog node (`scene.fogNode`) | ✓ | Uses `THREE.Fog` fallback |
| TSL post-processing (bloom, vignette) | ✓ `PostProcessing` + TSL | ✓ `EffectComposer` + `UnrealBloomPass` |
| GPU compute particles | ✓ | Disabled in `webglLite` / `safeMode` |
| Music-reactivity uniforms | ✓ TSL batchers | ✓ Same batchers where WebGL-compatible |
| Shader warmup | Full batched warmup | Skipped (WebGL is more forgiving) |
| God rays (sunrise/sunset/moon shafts) | ✓ additive shaft planes + `uShaftOpacity` | ✓ same planes, per-frame `material.opacity` sync |
| Depth of Field (bokeh) | ✓ TSL `dof()` mixed by `uDofMix` | ✓ `BokehPass`, toggled via `pass.enabled` |

## Atmospheric Post-FX (god rays + DoF)

Both effects are controlled by `CONFIG.postfx` (see `src/core/config.ts`) and resolved
through `resolvePostfxQuality()` / `areGodRaysEnabled()` / `isDofEnabled()`:

- **Quality tier** — `CONFIG.postfx.quality` (`off` | `low` | `high`), overridable with
  `?postfx=off|low|high`. Default is `low`: god rays on, DoF off (60fps budget).
- **God rays** — live in `game-loop.ts` (`applyMusicReactiveLightShafts`): golden-hour
  shafts + cool moonbeams whose opacity is driven by the melody/beat channels, frustum-gated
  and opacity-capped. `?postfx=off` (or `CONFIG.postfx.godRays = false`) hides them at zero cost.
- **Depth of Field** — `?dof` / `?no_dof`, or implied by the `high` tier. DoF is only *built
  into* the render graph when enabled at boot, so the default tier carries no DoF cost. Within a
  DoF-enabled session, `uDofMix` fades the effect in near luminous/mycelium flora (or always, in
  manual `dofEnabled` mode) and snaps back to a sharp world instantly. `uDofFocus` follows the
  player's look distance. WebGL uses `BokehPass` as a degraded-but-functional equivalent.

## WebGL → WebGPU Porting Checklist

When iterating a visual feature in WebGL first:

1. **Materials** — confirm `MeshPhysicalMaterial` clearcoat/roughness in WebGL; port TSL node graphs in batchers for WebGPU
2. **Fog** — WebGL uses `scene.fog`; WebGPU adds `scene.fogNode` via `createCrescendoFogNode()`
3. **Post-processing** — mirror bloom threshold (0.85), radius (0.5), and saturation in both pipelines (`src/foliage/post-processing.ts`)
4. **Uniforms** — mutate `.value` in place; never reassign TSL uniform nodes
5. **Compute** — gate with `window.__computeDisabled`; provide JS fallback
6. **Test both paths** — `?renderer=webgl` and default WebGPU before merging

## Related Files

- `src/rendering/renderer-mode.ts` — preference resolution, breadcrumbs, hot-switch
- `src/rendering/webgl-debug.ts` — wireframe, material debug, lite boot flags
- `src/core/init.ts` — renderer creation and mode-specific setup
- `src/foliage/post-processing.ts` — dual post-processing pipelines
- `src/debug/panel.ts` — debug UI renderer toggle
