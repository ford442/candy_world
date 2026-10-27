# Post-FX stack

> Look target: [`CANDY_AESTHETIC_GUARDRAILS.md`](./CANDY_AESTHETIC_GUARDRAILS.md) — no photoreal defaults for GI / AO / SSR.

Owner: [`src/foliage/post-processing.ts`](../src/foliage/post-processing.ts)

## What ships

One TSL graph (`src/foliage/post-processing-webgpu.ts`) runs on both backends. The renderer is
always `WebGPURenderer`: on WGSL, or on Three's GLSL node backend under `forceWebGL` (the WebGL2
fallback). There is no separate EffectComposer path any more.

| Pass   | WebGPU (WGSL)                                                 | WebGL2 (GLSL node backend)               | Gate                                               |
| ------ | ------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Scene  | `pass(scene, camera, { samples: 4 })`, `rgba16float`, 4× MSAA | same pass; Three forces 0 samples        | always (except `?postfx=off`)                      |
| Bloom  | `BloomNode`                                                   | same                                     | always (cheap)                                     |
| DoF    | `dof()`                                                       | same                                     | `high` / `?dof`                                    |
| GTAO   | half-res `ao()`                                               | **skipped**                              | `high` / `?ao`; never `low` / CI                   |
| Pulse  | Candy glow + strobe in TSL graph (no viewport copy)           | Camera overlay (`viewportSharedTexture`) | WebGPU: always in graph; overlay skipped           |
| Shafts | additive planes + radial UV scatter via `uShaftScatterBoost`  | same planes, bloom swell                 | sunrise/sunset/moon + frustum; `?postfx=off` hides |
| SSR    | **not in this PR**                                            | —                                        | env-map mirrors (`getDreamEnvTexture`)             |

### Antialiasing

MSAA is paid once, on the scene pass. The canvas is created with `antialias: false`
(`resolveCanvasAntialias()` in `gpu-context.ts`): the only draw into it is the fullscreen post quad,
which MSAA cannot improve, and in Three 0.171 `antialias: true` also made `PassNode` inherit
`renderer.samples`, so the scene pass and the canvas each carried a 4× buffer. The scene pass now
asks for `SCENE_PASS_SAMPLES` (4) itself.

The WebGL2 fallback has no geometric AA: Three forces the scene pass to 0 samples on the GLSL
backend, and the canvas MSAA would only touch the post quad.

### `?postfx=off`

The URL flag is a real bypass: `initPostProcessing()` builds no graph and the frame is
`renderer.render(scene, camera)` straight to the canvas, with canvas MSAA on. Shadows, GI and god
rays are off as well. The `low` graphics tier, WebGL2 and automation also resolve the post-FX
_quality_ to `'off'`, but that only drops the optional passes (DoF, GTAO, god rays); they keep
the scene pass, bloom and the grade (`isPostStackBypassed()` is the one predicate).

GI is **irradiance probes**, not screen-space, so GTAO is the only extra depth fetch. Do not add SSR on top without a budget pass.

## Viewport copies (WebGPU)

Do **not** attach `viewportSharedTexture()` overlays to the camera on the WGSL backend. Three's shared `FramebufferTexture` is `rgba8unorm` and often 1×1 until resize; the scene pass is `rgba16float`. `copyFramebufferToTexture` then fails (`Source and destination formats do not match. rgba16float rgba8unorm`) and can copy a 1572×1070 rectangle out of a 1×1 source. Candy glow / strobe uniforms still drive gameplay; the TSL post graph samples `scenePass.getTextureNode()`.

## Bloom knobs

`CONFIG.postfx.bloomThreshold` (default 0.85) and `bloomRadius` (0.5). Strength stays audio-driven (`uBloomStrength`). Live uniforms `uBloomThreshold` / `uBloomRadius` (`?debug=1` sliders).

## AO (candy-soft)

GTAO at `resolutionScale = 0.5`, 8 samples. Cavity mixes toward pink-cocoa `(0.88, 0.74, 0.84)` — chroma stays, no grey dirt. `setAoStrength(0)` restores the pre-AO look without a recompile when the pass was built.

## Shafts

Still golden-hour / night / strong-melody gated (`applyMusicReactiveLightShafts`). Density: 8 planes on `low`, 16 on `high`, 0 when god rays are off. TSL falloff is `pow(2.2)` on V so beams dissipate. No permanent haze: `uShaftScatterBoost` is 0 when the group is hidden.

## SSR (deferred)

Mirrors already sample `getDreamEnvTexture()`. A `SSRNode` would be a second full-screen depth/normal pass. Skip on `low`; not shipped here.
