# Subterranean Sugar Caves Biome — Finish & Ship (#1492)

**Status:** Landed
**Epic:** #1492 (Capstone epic — Presence + Part II door)
**Affected systems:** foliage batching, procedural world generation, music reactivity, WebGPU TSL rendering.

## What shipped

A new signature subterranean biome layer: the **Subterranean Sugar Caves**. This represents the "Part II door" from the Capstone epic.
It features crystal rib structures beneath the main landscape, which react to music through newly mapped biome channels.

### Placement

- `src/world/generation-decorators.ts` → `populateSugarCaves()` procedurally places these structures deep beneath the standard terrain level.
- The cave density and bounds are controlled via `SUGAR_CAVES` config in `src/world/generation-utils.ts`.

### Visual recipe

- `src/foliage/sugar-cave-batcher.ts` creates the `SugarCaveBatcher` wrapping a single `InstancedMesh`.
- Utilizes `MeshStandardNodeMaterial` entirely constructed via TSL to satisfy the Zero-Allocation / WebGPU architectural constraints.
- Employs `createJuicyRimLight` and triplanar noise logic (similar to the legacy cave entrance features, but scaled up via InstancedMesh) mapped directly to `BiomeUniforms.sugarCaves`.

### Music reactivity

Bindings defined in `assets/music-bindings.json`:

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

The new `sugar_caves` biome is also explicitly registered in `sky_wave.target_biomes`, ensuring the Sky Wave cascade cascades down into the cave depths.

Color palette (`sugar_caves`) defined in `src/core/config/defaults.ts` uses icy / cyan / magenta palettes matching a crystalline bioluminescent aesthetic.
