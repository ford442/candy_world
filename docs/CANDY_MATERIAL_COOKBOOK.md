# Candy Material Cookbook (v2)

Recipes for Candy World's glossy, music-reactive surfaces. **Reuse a `CandyPresets.*`
factory or copy a shipping batcher** before hand-rolling a material.

| Canonical source                    | Path                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Presets & TSL helpers               | [`src/foliage/material-core.ts`](../src/foliage/material-core.ts) barrel → [`material-core/`](../src/foliage/material-core/) |
| Standard deformation chain          | [`applyStandardDeformation`](../src/foliage/material-core/deformation.ts)                                                    |
| LOD batcher deformation             | [`src/foliage/lod-nodes.ts`](../src/foliage/lod-nodes.ts) → `applyStandardDeformationWithLod`                                |
| Biome / music uniforms              | [`src/systems/biome-uniforms.ts`](../src/systems/biome-uniforms.ts)                                                          |
| Per-frame binding update            | [`src/systems/music-reactivity.ts`](../src/systems/music-reactivity.ts)                                                      |
| Music map overrides                 | [`docs/MUSIC_MAP_BINDING.md`](./MUSIC_MAP_BINDING.md)                                                                        |
| Binding conventions (authoritative) | [`AGENTS.md`](../AGENTS.md) → "Music Reactivity & Biome / Channel-to-Shader Binding Conventions"                             |
| Palette & note colors               | [`src/core/config.ts`](../src/core/config.ts) (`PALETTE`, `noteColorMap`)                                                    |

> **Maintenance model:** This file is a curated index with deep-links — not a second
> copy of the code. Prefer linking to the source over pasting snippets that will drift.
> A tracked follow-up is JSDoc `@example` blocks in `material-core.ts` plus a CI
> preset-coverage guard (`npm run test:cookbook-presets`).

---

## Rendering stack (2026 baseline)

Candy World ships on **`three@^0.171.0`** with WebGPU-first TSL materials:

```ts
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, mix, attribute, positionLocal } from 'three/tsl';
```

- **Do not** start new foliage on legacy `ShaderMaterial` / `onBeforeCompile` paths.
- `WebGPURenderer` is the default; it auto-falls back to **WebGL2** when WebGPU is
  unavailable (`?renderer=webgl`, `localStorage candy.renderer`, debug panel).
- **Browser support:** evergreen browsers with WebGPU (Chrome/Edge 113+, Firefox ≥141,
  Safari ≥26). WebGL2 remains the reference path for CI and porting (#1168).
- **COOP/COEP** headers (Vite dev + preview) are unchanged — required for
  `SharedArrayBuffer` / libopenmpt pthreads. Verify with `window.crossOriginIsolated`.

---

## `CandyPresets` — all seven factories

Defined in [`material-core/presets.ts`](../src/foliage/material-core/presets.ts).
Each takes `(hex, opts?)` → `MeshStandardNodeMaterial`; spread `opts` to override.

| Preset     | Feel                          | Key opts                                                                                                                                                         | Used in                                                                                                                  |
| ---------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Clay`     | Matte, tactile ground         | roughness 0.8, bump, rim 0.3                                                                                                                                     | terrain, trunks, stems — [`foliage-materials.ts`](../src/foliage/foliage-materials.ts)                                   |
| `Sugar`    | Frosted crust, glazed coat    | sheen 1.0, noiseScale 60, **clearcoat 0.7**                                                                                                                      | snow, rose caps — [`tree-batcher.ts`](../src/foliage/tree-batcher.ts)                                                    |
| `Gummy`    | Translucent, inner glow       | transmission 0.9, ior 1.4, wrapped translucency, **dream env @ 0.6**. Clearcoat opt-in. Pair with `lighting.shadows.bias` / `normalBias` so contacts don't acne. | fruit, canopies — [`berries.ts`](../src/foliage/berries.ts)                                                              |
| `SeaJelly` | Wet, wobbly, very translucent | transmission 0.95, ior 1.33, `animateMoisture`                                                                                                                   | water, waterfalls — [`water.ts`](../src/foliage/water.ts), [`waterfall-batcher.ts`](../src/foliage/waterfall-batcher.ts) |
| `Crystal`  | Refractive gem / glass        | transmission 1.0, ior 2.0, iridescence, **dream env @ 1.0**. Same shadow-bias pairing as Gummy.                                                                  | gems, glass mycelium — [`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts)                                     |
| `Velvet`   | Soft sheen, no specular       | roughness 1.0, colored sheen                                                                                                                                     | petals — [`simple-flower-batcher.ts`](../src/foliage/simple-flower-batcher.ts)                                           |
| `OilSlick` | Dark base, rainbow edges      | metalness 0.8, iridescence 1.0                                                                                                                                   | rare accents — [`foliage-materials.ts`](../src/foliage/foliage-materials.ts) `mushroomPalette`                           |

```ts
import { CandyPresets } from '../foliage/material-core.ts';

const cap = CandyPresets.Gummy(0xff69b4);
const water = CandyPresets.SeaJelly(0x44aaff);
const gem = CandyPresets.Crystal(0xe0115f, { side: THREE.DoubleSide });
const ground = CandyPresets.Clay(0xbfa76f);
const slick = CandyPresets.OilSlick();
```

---

## Recipe table (music-reactive surfaces)

| Recipe                  | Preset / approach             | Music hook                                                  | Live example                                                            |
| ----------------------- | ----------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Glossy mushroom cap     | clearcoat + rim               | `getBiomeUniforms('crystalline_nebula').noteColor`          | [`mushroom-batcher.ts`](../src/foliage/mushroom-batcher.ts)             |
| Crystal gem corridor    | `CandyPresets.Crystal` + rim  | `getBiomeUniforms('gem_canopy')` + `gemCanopyNoteColorNode` | [`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts)           |
| Glass mycelium          | `Crystal` + vein emissive     | `LuminousPlantUniforms.intensity` + `uAudioLow`             | [`glass-mushroom-batcher.ts`](../src/foliage/glass-mushroom-batcher.ts) |
| Luminous plant glow     | stem TSL + circadian          | `luminousPlantsNoteColorNode` (LUT) + `uCircadianPhase`     | [`luminous-plant-batcher.ts`](../src/foliage/luminous-plant-batcher.ts) |
| Twilight emissive (any) | preset emissive × `uTwilight` | circadian gate                                              | most `*-batcher.ts` under `src/foliage/`                                |

Full channel→uniform mapping: [`assets/music-bindings.json`](../assets/music-bindings.json)
and [`MUSIC_MAP_BINDING.md`](./MUSIC_MAP_BINDING.md).

---

## TSL patterns (link, don't duplicate)

Import surface — see [`material-core.ts` exports](../src/foliage/material-core.ts):

```ts
import {
    CandyPresets,
    getCachedProceduralMaterial,
    createJuicyRimLight,
    createRimLight,
    createSugarSparkle,
    applyStandardDeformation,
    uTime,
    uAudioLow,
    uAudioHigh,
} from '../foliage/material-core.ts';
import { color, float, mix, positionLocal, attribute } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
```

### Juicy rim light

`createJuicyRimLight(baseColor, intensity, power, normalNode | null)` — see
[`material-core/tsl-nodes.ts`](../src/foliage/material-core/tsl-nodes.ts). Reference usage:
[`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts).

### Vertex deformation — one canonical order

**Source of truth:** [`applyStandardDeformation`](../src/foliage/material-core/deformation.ts) composes
**wind sway on the base position, then player push** on that sum:

```ts
// material-core.ts — do not re-order manually
mat.positionNode = applyStandardDeformation(positionLocal);
```

LOD batchers use the parallel helper:

```ts
import { applyStandardDeformationWithLod } from './lod-nodes.ts';
mat.positionNode = applyStandardDeformationWithLod(animatedBase);
```

[`foliage-materials.ts`](../src/foliage/foliage-materials.ts) (stem / flowerStem) calls
`applyStandardDeformation(positionLocal)` — match this, not ad-hoc nesting.

### Per-instance TSL attributes (batchers)

There is no project-local `instancedBufferAttribute()` helper. The shipping pattern:

1. Allocate `THREE.InstancedBufferAttribute` (or `StorageInstancedBufferAttribute` from
   `three/webgpu` for compute-adjacent systems) on the `InstancedMesh` geometry.
2. Reference in TSL with `attribute('aName', 'float' | 'vec3')` from `three/tsl`.

Examples: [`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts) (`aPhase`,
`aArmLen`), [`berries.ts`](../src/foliage/berries.ts) (`StorageInstancedBufferAttribute` +
`attribute('aGlow')`), [`arpeggio-batcher.ts`](../src/foliage/arpeggio-batcher.ts).

### Cache procedural materials

`getCachedProceduralMaterial(key, colorHint, factory)` — one graph per archetype.
See [`getCachedProceduralMaterial`](../src/foliage/material-core/shared-resources.ts). Inside the factory callback,
still use `applyStandardDeformation(positionLocal)` for displacement.

### Twilight / circadian glow

| Uniform           | Export                                                                   | Written by                         |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| `uTwilight`       | [`src/foliage/sky.ts`](../src/foliage/sky.ts) (`export const uTwilight`) | day/night cycle + music reactivity |
| `uCircadianPhase` | [`src/systems/biome-uniforms.ts`](../src/systems/biome-uniforms.ts)      | 0 = night, 1 = day                 |

Verified import (batchers, weather, music-reactivity all use this path):

```ts
import { uTwilight } from '../foliage/sky.ts'; // from src/foliage/*
import { uCircadianPhase } from '../systems/biome-uniforms.ts';
```

Reference circadian emissive gate: [`luminous-plant-batcher.ts`](../src/foliage/luminous-plant-batcher.ts)
(`mix(nightGlowMultiplier, 1.0, uCircadianPhase)`). Reactive emissive that ignores
`uCircadianPhase` will glow in broad daylight.

---

## Music reactivity gotchas

### Entry point: `getBiomeUniforms(biome)`

**Do not** hard-import `BiomeUniforms.arpeggioGrove.*` in new batchers. Resolve once:

```ts
import { getBiomeUniforms, type BiomeId } from '../systems/biome-uniforms.ts';
const u = getBiomeUniforms('gem_canopy' satisfies BiomeId);
```

Set `userData.biome` on placed proxies so tooling and LOD agree on the tag.

### `noteColor` is often a LUT sample, not a raw hex

Sky and luminous plants sample **128-slot note→color DataTextures** built in
[`biome-uniforms.ts`](../src/systems/biome-uniforms.ts):

- `skyNoteColorNode` ← `skyLutData` / `_skyLutTex`
- `luminousPlantsNoteColorNode` ← `luminousPlantsLutData`

Passing a static `color(0x…)` where the shader expects `luminousPlantsNoteColorNode`
silently kills note reactivity. Gem canopy currently lerps `BiomeUniforms.gemCanopy.noteColor`
(CPU-updated) — see `gemCanopyNoteColorNode` in the same file.

### WebGPU `r32float` data textures break filtering

`biome-uniforms.ts` documents why LUTs use **`HalfFloatType` (r16float)**, not r32float:
r32float is non-filterable under WebGPU and breaks `texture()` / `textureSample`.
Any new foliage data texture must follow the same pattern (see comment ≈ L157–160).

### Zero-allocation hot paths

**No `new THREE.Vector3` / `THREE.Color` inside `update()` / `animate()` / per-frame
music binding.** Module-scope `_scratch*` only — e.g.
[`music-reactivity-core.ts`](../src/systems/music-reactivity-core.ts),
[`foliage-materials.ts`](../src/foliage/foliage-materials.ts). This is the project's
#1 GC-hygiene rule; smoke + perf budget assume it.

### Map-level music overrides

Entity / region / map JSON can override `assets/music-bindings.json` without code edits.
Precedence and examples: [`MUSIC_MAP_BINDING.md`](./MUSIC_MAP_BINDING.md).

---

## Tutorial: adding a reactive plant

Worked example — full step list also in **AGENTS.md**. Copy from a neighbor:

- [`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts) (crystal + biome uniforms)
- [`glass-mushroom-batcher.ts`](../src/foliage/glass-mushroom-batcher.ts) (reuses luminous uniforms)

1. **Channels** — `assets/music-bindings.json` (or map override per `MUSIC_MAP_BINDING.md`)
2. **Uniforms** — declare once in `biome-uniforms.ts`; add to `BiomeId` + `getBiomeUniforms()`
3. **Update** — accumulate in `music-reactivity.ts`; mutate `.value` in place; night-gate
4. **Batcher TSL** — `const u = getBiomeUniforms('my_grove')`; wire `mix` / emissive / displacement
5. **Placement** — `foliage-registry.ts` + `generation-decorators.ts` + `recordSpawnAttempt`
6. **Test** — isolated tracker module; `?renderer=webgl` parity

For vertex displacement in step 4, use `applyStandardDeformationWithLod` (batchers) or
`applyStandardDeformation` (non-LOD proxies) — see [Vertex deformation](#vertex-deformation--one-canonical-order).

---

## Foliage performance patterns

- **InstancedMesh batchers** for dense flora — never spawn individual `Mesh` in hot loops.
- **`getCachedProceduralMaterial`** — one TSL compile per archetype.
- **LOD:** squared distance in cull loops; use `*-WithLod` helpers from [`lod-nodes.ts`](../src/foliage/lod-nodes.ts).
- **Dispose** custom `InstancedBufferAttribute` / `StorageInstancedBufferAttribute` with the mesh.
- **WASM:** bulk work stays in WASM; don't cross the bridge per instance per frame.

---

## Comment tags for tunable values

| Tag                              | Where                                | Purpose                                  |
| -------------------------------- | ------------------------------------ | ---------------------------------------- |
| `// PALETTE:` / `// 🎨 PALETTE:` | `src/foliage/*` (dominant)           | Aesthetic tuning in materials & batchers |
| `// Visual Impact:`              | systems, newer batchers, `config.ts` | Cross-cutting visual constants           |
| `// Music Impact:`               | batchers + `music-reactivity.ts`     | Channel / uniform tuning                 |

`grep -rn "PALETTE:" src/foliage/` for foliage examples;
`grep -rn "Visual Impact:" src/` for systems-level knobs. Convention detail: **AGENTS.md**.

---

## Entity scale reference (procedural placement)

Canonical scale ranges live in [`CONFIG.world.scaleTable`](../src/core/config.ts) and are
sampled via [`sampleEntityScale` / `sampleEntityHeight`](../src/world/entity-scale.ts).
Hand-placed `map.json` entities keep explicit `scale` overrides.

| Archetype                             | refHeight @ base | Typical range | Notes                      |
| ------------------------------------- | ---------------- | ------------- | -------------------------- |
| Tree (bubble_willow, portamento_pine) | 4.5–5.5 u        | 0.9–1.1×      | Tallest grounded flora     |
| Mushroom / glass_mushroom             | 1.2–1.4 u        | 0.85–1.15×    | Cap diameter ≈ 1–2 u       |
| Arpeggio fern                         | 1.5 u            | 0.9–1.1×      | Musical flora, grove-tuned |
| Cymbal dandelion                      | 0.9 u            | 0.8–1.0×      | Ground-cover scale         |
| Luminous plant                        | 1.8 u            | 0.85–1.15×    | Lake-shore biolum          |
| Gem fruit                             | 0.25 u           | 0.85–1.15×    | Hanging from canopy trees  |
| Cloud (tier 1 / 2)                    | 12–35 u float    | tier-specific | Uses `size` param          |

Variance is clamped to **0.7×–1.5× of `base`** unless a biome override widens it.
Optional `scaleDistanceBias` shrinks instances ~8% toward biome outer radius.

---

## Core material foundations

- **MeshPhysicalNodeMaterial** (via presets): clearcoat + transmission for the candy look.
- **Clearcoat** is opt-in per preset — `Sugar` ships `0.7`, everything else defaults to `0`.
  See [Surface knobs](#surface-knobs-clearcoat-dream-env-translucency).
- **Metalness** ~0 (except `OilSlick`), **roughness** low–mid for gloss.
- **Transmission** for gummy / jelly / crystal / glass reads.
- **Environment**: no HDRI and no `scene.environment`. Reflections come from the shared
  procedural dream sky, opted into with `useDreamEnv`.

---

## Surface knobs: clearcoat, dream env, translucency

Three cross-cutting options on `UnifiedMaterialOptions`
([`unified-material.ts`](../src/foliage/material-core/unified-material.ts)). All three
are ordinary node/property assignments — none of them forks a second shader variant, so
`shader-warmup.ts` compiles the same program count it did before they existed.

### Before / after

**Before.** `Crystal` was `roughness: 0` with nothing in the scene to reflect —
`scene.environment` is null and no material carried an `envMap` — so a gem's entire
specular response was one sun dot on an otherwise flat facet. It read as grey studio
plastic that happened to be see-through. `Sugar` had sheen but no coat, so frosted
crust came out powdery rather than glazed. And `subsurfaceStrength` ran
`(1 - max(0, N·L))²`, which is _brightest on the faces pointing away from the light_ and
consults neither the view direction nor `thickness` — a gummy glowed hardest exactly
where it should have been in shadow, and a 4-unit-thick slab glowed as hard as a 0.2-unit
sliver.

**After.** `Crystal` and `Gummy` sample one shared procedural sky, so their highlights
carry candy hues; `Sugar` gets a real second specular lobe; translucency is a wrap term
plus a view-dependent back-scatter lobe, both extinguished by thickness. Net cost is one
512² `DataTexture`, one PMREM chain (shared, see below), the clearcoat lobe on `Sugar`,
and roughly a dozen ALU ops on the translucency path.

### `clearcoat` / `clearcoatRoughness` — a real second lobe

The genuine `MeshPhysicalNodeMaterial` clearcoat (r171 `clearcoatNode` /
`clearcoatRoughnessNode`, driving `PhysicalLightingModel`'s clearcoat branch), not a
fresnel fake.

| Knob                    | Default | Visual Impact                                                                                                 |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `clearcoat`             | `0`     | **Opt-in.** `0` compiles nothing (`useClearcoat` is false). `Sugar` ships `0.7`; ~1.0 shrink-wraps the crust  |
| `clearcoatRoughness`    | `0.1`   | `0` reads as wet plastic. Track the base surface — `Sugar` uses `0.25` to keep the highlight broad and soft   |
| `clearcoatTint`         | `null`  | **Stylized, not physical.** glTF clearcoat has no colour; this is a fresnel-weighted tint added to _emissive_ |
| `clearcoatTintStrength` | `0.2`   | Scales the tint (also multiplied by `clearcoat`). Emissive, so it feeds bloom — keep it small                 |

```ts
// Wrapper-fresh gummy: the bare preset stays matte-surfaced on purpose.
const wrapped = CandyPresets.Gummy(0xff69b4, { clearcoat: 0.8, clearcoatRoughness: 0.1 });
```

### `useDreamEnv` / `envMapIntensity` — one shared sky

[`material-core/env-map.ts`](../src/foliage/material-core/env-map.ts) generates the
procedural dream sky once and hands the _same texture object_ to every opted-in material.
Three's `EnvironmentNode` keys its PMREM cache on the texture, so one PMREM chain serves
every instance — **batchers are unaffected**: nothing is per-instance, no extra render
target per archetype, and instanced meshes share the material as before.

| Knob              | Default | Notes                                                                       |
| ----------------- | ------- | --------------------------------------------------------------------------- |
| `useDreamEnv`     | `false` | On by default for `Crystal` and `Gummy`. Subject to the session gate below  |
| `envMapIntensity` | `1.0`   | `Gummy` uses `0.6` so it stays a diffuse-ish blob rather than a chrome bead |

Gated like GI (`resolveGiSettings()`): **off on CI / headless and on the `low` graphics
tier**, forced either way with `?env=on` / `?env=off`, or from code with
`setDreamEnvEnabled()`. Like GI, the gate is read at material-construction time — a
material compiled without the env term can never gain it, so toggling only affects
materials built afterwards.

> **Why `envMap`, not `envNode`.** r171's `EnvironmentNode.setup()` only reads
> `envMapIntensity` when `material.envMap` is truthy, falling back to
> `scene.environmentIntensity` otherwise. Routing through `envNode` would silently make
> the intensity knob a no-op.

The same texture backs [`mirrors.ts`](../src/foliage/mirrors.ts) (sampled with explicit
UVs), so mirrors and candy highlights demonstrably reflect one sky.

### `subsurface*` — wrapped translucency, _not_ SSS

Named honestly: there is **no diffusion profile and no multi-bounce** here. True
subsurface scattering wants a screen-space blur pass this project has no budget for.
What ships is a wrap term plus a Frostbite-style back-scatter lobe, thickness-extinguished:

| Knob                         | Default | Visual Impact                                                                    |
| ---------------------------- | ------- | -------------------------------------------------------------------------------- |
| `subsurfaceStrength`         | `0`     | Master gain. `0` compiles the whole term out                                     |
| `subsurfaceWrap`             | `0.5`   | How far light wraps past the terminator. `0` = plain Lambert, ~0.6 = gummy       |
| `subsurfaceDistortion`       | `0.2`   | Bends the exit vector along N. Higher = softer; `0` reads as a hard specular dot |
| `subsurfacePower`            | `3.0`   | Lobe tightness. Higher = a thin candied rim only                                 |
| `subsurfaceThicknessFalloff` | `0.35`  | Per-unit extinction. Uses the same thickness node as transmission, so            |
|                              |         | `thicknessDistortion` makes a lumpy gummy glow through its thin spots            |
| `subsurfaceAlbedoTint`       | `0.5`   | Pulls the scatter colour toward albedo. **This is the pastel guard** — at `0` a  |
|                              |         | saturated `subsurfaceColor` pushes the term to white                             |

The term is added to **albedo, not emissive**, on purpose: it stays under the lighting and
the GI multiply, so it tints the candy rather than blooming it out.

### `attenuationColor` / `attenuationDistance`

Real Beer-Lambert volume tint for `transmission`, via r171's `materialAttenuationColor` /
`materialAttenuationDistance` — plain properties, zero extra shader instructions.

Setting `attenuationColor` **replaces** the legacy albedo-darkening fudge
(`exp(-thickness × 0.5) + 0.2`) that every transmissive preset has been tuned against.
Leave it unset to keep the shipped look; set it when you want physically-shaped
absorption and are ready to retune.

---

## Sun shadows (Cascaded Shadow Maps)

Candy World wants **soft contact shadows**, not razor silhouettes — shadows that
ground a mushroom on the terrain without carving hard edges across a glossy
clearcoat. All knobs live under `CONFIG.lighting.shadows`
(`src/core/config/defaults.ts`); the tier is chosen by
`resolveShadowSettings()` from `StartupCapabilities`, never from raw graphics.

| Knob                                | Default            | Visual Impact                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cascadesEnabled`                   | `true`             | `false` restores the single player-following ortho map                                                                                                                                                                                             |
| `cascadeCount` / `cascadeCountHigh` | `2` / `3`          | Cascades at default / high tier. Clamped 2–4                                                                                                                                                                                                       |
| `cascadeMode`                       | `practical`        | Split scheme. `uniform` wastes near texels; `logarithmic` starves the far cascade                                                                                                                                                                  |
| `cascadeMaxFar`                     | `160`              | How far cascades reach, in world units. Tracks the fog far plane — raising it spreads the same texels thinner                                                                                                                                      |
| `cascadeMapSizeTaper`               | `true`             | Halves the map for each farther cascade (2048/1024/512). Near sharpness is unchanged; roughly halves shadow VRAM                                                                                                                                   |
| `cascadeMapSizeMin`                 | `512`              | Floor for tapered far cascades                                                                                                                                                                                                                     |
| `cascadeFade`                       | `true`             | Cross-fades cascade seams. Off = visible resolution step lines                                                                                                                                                                                     |
| `cascadeLightMargin`                | `120`              | Pullback along the sun direction. Too low clips tall casters (sky islands) out of their cascade                                                                                                                                                    |
| `bias` / `normalBias`               | `-0.0005` / `0.02` | **Acne control on glossy `MeshPhysicalMaterial`.** Pair with `CandyPresets.Gummy` / `Crystal` (transmission + low roughness). CSM scales `bias` per cascade (× cascade index). If softness > ~0.8 speckles, raise `normalBias` toward `0.03` first |
| `softness`                          | `0.6`              | Visual Impact: 0–1 candy contact. Live via `setShadowSoftness` / `?debug=1` slider / `?shadowSoft=` — **does not recode** the TSL graph                                                                                                            |
| `pcfRadius`                         | `4`                | Texel radius at `softness = 1`. r171 `PCFSoftShadowMap` ignored this; we attach a 3×3 / 5×5 `shadow.filterNode` that actually reads `shadow.radius`                                                                                                |
| `pcssEnabled` / `pcssLightSize`     | `false` / `0.4`    | Cheap edge-aware contact (high tier). Not production blocker-search PCSS. `?pcss=1`                                                                                                                                                                |

Tier mapping: `low` graphics / `forceDisable` / CI → no shadow pass at all;
default (`shadows.resolution = low`) → **3×3 PCF** (13 compares / cascade);
high → **5×5** (29 compares / cascade) and optional PCSS. See
[`docs/SHADOW_SOFTNESS.md`](./SHADOW_SOFTNESS.md).

Debug with `?debug=1` (softness slider + cascade overlay) or `?csm=debug` for
frusta only. CSM is WebGPU-only — see `docs/webgl-fallback.md`.

---

## Local point / spot lights

The hemisphere + sun pair is the lighting model. Extra **point** and **spot**
lights are pastel fills registered through `src/rendering/lights.ts` so quality
tiers, the shadow budget, and a future clustered cull share one list.

| Knob                             | Default               | Visual Impact                                               |
| -------------------------------- | --------------------- | ----------------------------------------------------------- |
| `pointColor` / `spotColor`       | `#7fe8ff` / `#ffb3d9` | Candy cyan fill and pink cone — never a harsh white bulb    |
| `pointDecay` / `spotDecay`       | `2`                   | Inverse-square falloff                                      |
| `pointDistance` / `spotDistance` | `14` / `16`           | Cutoff in world units                                       |
| `spotAngle` / `spotPenumbra`     | `π/5` / `0.5`         | Soft mushroom-cap cone                                      |
| `maxLocalShadowLights`           | `1`                   | Extra maps on top of the sun. `0` = illumination only       |
| `disableOnLow`                   | `true`                | Skip extra maps on `low` / CI. WebGL stays directional-only |

API: `createPointLight`, `createSpotLight`, `registerDecorativeFill`.
Generation loops must **not** `new THREE.PointLight`. Flower heads and orbs
register decorative descriptors only. See `docs/LOCAL_LIGHTS.md`.

---

## Lightweight GI (irradiance probes)

Candy World does **not** run SSGI, RSM, or a second GI technique. Indirect light
is one player-following SH-L1 probe volume — pastel leak, not grey dirt.

The term is added on unified materials as `irradiance × albedo` (`emissiveNode`).
Albedo is never desaturated. Interiors get an icy cave fill instead of black.

| Tier               | Behaviour                                           |
| ------------------ | --------------------------------------------------- |
| `low` / CI / WebGL | Volume never allocated — shader is the pre-GI graph |
| `medium`           | 10×5×10, 10u cells, 24 probes/frame                 |
| `high`             | 14×7×14, 8u cells, 40 probes/frame                  |

Toggle: `?gi=off` (compile-out) or `setIrradianceEnabled(false)` / debug-panel **GI off**.
Staging viewpoint: `sugar_caves` in `tools/visual-regression/viewpoints.json`.
Full write-up: [`docs/IRRADIANCE_PROBES.md`](./IRRADIANCE_PROBES.md).

---

## Appendix: preset coverage guard

`npm run test:cookbook-presets` greps `CandyPresets.<Name>` usage under `src/foliage/`
and fails if a preset is missing from this doc's preset table — lightweight drift protection
until JSDoc `@example` migration lands.
