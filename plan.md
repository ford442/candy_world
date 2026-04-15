# Candy World Master Plan

## Recent Progress
- Migrated custom render passes and unmigrated `src/foliage/lake_features.ts` using TSL.
- Migrated `environment.ts`, `celestial-bodies.ts`, `moon.ts`, and `trees.ts` to use TSL.
- **Phase 4 Targets: impacts.ts**
  - **Status: Implemented ✅**
  - *Implementation Details: Migrated velocity, lifespan, sizing, and color processing from the CPU to a dedicated WebGPU compute shader using TSL (`Fn().compute()`). Replaced heavy JavaScript \`if/else\` structures and \`Math.random()\` generation with a newly integrated GPU-side \`hash()\` function utilizing \`modFloat\`.*
- **Phase 4 Targets: Verify Data Flow**
  - **Status: Implemented ✅**
  - *Implementation Details: Confirmed `audio-processor.js` reads `order` and `row` from libopenmpt and emits them in `VISUAL_UPDATE` message. Confirmed `audio-system.ts` maps them to `visualState.patternIndex` and `visualState.row`. Confirmed `weather.ts` reads `audioData.patternIndex` and correctly processes them via `handlePatternChange()` without issues.*

## Next Steps
- **Target 2: Fix the Broken Test Suite (Immediate Tech Debt)**
  - **Status: Implemented ✅**
  - *Implementation Details: Fixed broken test commands in `package.json` so that `pnpm test` and `pnpm test:integration` do not fail, unblocking the CI/CD pipeline.*
- **Target 3: The AudioSystem Data Flow (Next Ecosystem Feature)**
  - **Status: Implemented ✅**
  - *Implementation Details: Verified that the AudioSystem correctly extracts and passes `order`/`row` data from the audio worklet to drive the Pattern-Change logic.*
- **Identify Phase 4 Targets**: Find specific visual features that are still heavily reliant on CPU and transition them to WebGPU Compute Shaders (GPGPU). Candidates include `fireflies.ts`.
