# Music Map Binding

Map data can layer music personality on top of `assets/music-bindings.json` defaults
without code edits. For material / TSL conventions when wiring new reactive foliage,
see **[`CANDY_MATERIAL_COOKBOOK.md`](./CANDY_MATERIAL_COOKBOOK.md)** and
**[`AGENTS.md`](../AGENTS.md)** (music-binding section).

## Override Precedence

`entity.music` > `region.music` > `map.music` > `assets/music-bindings.json`

Defaults always remain valid fallback.

## Map-Level Overrides

```json
{
  "music": {
    "profile": "dream-meadow",
    "biomes": {
      "arpeggio_grove": {
        "shimmer": [3, 4],
        "hueShift": [5],
        "noteColor": [7],
        "intensityScale": 1.25
      },
      "global": {
        "noteColor": [6],
        "intensityScale": 0.9
      }
    },
    "skyMoon": { "melodyChannel": 1 },
    "luminousPlants": { "trackerChannel": 4, "baseIntensity": 1.2 },
    "skyWave": {
      "propagationMs": 700,
      "decayMs": 1800,
      "targetBiomes": ["arpeggio_grove", "musical_flora", "global"]
    },
    "weatherReactivity": {
      "rainIntensity": { "channel": 2, "smoothing": 0.2, "scale": 0.9 }
    }
  }
}
```

## Entity + Region Hints

```json
{
  "regions": [
    {
      "id": "meadow-center",
      "bounds": { "min": [-50, -50], "max": [50, 50] },
      "music": { "biomeTag": "musical_flora", "channels": [3, 7], "intensityScale": 1.1 }
    }
  ],
  "entities": [
    {
      "type": "arpeggio_fern",
      "position": [4, 0, 12],
      "music": {
        "biome": "arpeggio_grove",
        "channels": [3, 4],
        "intensityScale": 1.3,
        "reactivityProfile": "lush"
      }
    }
  ]
}
```

Entity and region hints are normalized by `MapLoader` and folded into runtime map music context on map load/hot-reload.

## Runtime Flow

1. `src/world/generation-core.ts` loads the map and derives map music context.
2. `src/world/map-music-context.ts` stores normalized overrides.
3. `src/systems/music-reactivity.ts` atomically reapplies bindings when context version changes.
4. `src/systems/atmosphere-reactivity.ts` maps audio energy to `uBloomStrength`, `uCrescendoFogDensity`, and shaft state (called from `MusicReactivitySystem.update()`).
5. Foliage/atmospheric batchers consume `BiomeUniforms` and reflect the new profile.

## Atmosphere Reactivity (`assets/music-bindings.json` → post-processing + sky)

Optional top-level `atmosphere` block (parallel to `weatherReactivity`). Drives bloom, candy-dream fog, and moonbeam/golden-hour god rays with zero per-frame allocations.

```json
{
  "atmosphere": {
    "bloom": {
      "channels": [0, 6],
      "rest": 1.0,
      "peak": 2.5,
      "smoothing": 8.0
    },
    "fogDensity": {
      "scale": 0.65,
      "max": 0.85,
      "smoothing": 6.0
    },
    "shaftMelody": {
      "peak": 0.35,
      "smoothing": 10.0
    },
    "beatPulse": {
      "bloomSpike": 0.45,
      "shaftShimmer": 0.12,
      "decay": 12.0
    }
  }
}
```

| Signal | Source | Target uniform |
|--------|--------|----------------|
| Kick / bass energy | `atmosphere.bloom.channels` (fallback: ch0 + `global.shimmer`) | `uBloomStrength` (rest → peak on crescendo) |
| Mix energy / avg volume | All tracker channels (smoothed) | `uCrescendoFogDensity` |
| Melody channel hits | `sky_moon.melody_channel` (via `MRState.skyMoonCh`) | `uShaftOpacity` + night shaft visibility |
| BeatSync downbeats | `atmosphere.beatPulse` | Brief bloom spike + shaft shimmer (smooth decay) |

Map-level overrides: add `"atmosphere": { ... }` under `music` in map JSON (same precedence as other music overrides).

**Ownership:** `atmosphere-reactivity.ts` is the sole writer of `uBloomStrength` and `uCrescendoFogDensity`. `weather-atmosphere.ts` reads fog density for visibility; `game-loop.ts` must not overwrite bloom before render.

WebGL parity: `post-processing.ts` syncs `uBloomStrength.value` to `UnrealBloomPass.strength` each frame; `game-loop.ts` mirrors `uShaftOpacity` to the shared WebGL shaft material.

## Gem Canopy Binding (`gem_canopy`)

The Gem Canopy corridor is placed procedurally by `src/world/generation-decorators.ts` (`populateGemCanopyCorridor`). It is **not** authored in `assets/map.json`; the primary placement mechanism is the procedural decorator so the tree-lined jewel path can recede into fog with consistent density.

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
    "target_biomes": ["arpeggio_grove", "crystalline_nebula", "luminous_plants", "sky_moon", "global", "gem_canopy"]
  }
}
```

| Signal | Source | Target uniform | Visual effect |
|--------|--------|----------------|---------------|
| Melody / chord shimmer | `gem_canopy.shimmer` | `BiomeUniforms.gemCanopy.shimmer` | Gems brighten and bloom; emissive pulse intensifies |
| Note-hit twist driver | `gem_canopy.hueShift` | `BiomeUniforms.gemCanopy.hueShift` | Subtle pendulum twist on melody notes |
| Note color | `gem_canopy.noteColor` | `BiomeUniforms.gemCanopy.noteColor` | Ruby / sapphire / amethyst tints shift toward the active tracker note |
| Sky wave cascade | `sky_wave.target_biomes` includes `gem_canopy` | `BiomeUniforms.gemCanopy.noteColor` | Moon melody hue travels down to the corridor on the beat |

Batcher implementation: `src/foliage/gem-fruit-batcher.ts` creates one `InstancedMesh` per jewel type (ruby, sapphire, amethyst) → three draw calls total. Each mesh uses `CandyPresets.Crystal` for the candy-glass clearcoat look, with `calculateWindSway` pendulum motion and a `gemCanopyNoteColorNode` tint in the TSL graph. Resolve uniforms via `getBiomeUniforms('gem_canopy')` — see the [Material Cookbook](./CANDY_MATERIAL_COOKBOOK.md). `GemFruitBatcher.attachToTree` is also used for corridor accent portamento/bubble-willow trees so the jewel motif stays consistent.

Map export: `gem_canopy_tree` is in `SUPPORTED_EXPORT_TYPES` with `category: 'mushroom-trees'` and `biome: 'gem_canopy'`. Spawn tracker records attempts as type `gem_canopy_tree`, and batcher telemetry reports the instanced gem count under id `gem_canopy`.

## Generative Music Mode (`src/audio/generative/`)

Optional in-browser soundtrack synthesized via Web Audio (oscillator + envelope nodes). When active, **reactivity is driven directly from the sequencer** — channel volumes, note names, and beat phase are known at note-on time (no FFT/VU guessing).

### Enable

| Toggle | Value |
|--------|-------|
| URL | `?generative=1` or `?music=generative` |
| `CONFIG.audio.musicMode` | `'generative'` \| `'tracker'` \| `'auto'` |
| localStorage | `candy.musicMode` = `generative` \| `tracker` |

Tracker upload (jukebox `.mod/.xm/.it/.s3m`) always takes precedence: loading a module switches back to libopenmpt playback.

### Biome → Musical Profile

Profiles live in `src/audio/generative/biome-profiles.ts` (parallel to `music-bindings.json` biome keys). Each profile defines root, scale, tempo, night tempo scale, brightness, groove, and per-channel density (8 tracker channels).

Runtime flow:

1. `game-loop.ts` reads player XZ → `getBiomeAtPosition()` → `AudioSystem.setGenerativeBiome()`.
2. Profiles crossfade over ~1 s as the player crosses region bounds.
3. `getDayNightBias(cyclePos)` modulates tempo via `setGenerativeDayNight()`.
4. `GenerativeEngine.update()` writes `visualState.channelData` → `MusicReactivitySystem.update()` (same path as tracker modules).

Channel roles match `assets/music-bindings.json` (ch0 kick/bass, ch2 melody/sky_moon, ch3–4 arpeggio_grove, etc.).

### Payload

Generative mode adds ~8–12 KB gzip to the `audio` chunk (no `.mod`/`.mp3` download required for ambient play). Run `npm run analyze:bundle` to compare with static asset folders under `public/`.

