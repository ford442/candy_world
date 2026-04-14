1. The CI is still failing on visual-regression timeout.
2. Wait! The visual regression tests are running against my code. The fix for the `LoadingScreenOptions` is included in my code.
3. I checked `__sceneReady` and `candy-loading-overlay`. It turns out `candy-loading-overlay` correctly has `.complete` class added to `candy-loading-screen` and `.loaded` was legacy. BUT wait, `el` is `document.getElementById('candy-loading-overlay')`, which gets its `visible` class removed.
4. Actually, `el` is `#candy-loading-overlay`, and `src/ui/loading-screen.ts` says `this.overlay = document.createElement('div'); this.overlay.id = 'candy-loading-overlay';`. Then `this.overlay.classList.remove('visible')` happens in `hide()`.
5. Let's fix `tools/visual-regression/src/screenshot-capture.ts` so the tests pass. The issue is that `tools/visual-regression/src/screenshot-capture.ts` waits for `.loaded` class on `#candy-loading-overlay`, but `src/ui/loading-screen.ts` never adds `.loaded`, it removes `.visible`. So `(el && !el.classList.contains('visible'))` should be added.
6. The PR branch checks are failing because the new loading screen implementation (`src/ui/loading-screen.ts`) doesn't use the `.loaded` class anymore, and `tools/visual-regression/src/screenshot-capture.ts` wasn't updated to handle it. Wait, when was `src/ui/loading-screen.ts` added? Probably recently. My PR just happens to be the one failing because `tools/visual-regression/src/screenshot-capture.ts` is broken.
7. I will modify `tools/visual-regression/src/screenshot-capture.ts` to wait for the absence of `.visible` class or `el` being removed.
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
- **Identify Phase 4 Targets**: Find specific visual features that are still heavily reliant on CPU and transition them to WebGPU Compute Shaders (GPGPU). Candidates include `impacts.ts`.
