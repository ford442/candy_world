# Play / Explore world footprint

Play no longer full-loads the ~400×400 visual world. The default path boots a compact mesh and streams the rest.

## Sizes

| Path | Visual terrain | Heightmap | Why |
|------|----------------|-----------|-----|
| **Play** (default) | **180×180 (±90)** | 128 | 150×150 (±75) clips Melody Lake’s east shore (~x=80) and the mycelium grove (~78,78). 180 stays in the 120–180 band. |
| **Explore** | 400×400 (±200) | 256 | Existing full-world mesh. |
| **CORE** | 120×120 | 64 | Sandbox (`?boot=core` / `?map=small`). |

Map JSON still spans ~±250. Distant entities are **not** deleted — they stream in.

## Streaming (extends #1548 `ChunkStreamer`)

- **Before control:** spawn tile + 1-ring (32 m chunks) is spawned synchronously (~84 entities on the current map; budget 96).
- **Prefetch:** load radius **80 m** (~50 m HIGH cell + one chunk) so the next section is ready before the player walks in.
- **Evict:** 150 m normally; **80 m** when JS heap usage ≥ 70%.
- **Setpieces** (gem canopy, sky islands, …) load when the player is within 100 m of their center. Sugar Caves + procedural extras in the Play envelope start right after the spawn ring (background, not blocking Enter).
- **Terrain expand:** when the player is within 40 m of the Play mesh edge, the Explore-sized ground generates in the background. Position is soft-clamped to the loaded mesh until that finishes.

## Telemetry

- `window.__playSpawnCount` — entities in the ready spawn ring
- `window.__streamingTelemetry` — spawned count, hitch/pop counters, load/evict rings
- `window.__startupCapabilities.world` — size / resolution / fog cap
- `pnpm run test:boot:timing` — Play TTI + spawn count + a synthetic walk

## Tests

```bash
pnpm run test:world-extent
pnpm run test:capabilities
pnpm run test:boot:timing   # needs dist/ (`pnpm run build:ci`)
```
