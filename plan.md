# Candy World Master Plan

## Recent Progress
- Migrated custom render passes and unmigrated `src/foliage/lake_features.ts` using TSL.
- Migrated `environment.ts`, `celestial-bodies.ts`, `moon.ts`, and `trees.ts` to use TSL.
- **Phase 4 Targets: impacts.ts**
  - **Status: Implemented ✅**
  - *Implementation Details: Migrated velocity, lifespan, sizing, and color processing from the CPU to a dedicated WebGPU compute shader using TSL (`Fn().compute()`). Replaced heavy JavaScript \`if/else\` structures and \`Math.random()\` generation with a newly integrated GPU-side \`hash()\` function utilizing \`modFloat\`.*

## Next Steps
- **Verify Data Flow**: Ensure AudioSystem correctly extracts and passes `order`/`row` data from the worklet to drive the Pattern-Change logic reliably (from `IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md`).
