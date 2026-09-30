# Objective
Fix the remaining chunk streaming memory leaks by implementing eviction paths for all batched species, and write a test to guard it.

# Steps
1. In `src/world/generation-utils.ts`, edit `WeatherSystem` interface to add `unregisterCave(obj: THREE.Object3D): void;`. In `src/systems/weather/weather.ts`, implement `unregisterCave(cave: any): void` to remove it from `this.trackedCaves`.
2. In `src/world/chunk-streamer.ts`, change `this.weatherSystem?.registerCave?.(obj);` to `this.weatherSystem?.unregisterCave?.(obj);` at line 594.
3. Keep `tests/stream-evict.test.mjs` as we wrote it earlier using tsx to explicitly test the eviction paths on the batchers, verifying memory leaks are indeed fixed in `classifyForEviction` mappings since we verified they're already listed correctly.
4. Run `npm run typecheck` and `npm run test` to verify changes.
5. In `weekly_plan.md`, add "Status: Implemented ✅" with a short detail to the `ChunkStreamer` `#1755` issue.
6. Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.
7. Call submit to finalize.
