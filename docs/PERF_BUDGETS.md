# Batcher Performance Budgets

Candy World now tracks foliage batcher pressure with both build-time budgets and runtime telemetry.

## Build-time budget report

Use:

```bash
npm run budget:batchers
```

This reads `assets/map.json`, maps entity types to batchers, and reports:

- map instance count per batcher
- budgeted max instances
- utilization status (pass/warn/error)
- estimated VRAM footprint

Config lives in:

- `tools/build-optimizer/batcher-budgets.json`
- Script: `tools/build-optimizer/src/batcher-budget.ts`

## Runtime telemetry

When running with `?debug=1`, the debug panel now shows a live **Batcher Stats** section:

- total active instances / capacity
- draw-call estimate
- estimated VRAM
- top 5 most-populated batchers

Telemetry source: `src/foliage/batcher-telemetry.ts`

## Cross-batcher consolidation landed

Glowing flower placement now routes through `SimpleFlowerBatcher` instead of a separate glowing-only registration path, reducing active batcher/shader variant pressure in dense flower maps while preserving the glowing beam behavior (`forceBeam` path).

## Map-driven preallocation

`metadata.expectedInstanceCounts` can now be authored in map JSON and is exposed via `LoadedCandyMap.getExpectedInstanceCounts()`.

Generation currently uses this hint to pre-size `TreeBatcher` capacity before initialization, preventing dynamic growth spikes during startup streaming.
