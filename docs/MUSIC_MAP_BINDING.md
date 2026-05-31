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

