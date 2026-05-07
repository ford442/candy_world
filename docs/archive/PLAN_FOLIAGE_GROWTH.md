# Foliage Growth & Rain-Driven Spreading

- Feature: Allow plants (grass, flowers, mushrooms) to multiply and spread organically during or shortly after rain events.
- Behavior:
  - When `weather.isRaining == true`, increase a global `soilMoisture` counter.
  - Existing mature plants have a chance to spawn a new instance of themselves nearby.
  - Spawning probability is influenced by `soilMoisture`, audio beat (trigger spawn on strong downbeats), and local density (don't overpopulate).
- Visuals:
  - New plants scale up from 0 to 1 over a short duration (e.g., 1-3 seconds).
  - Optional: a small 'pop' or sparkle particle effect when a new plant appears.
- Parameters to expose in `CONFIG`:
  - `spawnRadius`, `spawnChanceBase`, `maxOffspring`, `growthWindowMs`, `densityLimit`.
  - Persist minimal state in `plant.userData` (`age`, `mature`, `lastSpawnTime`).
- Implementation notes:
  - Implement a `foliage.spawnNearby(parentPlant, species, options)` helper.
  - Use spatial partitioning (grid or quadtree) to efficiently query local density and nearby adults.
  - Include safeguards to avoid runaway exponential growth (global cap, density checks).
- Acceptance criteria:
  - After rain, foliage visibly expands into nearby empty areas following probabilistic rules and caps.
  - Growth is performant with many plants (use batching/instancing where possible).

Build & WASM migration notes
---------------------------

- Implementation workflow reminder: start with a TypeScript implementation so behavior is easy to iterate and test in `main.js`/`music-reactivity.js`.
- Move performance-critical or compute-heavy parts to `assembly/index.ts` (AssemblyScript) and compile with the project's AssemblyScript toolchain (see `npm run build:wasm` in the repo). This lets us run hot paths in asc-generated WASM.
- For additional performance or when integrating with existing native audio tooling, port or re-implement the same logic in C/C++ and place it under `src/audio` (the `emscripten/` folder in this repo contains examples). Use emscripten to produce C++-generated WASM and provide a small JS shim for the interface.
- Pay attention to data serialization across JS↔WASM boundaries (typed arrays, shared memory) and keep a small, well-defined API surface for tests.
