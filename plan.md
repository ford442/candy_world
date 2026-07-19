1. *Extract `src/core/game-loop-core.ts`*
   - Move all the state variables (`sceneRef`, `cameraRef`, etc.), constants (`COLOR_STORM_SKY_TOP`, `_DOF_FLORA_ZONES`, etc.), and simple helper functions (`safeUpdateBatcher`, `safeSystemUpdate`) from `game-loop.ts` to `game-loop-core.ts`.
   - Export all state variables so they can be accessed by the phase modules.
   - Move `initGameLoopDependencies`, `getGameTime`, `getAudioState`, and `getBeatFlashIntensity` to `game-loop-core.ts`.

2. *Extract `src/core/game-loop-postfx.ts`*
   - Move `_celestialInView`, `_applyShaftColor`, `_setShaftOpacity`, `applyMusicReactiveLightShafts`, `_updateDepthOfField`, and `updateSunShadowFollow` to `game-loop-postfx.ts`.
   - Import necessary state variables from `game-loop-core.ts`.

3. *Extract tick-phase modules*
   - Create `src/core/game-loop-audio.ts` for audio phase updates.
   - Create `src/core/game-loop-visuals.ts` for lighting, TSL uniforms, sky, weather, and aurora.
   - Create `src/core/game-loop-particles.ts` for music reactivity and particle systems.
   - Create `src/core/game-loop-physics.ts` for physics, camera orbital controls, and debug overlays.
   - Create `src/core/game-loop-gameplay.ts` for item pickups, weapons, HUD updates, and clouds.
   - Create `src/core/game-loop-compute.ts` for GPU compute node dispatch.
   *(Alternatively, bundle these into `game-loop-phases.ts` first, then split if it's too large, but individual modules are cleaner and match "tick-phase modules" request)*

4. *Refactor `src/core/game-loop.ts`*
   - Remove the extracted code.
   - Import the state variables and phase functions.
   - Rewrite the `animate()` function to simply orchestrate the phase functions, passing necessary local variables (e.g., `delta`, `t`, `isNightNow`, `exploreActive`).
   - Export `initGameLoopDependencies`, `getGameTime`, `getAudioState`, `getBeatFlashIntensity` from `game-loop-core.ts`.

5. *Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.*
   - Run typecheck and tests.

6. *Update `REFACTORING_PLAN_REMAINING.md` and `weekly_plan.md`*
   - Mark #1360 as completed.

7. *Submit PR*
