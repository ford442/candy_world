# plan.md

Living task board for Candy World. **Primary source:** [`weekly_plan.md`](./weekly_plan.md) (today's focus, backlog, done log).

Use this file for short cross-cutting sequencing notes that span multiple weeks. Detailed issue tracking lives in GitHub (#1485–#1491 mechanical splits, #1497 hygiene, etc.).

## Current sequencing (2026-08-05)

1. **Foundation** — TS/ESint ratchet gate (#1493), repo hygiene (#1497).
2. **Perf / migration** — app-chunk peel (#1495), GPU foliage default (#1496). **Status: Implemented ✅**
   - * Implementation Details: Activated GPU foliage animation path by default via `gpu-foliage-flag.ts` and orchestrator modifications.
3. **Content** — capstone features (#1492, #1494) after gates are green.

    - **Status: Implemented ✅** (#1494 Generative music + Cinematic Photo Mode as first-class features)
n4. **Epic: Simplify startup to two load paths + chunk streaming** (#1546)
    - **Status: Implemented ✅** (#1547 Collapse startup profile UI + wire graphics to runtime)
    -   - Implementation Details: Replaced Graphics/Map Size UI selectors with Play and Explore buttons, updated start-screen to dynamically set map size, and wired config to derive graphics from the profile dynamically.

    -   - Implementation Details: Wired Generative Biome Audio and Day/Night context into the game loop using zero-allocation updates, allowing the generative audio engine to adapt dynamically to the player's current biome as they explore.
    - **Status: Implemented ✅** (#1492 Workstream A2: Candy Remote Avatar Mesh)
    -   - Implementation Details: Upgraded the placeholder presence avatar sphere to a low-poly dodecahedron using a TSL `MeshPhysicalNodeMaterial` with clearcoat, and wired up `instanceColor` zero-allocation updates to properly apply the hash-based pastel colors per instance.
    - **Status: Implemented ✅** (#1492 Workstream B: Subterranean Sugar Caves)
    -   - Implementation Details: Implemented the Subterranean Sugar Caves biome layer using a new InstancedMesh batcher (`SugarCaveBatcher`) and TSL materials for crystal ribs, and registered it with the music-bindings for the Part II Door narrative.

4. **Epic: Simplify startup to two load paths + chunk streaming** (#1546)
    - **Status: Implemented ✅** (#1547 Collapse startup profile UI + wire graphics to runtime)
    -   - Implementation Details: Replaced Graphics/Map Size UI selectors with Play and Explore buttons, updated start-screen to dynamically set map size, and wired config to derive graphics from the profile dynamically.


## Mega-module splits (do not split blindly)

Prefer domain barrels over mechanical 700-line cuts. Already landed:

- `src/core/config/` — domain modules + `config.ts` barrel
- `src/core/main/` — boot pipelines + thin `main.ts` orchestrator
- `game-loop.ts` + `game-loop-*.ts` — tick phase pattern to copy

Still ticketed for future PRs: `tree-batcher.ts`, `input.ts`, `material-core.ts`, `style.css`.
