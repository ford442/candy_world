# Sky Islands (#1363)

Stacked candy landmasses for vertical exploration — builds on unified ground sampling (#1265) and walkable clouds (#1266).

## Layers

| Layer | Y | Content |
|-------|---|---------|
| Approach stairs | ~8→28 | `CLOUD_ARCHIPELAGO` walkable cloud hops |
| Low mist | 18 | Cotton-candy island, cloud ring, panning lift pads |
| Mid canopy | 32 | Lilac sugar island, wisteria accents, gem canopy sapling |
| High nebula | 48 | Crystal island, glass mushrooms, silence spirits |

Constants: `SKY_ISLANDS` / `CLOUD_ARCHIPELAGO` in `src/world/generation-utils.ts`.

## Key files

- `src/foliage/sky-islands.ts` — `createSkyIsland` + GPU rim displacement (TSL) + `SkyIslandBatcher` registry
- `src/world/generation-decorators.ts` — `populateCloudArchipelago`, `populateSkyIslands`
- `src/world/sky-island-graph.ts` — connectivity graph + `?debugIslands=1`
- `src/systems/ground-system.ts` — `registerWalkableIslandPlatform`
- `src/systems/fauna/roosts.ts` — roost anchors for ambient fauna flocks
- `assets/music-bindings.json` — `biomes.sky_islands` + sky_wave target
- `assets/map.json` — `regions[]` entry `sky_islands`
- `tests/sky-islands-traversal.test.mjs` — multi-tier platform + reconcile + roost regression
- Visual regression viewpoint: `sky_island_horizon`

## Fauna roosts

Ambient fauna scatter samples random XZ across ~58k m², so it effectively never
lands on the island decks (a few hundred m² combined). `spawnFaunaPopulation`
therefore runs a **reserved roost pass first**, seating a flock on each
registered deck before the terrain scatter claims the remaining cap.

- Anchors come from the live `sky-islands` registry — no second source of truth
  for island positions. No islands registered (CORE mode, or
  `SKY_ISLANDS.enabled === false`) → zero roosts and a normal scatter.
- Y is resolved through `getGroundHeight`, i.e. the walkable-platform override,
  **not** the registry's cached deck Y. An anchor whose query disagrees with the
  registry by more than 2.5u is dropped — that gap means the platform never
  registered, and placing there would float or sink the critter (#1265 guard).
- Species mix is moth-heavy (`CONFIG.fauna.roosts.density`); flyers suit
  floating decks. Roost critters carry `biome: 'sky_islands'`, so they pick up
  `BiomeUniforms.skyIslands` music tinting like the rest of the biome.

Tuning lives in `CONFIG.fauna.roosts` (`enabled`, `perIsland`, `ringInset`,
`jitter`, `density`). Defaults seat 4 per deck — 12 of the 96-instance cap.
Gated by `FEATURE_FLAGS.fauna` / `CONFIG.fauna.enabled` like all fauna.

## Debug

- `?debugIslands=1` — draw graph edges (vine=green, cloud=cyan, pad=pink) and node markers
- `window.__skyIslandGraph` / `window.__skyIslandsReady` breadcrumbs

## Traversal test

```bash
pnpm run test:sky-islands
```
