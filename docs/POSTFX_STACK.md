# Post-FX stack

> Look target: [`CANDY_AESTHETIC_GUARDRAILS.md`](./CANDY_AESTHETIC_GUARDRAILS.md) — no photoreal defaults for GI / AO / SSR.

Owner: [`src/foliage/post-processing.ts`](../src/foliage/post-processing.ts)

## What ships

One TSL graph (`src/foliage/post-processing-webgpu.ts`) runs on both backends. The renderer is
always `WebGPURenderer`: on WGSL, or on Three's GLSL node backend under `forceWebGL` (the WebGL2
fallback). There is no separate EffectComposer path any more.

| Pass   | WebGPU (WGSL)                                                                          | WebGL2 (GLSL node backend)               | Gate                                               |
| ------ | -------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Scene  | `pass(scene, camera, { samples })`, `rgba16float`; 4× MSAA in `msaa` mode, 0 otherwise | same pass; FXAA by default               | always (except `?postfx=off`)                      |
| Bloom  | `BloomNode`                                                                            | same                                     | always (cheap)                                     |
| DoF    | `dof()`                                                                                | same                                     | `high` / `?dof`                                    |
| GTAO   | half-res `ao()`; MRT normals under TRAA                                                | **skipped**                              | `high` / `?ao`; never `low` / CI                   |
| Pulse  | Candy glow + strobe in TSL graph (no viewport copy)                                    | Camera overlay (`viewportSharedTexture`) | WebGPU: always in graph; overlay skipped           |
| Shafts | additive planes + radial UV scatter via `uShaftScatterBoost`                           | same planes, bloom swell                 | sunrise/sunset/moon + frustum; `?postfx=off` hides |
| SSR    | **not in this PR**                                                                     | —                                        | env-map mirrors (`getDreamEnvTexture`)             |

### Antialiasing

`resolveAntialiasMode()` (`src/core/config/postfx.ts`) picks one mode per session;
`?aa=off|msaa|fxaa|smaa|traa` overrides it.

| Mode   | Where it runs by default      | What it costs                                                                |
| ------ | ----------------------------- | ---------------------------------------------------------------------------- |
| `msaa` | `medium`; `high` without GTAO | 4× `rgba16float` + depth on the scene pass (`SCENE_PASS_SAMPLES`)            |
| `fxaa` | WebGL2, `low`                 | one fullscreen pass on the tone-mapped image, plus that image as a texture   |
| `smaa` | `high` (GTAO is on there)     | edges, weights and blend passes (three's `SMAANode`), plus the image texture |
| `traa` | opt-in                        | MRT velocity + normal on the scene pass, one resolve pass and its history    |
| `off`  | opt-in                        | nothing                                                                      |

GTAO rules MSAA out: it gathers the scene pass's depth (`textureGather`), and a 4× pass's depth
is a `texture_depth_multisampled_2d`, which WGSL cannot gather from, so the AO shader fails to
compile. With GTAO on, `resolveAntialiasMode()` turns `msaa` (`?aa=msaa` included) into `smaa`.

MSAA is paid once, on the scene pass. The canvas is created with `antialias: false`
(`resolveCanvasAntialias()` in `gpu-context.ts`): the only draw into it is the fullscreen post quad,
which MSAA cannot improve, and in Three 0.171 `antialias: true` also made `PassNode` inherit
`renderer.samples`, so the scene pass and the canvas each carried a 4× buffer. The scene pass asks
for its samples itself, and only in `msaa` mode.

A WebGL2 context without float colour targets (`EXT_color_buffer_float` /
`EXT_color_buffer_half_float`) cannot draw the `rgba16float` scene pass at all, so it renders
direct, as under `?postfx=off`.

FXAA and SMAA work on display-referred colour, so in those modes the pipeline's own output
transform is off (`outputColorTransform = false`) and the graph is
`fxaa(renderOutput(composite))`: tone mapping and sRGB happen first, then the edge filter. Before
r186 the WebGL2 fallback had no geometric AA at all; three r186's GLSL backend can resolve an MSAA
scene pass (`?renderer=webgl&aa=msaa`), but FXAA is the default there because the fallback is what
weak GPUs get.

TRAA jitters the camera and reprojects with the scene pass's `velocity` MRT target; the same MRT
writes `normalView`, which GTAO then samples instead of reconstructing normals from depth. It is
not a default yet: the velocity node sees the camera and object transforms but not the foliage's
vertex-shader sway, so swaying leaves can smear. Check it on real hardware before promoting it to
`high`.

### Dynamic resolution

`src/rendering/dynamic-resolution.ts` keeps the GPU frame inside a 14 ms budget by scaling the
scene pass (`PassNode.setResolutionScale`) between 0.6 and 1.0 of the drawing buffer (whose size
the tier's `maxPixelRatio` already caps). The input is the GPU frame timer (`gpu-frame-timer.ts`,
one sample every 30 frames), so it only runs where `timestamp-query` was granted: `?debug`,
`?graphics=high`, or `?dynres=1`, which also requests the feature. `?dynres=0` turns it off;
automation never runs it.

- Hysteresis: the scale drops after 2 samples in a row over budget, by what the pixel count says
  (GPU time ∝ scale²), at most 0.15 per step; it rises 0.05 after 6 samples in a row under 70 % of
  the budget. Inside the band nothing moves and the streaks reset.
- Upscale: with `traa` the resolve is TAA-U (`taau()`), which reconstructs at full resolution from
  the jittered low-resolution frames; otherwise FSR 1 (`fsr1()`, EASU + RCAS) upscales the scene
  colour before the composite. Bloom, DoF and GTAO keep reading the scaled scene pass.
- `?debug` shows it on the Post-FX row of the systems budget: `renderScalePct`, the AA mode and the
  last GPU sample. `window.__candyPostFx` has the same state.

### `?postfx=off`

The URL flag is a real bypass: `initPostProcessing()` builds no graph and the frame is
`renderer.render(scene, camera)` straight to the canvas, with canvas MSAA on. Shadows, GI and god
rays are off as well. The `low` graphics tier, WebGL2 and automation also resolve the post-FX
_quality_ to `'off'`, but that only drops the optional passes (DoF, GTAO, god rays); they keep
the scene pass, bloom and the grade (`isPostStackBypassed()` is the one predicate).

GI is **irradiance probes**, not screen-space, so GTAO is the only extra depth fetch. Do not add SSR on top without a budget pass.

## Viewport copies (WebGPU)

Do **not** attach `viewportSharedTexture()` overlays to the camera on the WGSL backend. Three's shared `FramebufferTexture` is `rgba8unorm` and often 1×1 until resize; the scene pass is `rgba16float`. `copyFramebufferToTexture` then fails (`Source and destination formats do not match. rgba16float rgba8unorm`) and can copy a 1572×1070 rectangle out of a 1×1 source. Candy glow / strobe uniforms still drive gameplay; the TSL post graph samples `scenePass.getTextureNode()`.

## Pipeline

`RenderPipeline` (three r183+; `PostProcessing` before that) owns the fullscreen output quad. Its
`outputNode` is the composite `Fn`: chromatic aberration and pulse warp over the scene pass, then
DoF mix, AO tint, bloom add, grade, vignette and strobe.

## DoF knobs

r186's `DepthOfFieldNode` takes `(focusDistance, focalLength, bokehScale)` in world units, not
r171's Bokeh-shader `(focus, aperture, maxblur)`. `CONFIG.postfx.dofFocalLength` (33) is how far a
surface can sit from the focal plane before it is fully blurred, which keeps where the old
aperture 0.015 / max blur 0.5 saturated; `CONFIG.postfx.dofBokehScale` (6) is the bokeh radius in
pixels at full blur. Focus still follows `uDofFocus` and the mix `uDofMix`.

## Bloom knobs

`CONFIG.postfx.bloomThreshold` (default 0.85) and `bloomRadius` (0.5). Strength stays audio-driven (`uBloomStrength`). Live uniforms `uBloomThreshold` / `uBloomRadius` (`?debug=1` sliders).

## AO (candy-soft)

GTAO at `resolutionScale = 0.5`, 8 samples. Cavity mixes toward pink-cocoa `(0.88, 0.74, 0.84)` — chroma stays, no grey dirt. `setAoStrength(0)` restores the pre-AO look without a recompile when the pass was built.

## Shafts

Still golden-hour / night / strong-melody gated (`applyMusicReactiveLightShafts`). Density: 8 planes on `low`, 16 on `high`, 0 when god rays are off. TSL falloff is `pow(2.2)` on V so beams dissipate. No permanent haze: `uShaftScatterBoost` is 0 when the group is hidden.

## SSR (deferred)

Mirrors already sample `getDreamEnvTexture()`. A `SSRNode` would be a second full-screen depth/normal pass. Skip on `low`; not shipped here.
