# Subterranean Sugar Caves Biome — Finish & Ship (#1492)

**Status:** Landed (2026-08-12)
**Epic:** #1492 (Capstone epic — Presence + Part II door)
**Affected systems:** foliage batching, procedural world generation, music reactivity, traversal, WebGPU TSL rendering.

## What shipped

A signature subterranean biome layer: the **Subterranean Sugar Caves** — the vertical complement to Sky Islands (up → down) and the **Part II door** from the capstone epic.

### Placement

- `src/world/generation-decorators.ts` → `populateSugarCaves()` procedurally places crystal ribs beneath terrain.
- Bounds via `SUGAR_CAVES` in `src/world/generation-utils.ts`.
- `assets/map.json` region `sugar_caves` for biome-at-position / presence cues.

### Traversal + Part II unlock

- `src/world/sugar-caves-traversal.ts` — lake descent platforms + walkable cave floor.
- `src/world/part-ii-unlock.ts` — awakened-flora threshold unlocks the descent narrative.
- `tests/sugar-caves-traversal.test.mjs` — unlock + viewpoint regression.

### Visual recipe

- `src/foliage/sugar-cave-batcher.ts` — `SugarCaveBatcher` with TSL crystal cones + `BiomeUniforms.sugarCaves`.
- `src/systems/net/remote-avatars.ts` — candy dodecahedron silhouettes for co-presence peers.

### Music reactivity

Bindings in `assets/music-bindings.json`:

```json
{
  "biomes": {
    "sugar_caves": {
      "shimmer": [2, 3],
      "hueShift": [4],
      "noteColor": [2]
    }
  }
}
```

- `BiomeUniforms.sugarCaves` + accumulators in `music-reactivity.ts`
- `sky_wave.target_biomes` includes `sugar_caves`
- Generative profile `sugar_caves` in `src/audio/generative/biome-profiles.ts` (muffled-crystal mood)

### Tests / viewpoints

| Command | Result |
|---------|--------|
| `npm run test:sugar-caves` | unlock + viewpoint harness |
| `tools/visual-regression/viewpoints.json` | `sugar_caves` night viewpoint |

Color palette (`noteColorMap.sugar_caves`) in `src/core/config/defaults.ts` — icy cyan / magenta crystalline aesthetic.
