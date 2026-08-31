# Lightweight GI — irradiance probes

**Status:** Landed
**Affected systems:** unified materials (TSL), lighting config, game loop, local-light registry.

Candy World is lit as **hemisphere ambient + one directional sun + fog + emissive TSL**.
That works for anything facing the sky and falls apart for everything that is not:
cave undersides, the inside of a dense grove, the sugar caves. Those surfaces get
the same flat hemisphere term as an open meadow, so they read as _unlit_, not as
_indirectly lit_.

This adds the one missing term — a soft, coloured bounce — as a **player-following
SH-L1 irradiance probe volume**, baked on the CPU and sampled from the unified
material's node graph. It is not GI in the Lumen sense and is not trying to be:
no path tracing, no multi-bounce, no per-light propagation.

## Why probes, and not screen-space

The brief allowed either. Probes won on three counts:

|                     | Probes                                                                     | SSGI                                                        |
| ------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Stability           | Fixed in world space — no flicker on camera cuts, no ghosting              | Reprojection artefacts, needs denoising                     |
| Off-screen surfaces | Lit correctly                                                              | Not lit at all — exactly the cave/grove cases we care about |
| Backend             | `Data3DTexture` + 4 fetches; the GLSL node backend handles `sampler3D` too | WebGPU-only depth/normal plumbing                           |

The bake is CPU-side and analytic, so nothing about the technique is
WebGPU-specific. See [WebGL](#webgl) below for what that buys today.

## Why it is candy-first

The bake is deliberately **not** a physically-correct gather, because a correct
one converges toward grey. Three pastel sources are summed and then pushed _back
toward saturation_:

1. **Sky openness.** The hemisphere sky colour, gated by how much sky the probe
   can actually see (derived from terrain height at the probe). Under a roof this
   goes to zero.
2. **Ground bounce.** Sun landing on the pale-mint terrain albedo
   (`0x98fb98`, matching `createGroundMaterial()`) and coming back up, falling off
   with height. This is the term that tints the underside of every cap and canopy.
3. **Bounce donors.** Every point light, spot light and decorative fill in
   `src/rendering/lights.ts` is treated as a coloured surface that bleeds. No new
   authoring was needed: a grove of luminous flowers already registers fills, and
   those become the grove's bounce for free.
4. **Interior fill.** Where sky visibility is zero, an icy cyan (`caveFill`) keeps
   sugar-cave interiors _dim_, never black.

Then the **pastel guard** (`pastelBias`, `pastelSaturation`) runs: magnitude is
preserved — it carries the energy — and only the chroma is re-saturated, with the
same per-channel correction applied to the directional bands so the bleed keeps
the hue of the flat term. Real bounce converges toward grey; this converges
toward **tint**. Interiors pick up the cyan of a crystal rib or the pink of a
mushroom cap instead of a dirty wash.

Albedo is never touched. The term is added to `emissiveNode` **multiplied by the
material's own colour**, so it tints the surface rather than washing over it —
pastels stay pastel.

## Shape

```
gridX × gridY × gridZ probes, cellSize apart, centred on the camera
    ↓ snapped to whole cells (the volume cannot swim)
4 × RGBA8 Data3DTexture — SH L1: L0, L1x, L1y, L1z
    ↓ tex0.a carries sky visibility
trilinear (hardware) → irradiance(n) = max(L0 + dot(L1, n) · directionality, 0)
```

The bake is **amortised**: `probesPerFrame` probes per frame, walked
**nearest-to-camera first** so the probes around the player settle within a frame
or two and the far corners catch up behind the fog. The walk cycles forever, so
the day/night tint follows along without any explicit invalidation.

## Quality tiers

| Tier               | Grid           | Spacing | Bake budget     | Full refresh         |
| ------------------ | -------------- | ------- | --------------- | -------------------- |
| `low` / CI / WebGL | —              | —       | —               | **skipped entirely** |
| `medium` (default) | 10×5×10 = 500  | 10u     | 24 probes/frame | 21 frames            |
| `high`             | 14×7×14 = 1372 | 8u      | 40 probes/frame | 35 frames            |

Resolved by `resolveGiSettings()` in `src/core/config/postfx.ts`, which reads
`StartupCapabilities` — never the raw persisted profile — exactly like
`resolveShadowSettings()`.

## Frame budget

Measured with the shipping config, ~100 donors in range, volume moving every frame:

| Tier     | CPU bake                          | Texture upload | GPU                                                     |
| -------- | --------------------------------- | -------------- | ------------------------------------------------------- |
| `medium` | **~0.03 ms/frame**                | 8 KB/frame     | 4 × `texture3D` + ~20 ALU per unified-material fragment |
| `high`   | **~0.05 ms/frame**                | 22 KB/frame    | same                                                    |
| `low`    | **0** — no volume, no shader term | 0              | 0                                                       |

There is no extra render pass, no G-buffer, and no readback. On `low` the volume
is never allocated, so `getIrradianceNode()` returns `null` and the term is not
even compiled into the material — the shader is byte-for-byte the pre-GI one.

Profiled per frame as `IrradianceProbes` in `game-loop-visuals.ts`, next to
`ClusteredLighting`.

## Toggling off

Two levels, both exact:

- **`?gi=off`** (or `?postfx=off`, or `CONFIG.lighting.gi.forceDisable`) — the
  volume is never allocated and materials compile without the term.
- **`setIrradianceEnabled(false)`** at runtime — the master gain uniform goes to
  zero, so the term evaluates to `vec3(0)` and every material lands back on its
  pre-GI look. Nothing recompiles.

## Debug

| Flag                  | Effect                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?debug=1`            | Probe gizmos: one small sphere per probe, tinted by its flat (L0) band, so the volume's placement _and_ its colour bleed are visible at a glance                |
| `?gi=debug`           | Force the volume on **and** show the gizmos, without the rest of the debug panel                                                                                |
| `?gi=on` / `?gi=high` | Force the volume on at default / high density, bypassing the tier and CI gates. This is how you inspect the bounce on a headless capture or a low-tier machine. |
| `?gi=off`             | Skip the volume entirely                                                                                                                                        |
| `window.__candyGI`    | Live stats breadcrumb, refreshed about once a second — grid, spacing, bake budget, probes baked since the volume last moved, donors in range                    |

`CONFIG.lighting.gi.forceDisable` is the one switch no URL flag can talk out of.

## API (`src/rendering/irradiance-probes.ts`)

| Function                                    | Use                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initIrradianceProbes(scene, sampleGround)` | Allocate the volume. **Must run before world generation** — a material compiled without the term can never gain it. Returns `false` when the tier skipped it. |
| `attachProbeDebug(scene)`                   | Probe gizmos. No-op unless `?debug=1` / `?gi=debug`.                                                                                                          |
| `updateIrradianceProbes(centre, env)`       | Per-frame bake slice. `env` carries the current sky/sun so the bounce tracks the day cycle.                                                                   |
| `getIrradianceNode(worldPos, worldNormal)`  | The irradiance term, or `null` when GI is off. Returns _irradiance_, not final colour — callers multiply by albedo.                                           |
| `setIrradianceEnabled(bool)`                | Runtime on/off via the gain uniform.                                                                                                                          |
| `getIrradianceStats()`                      | Debug / test readout.                                                                                                                                         |

`sampleGround` is injected rather than imported so the module stays off the WASM
ground-system's import chain — the bake only needs a heightfield, and headless
suites hand it a synthetic one.

## WebGL

Skipped today, and not because the technique needs WebGPU. The WebGL path clamps
the graphics tier to `low` (`forceLite` in `resolveStartupCapabilities`), and GI
is off on `low`. Nothing goes black: with no volume there is no shader term at
all.

Everything the effect uses — `Data3DTexture` with linear filtering, `texture3D`,
RGBA8 encoding — is supported by the GLSL node backend, so enabling it on WebGL
later is a matter of relaxing `CONFIG.lighting.gi.disableOnLow`, not of writing a
second code path. This was checked, not assumed: booting
`?renderer=webgl&gi=on` builds and renders a GI-bearing unified material with no
shader errors. See `docs/webgl-fallback.md`.

## Known v1 limitations

- **Occlusion is heightfield-only.** Sky visibility comes from terrain height, so
  a probe reads "interior" under terrain but not under a dense canopy of meshes.
  Groves get their bounce from registered fills instead. A donor/occluder proxy
  registry is the natural v2.
- **Volume shifts restart the bake.** When the player crosses a cell boundary
  every probe stands somewhere new, and the texture still holds the previous
  neighbourhood's values until the nearest-first walk catches up. The term is
  low-frequency and subtly weighted, so this reads as a slow settle rather than a
  pop, but it is the main thing to revisit if the effect is pushed harder.
- **Unified materials only.** Terrain, batched foliage shaders and the sky do not
  sample the volume yet.
- **Single bounce, no specular.** Diffuse irradiance only, by design.

## Tuning

Everything lives in `CONFIG.lighting.gi` (`src/core/config/defaults.ts`), typed in
`src/core/config/types.ts`. The knobs worth reaching for first:

| Knob                              | Effect                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `intensity`                       | Master gain. The first thing to turn down if the world reads hazy.                                             |
| `directionality`                  | 0 = flat fill everywhere, 1 = full L1. Higher reads more like real bounce, lower is safer at low grid density. |
| `pastelSaturation` / `pastelBias` | The candy guardrail. Drop `pastelBias` to 0 for a physically-honest (and greyer) bake.                         |
| `donorStrength`                   | How loudly local lights bleed. This is what makes the sugar caves and luminous groves read.                    |
| `caveFill` / `caveFillStrength`   | Interior floor colour and weight.                                                                              |

## Tests

```bash
npm run test:gi     # quality gate, volume geometry, candy bounce, interior fill, toggle
```

`tests/irradiance-probes.test.mjs` covers the decision layer and the CPU bake
against a synthetic heightfield (flat ground plus a roof standing in for the
sugar caves), including the guardrail assertion that a saturated donor's bounce
keeps its chroma rather than settling into grey. The GPU side — four `texture3D`
fetches in the unified material — is exercised by the boot smoke test.

## Verification

| What                                                                     | How                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Quality gate, volume geometry, bake, pastel guard, interior fill, toggle | `npm run test:gi`                                                                                                  |
| Shader builds and renders on **WebGPU**                                  | Headless Chromium, `?boot=explore&graphics=medium&gi=on`, unified material created and rendered — no shader errors |
| Shader builds and renders on the **GLSL** backend                        | Same, with `?renderer=webgl`                                                                                       |
| Bake runs in the real game loop                                          | `window.__candyGI` reaches `baked: 500 / 500` with the authored crystal fill and mushroom spot picked up as donors |
| Bake cost                                                                | Benchmarked at the shipping config — see [Frame budget](#frame-budget)                                             |

Not yet measured: pixel-level GI on/off diffs in CI (the cloud VM does not
rasterize 3D). Staging pose is `sugar_caves` in
`tools/visual-regression/viewpoints.json` (night, floor Y≈-12). Run locally with
`?boot=explore&gi=on` vs `?gi=off`. Aesthetic guardrails issue #1589 has not
landed; the candy-first rules live in this file and
`docs/CANDY_MATERIAL_COOKBOOK.md` → Lightweight GI.

## Related

- `docs/LOCAL_LIGHTS.md` — the registry the bounce donors come from
- `docs/CLUSTERED_LIGHTS.md` — direct local lighting, the term this complements
- `docs/CANDY_MATERIAL_COOKBOOK.md` — material recipes the bounce lands on
- `docs/SUGAR_CAVES_SHIP.md` — the indoor lighting pain that motivated this
