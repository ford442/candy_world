# Festival Night Market — Ship Note (#1758)

**Status:** Landed (2026-09-23)
**Issue:** #1758 (content issue 5 of 5, after foundation #1752–#1756)
**Affected systems:** foliage batching, map setpieces + chunk streaming, entity snapshots / `?debugPlace`, music reactivity, discovery, local-light registry.

A **night-only circadian layer on the existing map** — not a Part II biome. Six candy lantern stalls line a short lane just south of the Play spawn. By day they are shuttered counters. After dusk the striped awnings unfurl, the paper lanterns light up, and the stalls hand out discovery stamps.

## Placement

- **Authored, not procedural.** Six `night_market_stall` entities in `assets/map.json` (ids `setpiece:night_market:stall:0…5`, layer `setpiece-night-market`), plus a `night_market` region `(-10,-62)→(17,-42)` for biome-at-position cues.
- The lane runs along `z = -52`. Stalls sit at `x = -4 / 3.5 / 11`, on `z = -47.5` facing south and `z = -56.5` facing north.
- Everything sits inside the Play spawn ring (chunks `0,-2` / `-1,-2`), so the market loads with the first chunk. `npm run generate:chunk-index` regenerates `assets/map-chunks.json`. Keep it Prettier-formatted.

## Visual recipe — `src/foliage/night-market-batcher.ts`

There are three `InstancedMesh`es (3 draw calls for the whole market) with a shared per-instance `aStallTint` (rgb + phase):

| Mesh    | Material                                                          | Night gate                                                                |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| frame   | `CandyPresets.Sugar` counter + posts (clearcoat 0.7), pastel tint | always visible; warm emissive spill × night factor                        |
| awning  | `CandyPresets.Sugar`, candy stripes (tint / cream) via TSL `uv`   | folds to an 18 % roll by day, unfurls + ripples at night                  |
| lantern | `MeshStandardNodeMaterial`, paper-warm + tint, juicy rim          | shrinks under the awning and goes dark by day; CPU-hidden at phase ≥ 0.98 |

- The night factor is `1 − smoothstep(0.25, 0.75, uCircadianPhase)`. The phase eases over `CONFIG.circadian.transitionSeconds`, so nothing pops.
- **Day path is cheap:** two opaque draws, and the lantern mesh is hidden by `nightMarketBatcher.update(phase)` (called from `game-loop-visuals.ts`, O(1)).
- **Lights:** one `registerDecorativeFill` descriptor per stall through `src/rendering/lights.ts`, released on eviction. There are no GPU `PointLight`s and no extra shadow maps, so `CONFIG.lighting.local.maxLocalShadowLights` is untouched.

## Streaming (#1755)

`NightMarketBatcher.removeInstance(proxy)` swap-removes the slot, which keeps `mesh.count` dense and releases the stall's decorative light. `ChunkStreamer.classifyForEviction` maps `night_market_stall → 'nightMarketStall'`. Walking out of range and back never grows instance count or VRAM. `test:night-market` runs 25 spawn/evict cycles through the real streamer.

## Authoring (#1756)

- `night_market_stall` is a registry type (`foliage-registry.ts`) and an exportable map type (`map-entity-record.ts`), so snapshots serialize it.
- **`?debugPlace` now places through `restoreEntity` → `processMapEntity`** instead of a bare `scene.add`. Every placed species gets a batcher slot, joins `animatedFoliage` (so saves write it), and stays evictable.
- Each placement is written to the dev sidecar (IndexedDB). On the next `?debugPlace` boot, `restoreDevPlacements()` waits for `__sceneReady` and re-applies them with `applyEntitySnapshots`. **A placed stall reappears on reload.**
- "Capture Snapshot" now reuses the placement's id, so it overwrites the sidecar record instead of adding a duplicate.

## Music reactivity

`assets/music-bindings.json`:

```json
"night_market": {
    "shimmer": [1, 6],
    "hueShift": [3],
    "noteColor": [6]
}
```

| Signal    | Target                                | Visual                                                 |
| --------- | ------------------------------------- | ------------------------------------------------------ |
| shimmer   | `BiomeUniforms.nightMarket.shimmer`   | lantern flare (emissive × 1 + 1.6·shimmer)             |
| hueShift  | `BiomeUniforms.nightMarket.hueShift`  | awning ripple amplitude + lantern swing                |
| noteColor | `BiomeUniforms.nightMarket.noteColor` | bulb tint (palette `CONFIG.noteColorMap.night_market`) |
| sky wave  | `sky_wave.target_biomes` (last)       | moon melody hue arrives at the market last             |

- **Hard night gate:** `marketGate = 1 − dayNightBias`, not the shared `0.2` floor, so daytime tracker energy never lights a shuttered stall.
- Shimmer releases (`max(target, prev × 0.9)`) rather than snapping, so a chord-strike flare eases out.
- Silent path: shimmer/hueShift are in `SILENT_DECAY_UNIFORMS`, and noteColor releases to white. There is no allocation: only `.value` is mutated.
- Generative profile `night_market` (F major, 96 bpm, `festival` mood) lives in `src/audio/generative/biome-profiles.ts`.

## Gameplay hooks — `src/systems/night-market-stamps.ts`

- **Discovery stamps:** walk within 4 m of a stall while the market is open (circadian phase < 0.5) to collect `night_market_stamp:<stall id>`. The first stamp also unlocks the `night_market` discovery. Checks are throttled to 4 Hz and allocate nothing.
- **Chord Strike:** firing it at night stamps every stall inside the beam radius, flares the lanterns, and calls `awakenedPersistence.tryAwakenNearby` for luminous plants / gem canopy trees. That feeds the same awakened-flora count the Part II door reads.
- **No new persistence store.** Stamps are ordinary discovery ids keyed by the stall's map / snapshot id.

## Tests / viewpoints

| Command                                   | Covers                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:night-market`               | map + chunk index freshness, spawn-ring placement, registration, swap-remove, 25× stream in/out, snapshot save → reload, night gate, stamps, chord strike, bindings night/day/silent |
| `tools/visual-regression/viewpoints.json` | `night_market` night viewpoint down the lantern lane (baseline needs a GPU capture)                                                                                                  |

`test:night-market` is part of `test:fast`.

## Candy aesthetic checklist

- [x] Pastel tints (strawberry, mint, butter, lilac, sky) and a cream stripe. No sodium-orange street light.
- [x] Sugar clearcoat on counters and awnings. The albedo is never desaturated; only the emissive warms at night.
- [x] No per-stall GPU lights, no extra shadow maps, no photoreal night-street tricks (no wet-asphalt SSR, no lens flares).
- [x] Glow comes from emissive + the existing dream bloom, driven by music.

## Out of scope (unchanged)

WebXR look-around, Weather Ecosystem v2, a WebGL market path, controller changes, and any new libraries. Rapier, bitecs and Howler were not added.
