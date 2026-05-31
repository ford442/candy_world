# MAP System V2

Candy World now uses a loader-driven map contract where map JSON is the source of truth for world placement. Runtime generation consumes map data through `src/world/map-loader.ts`.

## Goals

- Swappable maps via query string (`?map=assets/my-map.json`)
- Backward compatibility for existing v1 maps
- Human-authorable schema with clear transform + metadata fields
- Queryable entities for systems (biome, culling, gameplay regions)

## Runtime Surface

`src/world/map-loader.ts` exports:

- `loadMap(source: string | CandyMapData): Promise<LoadedCandyMap>`
- `getMapSourceFromUrl(defaultSource?: string): string`
- `setupMapHotReload(source, onReload)` (dev/HMR cache invalidation)

`LoadedCandyMap` includes:

- `entities` (normalized runtime entities)
- `getEntitiesByType(type)`
- `getEntitiesByBiome(biome)`
- `getEntitiesInBounds({ minX, minZ, maxX, maxZ, minY?, maxY? })`
- `getNearestEntities({ origin, radius, limit, priorityTypes, excludeIds, out })`
- `streamEntitiesNear(origin, maxRadius, priorityTypes, { ringSize, chunkSize, excludeIds })`

### Startup Streaming Query Example

```ts
const nearest = loadedMap.getNearestEntities({
  origin: [0, 0, 0],
  radius: 80,
  limit: 300,
  priorityTypes: ['cave', 'subwoofer_lotus', 'instrument_shrine'],
  out: reusableArray
});
```

## Schema (v2)

```json
{
  "metadata": {
    "version": "2.0",
    "seed": 12345,
    "biomes": ["meadow", "forest", "lake"],
    "bounds": { "min": [-150, -150], "max": [150, 150] },
    "expectedInstanceCounts": {
      "flower": 420,
      "mushroom": 280,
      "tree": 120
    }
  },
  "entities": [
    {
      "id": "mushroom_0",
      "type": "mushroom",
      "position": [12.5, 1.2, -8.0],
      "rotation": { "euler": [0, 2.356, 0], "order": "YXZ" },
      "scale": 1.1,
      "variant": "regular",
      "category": "face-mushrooms",
      "layer": "ground",
      "biome": "meadow",
      "params": { "hasFace": true }
    }
  ],
  "regions": [
    {
      "id": "grove-a",
      "name": "Arpeggio Grove",
      "bounds": { "min": [-90, 40], "max": [-30, 85] },
      "biome": "arpeggio_grove",
      "tags": ["poi", "music"]
    }
  ],
  "paths": [],
  "pois": []
}
```

## Entity Fields

- `type` (required): canonical type key (snake_case preferred)
- `position` (required): `[x, y, z]`
- `rotation` (optional): number (legacy yaw), `euler`, or `quat`
- `scale` (optional): number or `[x, y, z]`
- `variant` / `params` (optional): type-specific configuration
- `category`, `layer`, `biome` (optional): authoring/system grouping
- `music` (optional): `{ biome?, biomeTag?, biomeOverride?, channels?, intensityScale?, trackerChannel?, reactivityProfile?, noteColorOverride? }`
- `placement` (optional): `ground` (default), `absolute`, or `offset`
- `critical`, `isObstacle` (optional): startup and collision hints
- `metadata.expectedInstanceCounts` (optional): per-type preload hints for batcher capacity planning (`type -> integer`)

Map-level music personality can also be authored with `music` at root and `region.music` hints. See `docs/MUSIC_MAP_BINDING.md`.

## Compatibility

- v1 maps remain supported.
- Loader normalizes legacy aliases (camelCase → snake_case).
- Legacy rotation numbers are normalized to Y-axis Euler rotation.
- Legacy set-pieces are emitted as map entities for v1 data when missing.

## Minimal Beautiful Map Snippet

```json
{
  "metadata": { "version": "2.0" },
  "entities": [
    { "id": "lotus", "type": "subwoofer_lotus", "position": [-60, 0, 60], "scale": 1.5, "biome": "arpeggio_grove" },
    { "id": "fern1", "type": "arpeggio_fern", "position": [-54, 0, 60], "scale": 1.1, "music": { "biomeTag": "arpeggio_grove" } },
    { "id": "cloud1", "type": "cloud", "position": [22, 18, -14], "params": { "size": 1.7 }, "layer": "sky", "placement": "absolute" }
  ]
}
```
