# Music Map Binding

Map data can now layer music personality on top of `assets/music-bindings.json` defaults without code edits.

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
4. Foliage/atmospheric batchers consume `BiomeUniforms` and reflect the new profile.

## Atmosphere Reactivity (Bloom, Fog, Light Shafts)

The optional top-level `atmosphere` block in `assets/music-bindings.json` drives
post-processing and sky uniforms from audio analysis (`src/systems/atmosphere-reactivity.ts`,
called once per frame from `MusicReactivitySystem.update()`). It is global config only —
not currently exposed as a per-map `music` override.

```json
{
  "atmosphere": {
    "bloom": {
      "channels": [0, 1],
      "restStrength": 1.0,
      "maxStrength": 2.5,
      "smoothing": 4.0
    },
    "fog": {
      "boostScale": 0.7,
      "smoothing": 3.0
    },
    "shafts": {
      "restOpacity": 0.0,
      "maxOpacity": 0.35,
      "smoothing": 2.5,
      "activateThreshold": 0.15
    },
    "beatPulse": {
      "threshold": 0.5,
      "bloomSpike": 0.6,
      "shaftShimmerSpike": 0.25,
      "decayRate": 4.0
    }
  }
}
```

| Source | Target uniform | Behavior |
| --- | --- | --- |
| `bloom.channels` average volume + `kickTrigger` | `uBloomStrength` (`src/foliage/post-processing.ts`) | Lerps from `restStrength` (~1.0) toward `maxStrength` (~2.5) on kick/bass energy, smoothed by `bloom.smoothing`. |
| Average volume across all channels | `uCrescendoFogDensity` (`src/foliage/sky.ts`) | Enhances (never decreases) the existing weather-driven crescendo lerp; target = `averageVolume * fog.boostScale`, smoothed by `fog.smoothing`. |
| `SkyUniforms.intensity` (sky/moon melody channel, night-gated) | `uShaftOpacity` (`src/core/init.ts`) | At night, lerps from `shafts.restOpacity` toward `shafts.maxOpacity` based on melody intensity, smoothed by `shafts.smoothing`. Crossing `shafts.activateThreshold` makes moonbeam god rays visible (`src/core/game-loop.ts`). |
| `BeatSync` strong downbeats (`kickTrigger >= beatPulse.threshold`) | `uBloomStrength` + `uShaftOpacity` | Adds a decaying spike (`beatPulse.bloomSpike` / `beatPulse.shaftShimmerSpike`) on top of the targets above, decaying at `beatPulse.decayRate`. |

All fields are optional and fall back to the defaults shown above if the `atmosphere`
block (or any individual field) is omitted. Sunrise/sunset god rays remain owned by
`game-loop.ts`; near the day/night boundary it takes priority for `uShaftOpacity` for
that frame so the two systems never fight over the same uniform.

