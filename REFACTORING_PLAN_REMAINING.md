# Remaining Large File Refactoring Plan

This document tracks the large-file refactoring task. All 5 original monoliths have been split into modules, but several resulting files still exceed the 700-line target and need a second pass.

**Status**: Phase 2 complete — all non-barrel modules are now under the 700-line target.

## Current Module Sizes

| Original file | Split module | Lines | Target | Status |
|---------------|--------------|-------|--------|--------|
| src/world/generation.ts | src/world/generation-core.ts | 646 | < 700 | ✅ |
| src/world/generation.ts | src/world/generation-entities.ts | 393 | < 700 | ✅ |
| src/world/generation.ts | src/world/generation-setpieces.ts | 242 | < 700 | ✅ |
| src/world/generation.ts | src/world/generation-decorators.ts | 519 | < 700 | ✅ |
| src/world/generation.ts | src/world/generation-utils.ts | 236 | < 700 | ✅ |
| src/world/generation.ts | src/world/generation.ts (barrel) | 5 | < 50 | ✅ |
| src/systems/region-manager.ts | src/systems/region-manager-core.ts | 565 | < 700 | ✅ |
| src/systems/region-manager.ts | src/systems/region-manager-lod.ts | 289 | < 700 | ✅ |
| src/systems/region-manager.ts | src/systems/region-manager.ts (barrel) | 10 | < 50 | ✅ |
| src/ui/loading-screen.ts | src/ui/loading-screen-ui.ts | 692 | < 700 | ✅ |
| src/ui/loading-screen.ts | src/ui/loading-screen-progress.ts | 426 | < 700 | ✅ |
| src/ui/loading-screen.ts | src/ui/loading-screen-dom.ts | 165 | < 700 | ✅ |
| src/ui/loading-screen.ts | src/ui/loading-screen-reporting.ts | 53 | < 700 | ✅ |
| src/ui/loading-screen.ts | src/ui/loading-screen-types.ts | 97 | < 700 | ✅ |
| src/ui/loading-screen.ts | src/ui/loading-screen.ts (barrel) | 17 | < 50 | ✅ |
| src/audio/audio-system.ts | src/audio/audio-system-core.ts | 464 | < 700 | ✅ |
| src/audio/audio-system.ts | src/audio/audio-system-playback.ts | 593 | < 700 | ✅ |
| src/audio/audio-system.ts | src/audio/audio-system.ts (barrel) | 3 | < 50 | ✅ |
| src/ui/analytics-debug.ts | src/ui/analytics-debug-handlers.ts | 348 | < 700 | ✅ |
| src/ui/analytics-debug.ts | src/ui/analytics-debug-ui.ts | 669 | < 700 | ✅ |
| src/ui/analytics-debug.ts | src/ui/analytics-debug.ts (barrel) | 15 | < 50 | ✅ |
| **TOTAL** | | **~6,397** (excluding barrels) | | **100% under target** |

## Detailed Refactoring Plans

### 1. src/world/generation.ts (1078 → 4 files)

**Current Structure:**
- Type definitions (MapEntity, ObstacleData, WorldObjects, WeatherSystem)
- Constants (DEFAULT_MAP_CHUNK_SIZE, LAKE_BOUNDS, LAKE_ISLAND, ARPEGGIO_GROVE)
- Helper functions (getUnifiedGroundHeight, isPositionValid)
- Main functions (initWorld, safeAddFoliage, processMapEntity)
- Population functions (populateArpeggioGrove, populateLakeIsland, populateProceduralExtras)
- Public functions (spawnNearbyFoliage, initCriticalWorld, initWorldCritical, initWorldContent)

**Split Plan:**

#### 1a. generation-utils.ts (~250 lines)
Contains helper functions and utilities:
- `getUnifiedGroundHeight()` - Ground height calculation with lake/island modifiers
- `isPositionValid()` - Position validation helper
- Constants: LAKE_BOUNDS, LAKE_ISLAND, ARPEGGIO_GROVE
- Type definitions: MapEntity, ObstacleData

#### 1b. generation-decorators.ts (~320 lines)
Contains population/decoration functions:
- `populateArpeggioGrove()` - Grove population with musical flora
- `populateLakeIsland()` - Lake island population
- `populateProceduralExtras()` - Procedural extras generation

#### 1c. generation-core.ts (~350 lines)
Contains core world generation:
- `initWorld()` - Main world initialization
- `safeAddFoliage()` - Safe foliage addition with validation
- `processMapEntity()` - Map entity processing logic
- `initCriticalWorld()` / `initWorldCritical()` - Critical initialization

#### 1d. generation.ts (~50 lines - barrel)
Re-exports all from split modules:
```typescript
export * from './generation-utils.ts';
export * from './generation-decorators.ts';
export * from './generation-core.ts';
```

**Key Imports to Maintain:**
```typescript
import * as THREE from 'three';
import { updateProgress } from '../ui/index.ts';
import { createIntegratedFireflies, ... } from '../particles/index.ts';
import { CONFIG } from '../core/config.ts';
import { foliageGroup, ... } from './state.ts';
```

---

### 2. src/systems/region-manager.ts (1064 → 3 files)

**Current Structure:**
- RegionManager class with 30+ methods
- LOD management (setQuality, transitionLOD)
- Streaming management (updateVisibility, updateStreaming)
- Region culling and management

**Split Plan:**

#### 2a. region-manager-core.ts (~450 lines)
Contains RegionManager class core:
- Constructor and initialization
- Core properties (regions, cellSize, lodManager, etc.)
- Basic region management methods
- Streaming queue management
- Public API: getCell, setQuality, getVisibleRegions

#### 2b. region-manager-lod.ts (~350 lines)
Contains LOD-related functionality:
- `transitionLOD()` - LOD quality transitions
- `updateVisibility()` - Visibility culling
- `updateStreaming()` - Streaming updates
- Distance-based LOD calculations
- Quality level management

#### 2c. region-manager.ts (~50 lines - barrel)
Re-exports:
```typescript
export * from './region-manager-core.ts';
export * from './region-manager-lod.ts';
export { RegionManager } from './region-manager-core.ts';
```

**Key Considerations:**
- RegionManager is a large class - split methods logically
- Maintain all private properties and helper methods
- Keep imports consistent

---

### 3. src/ui/loading-screen.ts (1063 → 3 files)

**Current Structure:**
- LoadingScreen class
- UI rendering methods
- Progress tracking
- Phase management
- Animation and styling

**Split Plan:**

#### 3a. loading-screen-ui.ts (~350 lines)
Contains UI rendering and DOM manipulation:
- `show()` / `hide()` - Visibility control
- `createUI()` - DOM creation
- CSS/styling updates
- Animation frame updates
- DOM element references and setup

#### 3b. loading-screen-progress.ts (~350 lines)
Contains progress tracking and phases:
- `updateProgress()` - Progress updates
- Phase management (trackPhase, reportPhase)
- Progress calculation
- Phase history tracking
- Statistics gathering

#### 3c. loading-screen.ts (~50 lines - barrel)
Re-exports all:
```typescript
export * from './loading-screen-ui.ts';
export * from './loading-screen-progress.ts';
```

---

### 4. src/audio/audio-system.ts (1047 → 3 files)

**Current Structure:**
- AudioSystem class (large)
- Playback controls
- Volume/EQ management
- Playlist handling
- Beat sync integration

**Split Plan:**

#### 4a. audio-system-core.ts (~400 lines)
Contains AudioSystem initialization:
- Constructor
- Initialization methods
- Core properties
- Web Audio API setup
- Context creation

#### 4b. audio-system-playback.ts (~350 lines)
Contains playback functionality:
- `play()` / `pause()` / `stop()` - Playback control
- `setVolume()` / `setEQ()` - Audio parameter control
- Playlist management
- Track switching
- Duration and time tracking

#### 4c. audio-system.ts (~50 lines - barrel)
Re-exports:
```typescript
export * from './audio-system-core.ts';
export * from './audio-system-playback.ts';
export { AudioSystem } from './audio-system-core.ts';
```

---

### 5. src/ui/analytics-debug.ts (1023 → 3 files)

**Current Structure:**
- AnalyticsDebug class
- UI rendering and visualization
- Event handling
- Data processing and display
- Inspector overlay

**Split Plan:**

#### 5a. analytics-debug-ui.ts (~350 lines)
Contains UI rendering:
- `createUI()` - DOM creation
- Visual rendering (canvas, charts)
- Layout and styling
- DOM update methods
- Display formatting

#### 5b. analytics-debug-handlers.ts (~350 lines)
Contains event handling and logic:
- Event listeners
- Data processing
- State management
- Inspector logic
- Update handlers

#### 5c. analytics-debug.ts (~50 lines - barrel)
Re-exports:
```typescript
export * from './analytics-debug-ui.ts';
export * from './analytics-debug-handlers.ts';
export { AnalyticsDebug } from './analytics-debug-ui.ts';
```

---

## Refactoring Procedure

For each file, follow these steps:

1. **Analyze Structure**
   - Read through the entire file
   - Identify logical groupings
   - Note interdependencies

2. **Create Split Files**
   - Extract code into new modules
   - Add JSDoc @file comments
   - Maintain all imports

3. **Update Imports/Exports**
   - Update import statements
   - Ensure all exports are present
   - Create barrel re-export file

4. **Verify Functionality**
   - Check for circular imports
   - Verify all types are accessible
   - Run any available tests

5. **Clean Up**
   - Remove unused imports
   - Fix any linting issues
   - Add module documentation

## Testing After Refactoring

After completing each file:

1. **Build Check**
   ```bash
   npm run build
   ```

2. **Import Verification**
   - Search for imports from refactored files
   - Verify no import paths break
   - Check barrel exports work

3. **Type Checking**
   - Verify TypeScript compiles
   - Check for any type errors

4. **Functional Testing**
   - Run relevant smoke tests
   - Manual testing if needed

## Final Verification

After all 5 files are refactored:

1. Run full test suite:
   ```bash
   npm run test
   ```

2. Build production:
   ```bash
   npm run build
   ```

3. Verify no breaking changes:
   - Check all imports resolve
   - Verify functionality unchanged
   - No new errors in console

## Benefits

✅ Improved code organization
✅ Easier navigation in IDEs
✅ Better separation of concerns
✅ Reduced cognitive load per file
✅ Easier for teams to work in parallel
✅ Maintained backward compatibility throughout

## Summary

- **Original refactor**: 5 monoliths split into 17 modules + 5 barrel files ✅
- **Phase 2 cleanup**: 3 target files split further into 6 new modules; all non-barrel modules now under 700 lines ✅
  - `src/world/generation-core.ts` (1029 → 646)
  - `src/world/generation-decorators.ts` (751 → 519)
  - `src/ui/loading-screen-ui.ts` (1015 → 692)
- **New modules added**:
  - `src/world/generation-entities.ts` (393)
  - `src/world/generation-setpieces.ts` (242)
  - `src/ui/loading-screen-dom.ts` (165)
  - `src/ui/loading-screen-reporting.ts` (53)
- **Expected Result**: All non-barrel modules under 700 lines ✅
- **Breaking Changes**: None (100% backward compatible)

---

**Verification:**
- `pnpm run build:ci` ✅
- `pnpm run test:wasm` ✅
- `pnpm run test` (smoke) ✅ — ran on the WebGL fallback path (`RENDERER=webgl`) because the VM's SwiftShader WebGPU path loses the device during draw; the WebGL path boots to `window.__sceneReady` and passes the jukebox UI assertion
