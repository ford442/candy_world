# Loading Manager Implementation Summary

## Task Completed
Added proper, accurate progress reporting via a centralized LoadingManager, and made the progress bar reflect real work being done instead of arbitrary percentage jumps.

## Implementation Details

### 1. `LoadingManager`
- Created `src/systems/loading-manager.ts`.
- Manages a task registry where each task has a relative `weight` and an optional `totalSubTasks`.
- Provides an API for systems to increment or report explicit progress, updating an overall weighted progress percentage.

### 2. `LoadingScreen` UI Refactor
- Refactored `src/ui/loading-screen.ts` to be a bridge/consumer of `LoadingManager`.
- Subscribes to manager events to update the progress bar, text, and phase indicators seamlessly.
- Maintains backward-compatible legacy API (`startPhase`, `updateProgress`, etc.) which now delegates to the `LoadingManager`.

### 3. Granular World Generation Tracking
- Updated `src/world/generation.ts` to iterate through the procedural entity loop, periodically reporting real progress (`incrementSubtask`) based on the actual number of iterations (`PROCEDURAL_ENTITY_COUNT`).
- Updated `src/core/main.ts` map generation chunk loading to report individual entity chunk placement accurately.

### 4. Granular Shader Warmup Tracking
- Improved `runDeferredWarmup` inside `src/core/deferred-init.ts`.
- Tracks and reports explicit steps (geometry setup, system setup, async compilation, forced rendering sequence) during the intensive shader compilation block.

### 5. Granular WASM Tracking
- Updated `loadEmscriptenModule` in `src/utils/wasm-loader-core.ts` to hook into the `monitorRunDependencies` hook to report granular dependency status as the WebAssembly module bootstraps.

## Impact
- Visual loading states align 1:1 with CPU/Network tasks.
- Prevents players from experiencing long stalls while the bar is "stuck" at random values like 30% or 70%.
- Supports dynamic task skips without breaking overall progress reporting.
