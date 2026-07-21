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
- `assets/music-bindings.json` — `biomes.sky_islands` + sky_wave target
- `assets/map.json` — `regions[]` entry `sky_islands`
- `tests/sky-islands-traversal.test.mjs` — multi-tier platform + reconcile regression
- Visual regression viewpoint: `sky_island_horizon`

## Debug

- `?debugIslands=1` — draw graph edges (vine=green, cloud=cyan, pad=pink) and node markers
- `window.__skyIslandGraph` / `window.__skyIslandsReady` breadcrumbs

## Traversal test

```bash
pnpm run test:sky-islands
```
