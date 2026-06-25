# Gem Canopy Biome — Finish & Ship (#1170)

**Status:** Landed  
**Issue:** #1170  
**Affected systems:** foliage batching, procedural world generation, music reactivity, WebGL/WebGPU rendering.

## What shipped

A signature scenic biome: a tree-lined corridor of **bubble-willow trees** with hanging faceted crystal gem fruits that sway and pulse to tracker music. The corridor is placed procedurally so it recedes into fog with consistent density.

### Placement

- `src/world/generation-decorators.ts` → `populateGemCanopyCorridor()` places **24 `gem_canopy_tree` instances** along the path from `(75, -115)` to `(125, -45)`, alternating sides.
- 6 additional accent trees (portamento/bubble-willow) receive hanging gems via `GemFruitBatcher.attachToTree()` to keep the jewel motif consistent.
- Trees are not authored in `assets/map.json`; the decorator is the primary placement mechanism.

### Visual recipe

- `src/foliage/gem-canopy-tree.ts` creates a bubble-willow silhouette and delegates trunk/leaf batching to `treeBatcher`.
- `src/foliage/gem-fruit-batcher.ts` creates **one `InstancedMesh` per jewel type** (ruby, sapphire, amethyst) → **3 draw calls total**.
- Each gem uses `CandyPresets.Crystal` for a candy-glass clearcoat look:
  - `emissiveIntensity: 0.75` inner glow
  - `rimStrength: 1.4` / `rimPower: 3.0` fairy-light rim
  - `side: THREE.DoubleSide`
- Gems dangle from branch arcs with pendulum sway (`calculateWindSway`) plus a note-hit twist driven by `BiomeUniforms.gemCanopy.hueShift`.

### Music reactivity

Bindings defined in `assets/music-bindings.json`:

```json
{
  "biomes": {
    "gem_canopy": {
      "shimmer": [1, 2],
      "hueShift": [3],
      "noteColor": [1]
    }
  },
  "sky_wave": {
    "target_biomes": [..., "gem_canopy"]
  }
}
```

| Signal | Source | Target uniform | Visual effect |
|--------|--------|----------------|---------------|
| Melody / chord shimmer | `gem_canopy.shimmer` | `BiomeUniforms.gemCanopy.shimmer` | Gems brighten and bloom; emissive pulse intensifies |
| Note-hit twist driver | `gem_canopy.hueShift` | `BiomeUniforms.gemCanopy.hueShift` | Subtle pendulum twist on melody notes |
| Note color | `gem_canopy.noteColor` | `BiomeUniforms.gemCanopy.noteColor` | Ruby / sapphire / amethyst tints shift toward the active tracker note |
| Sky wave cascade | `sky_wave.target_biomes` includes `gem_canopy` | `BiomeUniforms.gemCanopy.noteColor` | Moon melody hue travels down to the corridor on the beat |

Jewel-tone note color map added to `src/core/config.ts` under `noteColorMap.gem_canopy`.

### Capacity tuning

`MAX_GEMS_PER_TYPE = getCIAdjustedCount(512, 0.1, 80)`:

- Full browsers: **512 gems per type** (~1,536 total gems) — covers 24 corridor trees + accent trees.
- CI/headless: **80 gems per type** — covers the CI-scaled population (24 trees × ~3 gems/type) with no overflow warnings.

The shared icosahedron geometry is **cloned per InstancedMesh** so each jewel type owns its `aPhase` / `aArmLen` attribute storage without increasing draw calls.

## Build & test verification

| Command | Result |
|---------|--------|
| `npm run build:ci` | ✅ pass |
| `npm run test:wasm` | ✅ pass |
| `npm run test` (CORE smoke) | ✅ pass |
| `FULL_BOOT=fast npm run test` | ✅ pass — 24 gem_canopy_trees, 2322/2322 objects, zero GemFruitBatcher capacity warnings |
| `RENDERER=webgl npm run test` | ✅ pass — WebGL fallback boots cleanly |

## Files changed

- `src/foliage/gem-fruit-batcher.ts`
- `src/foliage/gem-canopy-tree.ts`
- `src/world/generation-decorators.ts`
- `assets/music-bindings.json`
- `src/core/config.ts`
- `docs/MUSIC_MAP_BINDING.md`
- `src/utils/startup-profiler.ts` (unrelated duplicate-export build blocker fix)
- `src/utils/wasm-loader-cpp.ts` (unrelated duplicate-export build blocker fix)

## Notes

- CI/headless runs with `?safe=1`; shader warmup and compute are disabled (expected).
- Optional Emscripten native module is not installed in this environment; JS fallbacks remain active (expected).
- Full WebGPU shader validation requires a real GPU; deferred to manual/GPU testing.
