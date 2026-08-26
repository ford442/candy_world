# Post-FX stack

Owner: [`src/foliage/post-processing.ts`](../src/foliage/post-processing.ts)

## What ships

| Pass | WebGPU (TSL) | WebGL (`forceWebGL` / EffectComposer) | Gate |
| --- | --- | --- | --- |
| Scene | `pass(scene, camera)` | `RenderPass` | always |
| Bloom | `BloomNode` | `UnrealBloomPass` | always (cheap) |
| DoF | `dof()` | `BokehPass` | `high` / `?dof` |
| GTAO | half-res `ao()` | **skipped** | `high` / `?ao`; never `low` / CI |
| Shafts | additive planes + radial UV scatter via `uShaftScatterBoost` | same planes, bloom swell | sunrise/sunset/moon + frustum; `?postfx=off` hides |
| SSR | **not in this PR** | — | env-map mirrors (`getDreamEnvTexture`) |

GI is **irradiance probes**, not screen-space, so GTAO is the only extra depth fetch. Do not add SSR on top without a budget pass.

## Bloom knobs

`CONFIG.postfx.bloomThreshold` (default 0.85) and `bloomRadius` (0.5). Strength stays audio-driven (`uBloomStrength`). Live: `setBloomThreshold` / `setBloomRadius`, `?debug=1` sliders.

## AO (candy-soft)

GTAO at `resolutionScale = 0.5`, 8 samples. Cavity mixes toward pink-cocoa `(0.88, 0.74, 0.84)` — chroma stays, no grey dirt. `setAoStrength(0)` restores the pre-AO look without a recompile when the pass was built.

## Shafts

Still golden-hour / night / strong-melody gated (`applyMusicReactiveLightShafts`). Density: 8 planes on `low`, 16 on `high`, 0 when god rays are off. TSL falloff is `pow(2.2)` on V so beams dissipate. No permanent haze: `uShaftScatterBoost` is 0 when the group is hidden.

## SSR (deferred)

Mirrors already sample `getDreamEnvTexture()`. A `SSRNode` would be a second full-screen depth/normal pass. Skip on `low`; not shipped here.
