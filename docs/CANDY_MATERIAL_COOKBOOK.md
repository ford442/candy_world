# Candy Material Cookbook (v2)

Recipes for Candy World's glossy, music-reactive surfaces. **Reuse a `CandyPresets.*`
factory or copy a shipping batcher** before hand-rolling a material.

| Canonical source | Path |
|------------------|------|
| Presets & TSL helpers | [`src/foliage/material-core.ts`](../src/foliage/material-core.ts) |
| Standard deformation chain | [`material-core.ts` → `applyStandardDeformation`](../src/foliage/material-core.ts) (≈ L818) |
| LOD batcher deformation | [`src/foliage/lod-nodes.ts`](../src/foliage/lod-nodes.ts) → `applyStandardDeformationWithLod` |
| Biome / music uniforms | [`src/systems/biome-uniforms.ts`](../src/systems/biome-uniforms.ts) |
| Per-frame binding update | [`src/systems/music-reactivity.ts`](../src/systems/music-reactivity.ts) |
| Music map overrides | [`docs/MUSIC_MAP_BINDING.md`](./MUSIC_MAP_BINDING.md) |
| Binding conventions (authoritative) | [`AGENTS.md`](../AGENTS.md) → "Music Reactivity & Biome / Channel-to-Shader Binding Conventions" |
| Palette & note colors | [`src/core/config.ts`](../src/core/config.ts) (`PALETTE`, `noteColorMap`) |

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

Defined in [`material-core.ts`](../src/foliage/material-core.ts) (≈ L633–711).
Each takes `(hex, opts?)` → `MeshStandardNodeMaterial`; spread `opts` to override.

| Preset | Feel | Key opts | Used in |
|--------|------|----------|---------|
| `Clay` | Matte, tactile ground | roughness 0.8, bump, rim 0.3 | terrain, trunks, stems — [`foliage-materials.ts`](../src/foliage/foliage-materials.ts) |
| `Sugar` | Frosted crust, micro-bumps | sheen 1.0, noiseScale 60 | snow, rose caps — [`tree-batcher.ts`](../src/foliage/tree-batcher.ts) |
| `Gummy` | Translucent, inner glow | transmission 0.9, ior 1.4, SSS | fruit, canopies — [`berries.ts`](../src/foliage/berries.ts) |
| `SeaJelly` | Wet, wobbly, very translucent | transmission 0.95, ior 1.33, `animateMoisture` | water, waterfalls — [`water.ts`](../src/foliage/water.ts), [`waterfall-batcher.ts`](../src/foliage/waterfall-batcher.ts) |
| `Crystal` | Refractive gem / glass | transmission 1.0, ior 2.0, iridescence | gems, glass mycelium — [`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts) |
| `Velvet` | Soft sheen, no specular | roughness 1.0, colored sheen | petals — [`simple-flower-batcher.ts`](../src/foliage/simple-flower-batcher.ts) |
| `OilSlick` | Dark base, rainbow edges | metalness 0.8, iridescence 1.0 | rare accents — [`foliage-materials.ts`](../src/foliage/foliage-materials.ts) `mushroomPalette` |

```ts
import { CandyPresets } from '../foliage/material-core.ts';

const cap    = CandyPresets.Gummy(0xFF69B4);
const water  = CandyPresets.SeaJelly(0x44AAFF);
const gem    = CandyPresets.Crystal(0xE0115F, { side: THREE.DoubleSide });
const ground = CandyPresets.Clay(0xBFA76F);
const slick  = CandyPresets.OilSlick();
```

---

## Recipe table (music-reactive surfaces)

| Recipe | Preset / approach | Music hook | Live example |
|--------|-------------------|------------|--------------|
| Glossy mushroom cap | clearcoat + rim | `getBiomeUniforms('crystalline_nebula').noteColor` | [`mushroom-batcher.ts`](../src/foliage/mushroom-batcher.ts) |
| Crystal gem corridor | `CandyPresets.Crystal` + rim | `getBiomeUniforms('gem_canopy')` + `gemCanopyNoteColorNode` | [`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts) |
| Glass mycelium | `Crystal` + vein emissive | `LuminousPlantUniforms.intensity` + `uAudioLow` | [`glass-mushroom-batcher.ts`](../src/foliage/glass-mushroom-batcher.ts) |
| Luminous plant glow | stem TSL + circadian | `luminousPlantsNoteColorNode` (LUT) + `uCircadianPhase` | [`luminous-plant-batcher.ts`](../src/foliage/luminous-plant-batcher.ts) |
| Twilight emissive (any) | preset emissive × `uTwilight` | circadian gate | most `*-batcher.ts` under `src/foliage/` |

Full channel→uniform mapping: [`assets/music-bindings.json`](../assets/music-bindings.json)
and [`MUSIC_MAP_BINDING.md`](./MUSIC_MAP_BINDING.md).

---

## TSL patterns (link, don't duplicate)

Import surface — see [`material-core.ts` exports](../src/foliage/material-core.ts):

```ts
import {
  CandyPresets, getCachedProceduralMaterial,
  createJuicyRimLight, createRimLight, createSugarSparkle,
  applyStandardDeformation,
  uTime, uAudioLow, uAudioHigh,
} from '../foliage/material-core.ts';
import { color, float, mix, positionLocal, attribute } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
```

### Juicy rim light

`createJuicyRimLight(baseColor, intensity, power, normalNode | null)` — see
[`material-core.ts`](../src/foliage/material-core.ts) ≈ L171. Reference usage:
[`gem-fruit-batcher.ts`](../src/foliage/gem-fruit-batcher.ts).

### Vertex deformation — one canonical order

**Source of truth:** [`applyStandardDeformation`](../src/foliage/material-core.ts) composes
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
See [`material-core.ts`](../src/foliage/material-core.ts). Inside the factory callback,
still use `applyStandardDeformation(positionLocal)` for displacement.

### Twilight / circadian glow

| Uniform | Export | Written by |
|---------|--------|------------|
| `uTwilight` | [`src/foliage/sky.ts`](../src/foliage/sky.ts) (`export const uTwilight`) | day/night cycle + music reactivity |
| `uCircadianPhase` | [`src/systems/biome-uniforms.ts`](../src/systems/biome-uniforms.ts) | 0 = night, 1 = day |

Verified import (batchers, weather, music-reactivity all use this path):

```ts
import { uTwilight } from '../foliage/sky.ts';           // from src/foliage/*
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

| Tag | Where | Purpose |
|-----|-------|---------|
| `// PALETTE:` / `// 🎨 PALETTE:` | `src/foliage/*` (dominant) | Aesthetic tuning in materials & batchers |
| `// Visual Impact:` | systems, newer batchers, `config.ts` | Cross-cutting visual constants |
| `// Music Impact:` | batchers + `music-reactivity.ts` | Channel / uniform tuning |

`grep -rn "PALETTE:" src/foliage/` for foliage examples;
`grep -rn "Visual Impact:" src/` for systems-level knobs. Convention detail: **AGENTS.md**.

---

## Core material foundations

- **MeshPhysicalNodeMaterial** (via presets): clearcoat + transmission for the candy look.
- **Clearcoat** high (0.8–1.0), **metalness** ~0 (except `OilSlick`), **roughness** low–mid for gloss.
- **Transmission** for gummy / jelly / crystal / glass reads.

---

## Appendix: preset coverage guard

`npm run test:cookbook-presets` greps `CandyPresets.<Name>` usage under `src/foliage/`
and fails if a preset is missing from this doc's preset table — lightweight drift protection
until JSDoc `@example` migration lands.
