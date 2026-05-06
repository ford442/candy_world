# Codebase Refactoring Plan: Breaking Down Large Files

> Generated analysis of 15 files over 1000 lines in the Candy World codebase

## Summary

| Original File | Lines | Proposed Split | Target Files | Target Lines Each |
|---------------|-------|----------------|--------------|-------------------|
| `src/ui/save-menu.ts` | 1,645 | 4 files | styles, slots, settings, main | 550-600 |
| `src/systems/asset-streaming.ts` | 1,624 | 3 files | types, infrastructure, main | 250-1100 |
| `src/particles/compute-particles.ts` | 1,544 | 4 files | types, shaders, cpu-system, main | 120-520 |
| `src/systems/physics.ts` | 1,460 | 3 files | types+main, states, abilities | 250-320 |
| `src/utils/wasm-loader.js` | 1,435 | 4 files | core, animations, physics, batch | 280-400 |
| `src/systems/analytics.ts` | 1,433 | 3 files | types, core, performance | 220-700 |
| `src/systems/performance-budget.ts` | 1,359 | 3 files | types, core, overlay | 180-580 |
| `src/ui/accessibility-menu.ts` | 1,287 | 4 files | menu, components, sections, button | 50-470 |
| `src/systems/save-system.ts` | 1,260 | 3 files | types, database, main | 130-760 |
| `src/main.ts` | 1,171 | 3-4 files | main, game-loop, hud, deferred-init | 200-500 |
| `src/rendering/culling-system.ts` | 1,154 | 3 files | types, components, main | 150-600 |
| `src/core/input.ts` | 1,148 | 4 files | types, playlist, audio, main | 40-550 |
| `src/foliage/common.ts` | 1,138 | 3 files | core, materials, reactivity | 150-550 |
| `src/systems/weather.ts` | 1,136 | 4 files | core, ecosystem, atmosphere, effects | 160-350 |
| `src/foliage/foliage-batcher.ts` | 1,079 | 4 files | types, audio, core, effects | 70-650 |

**Total: 15 files → 47-50 files (approx 3x increase in file count, but much more manageable sizes)**

---

## Detailed Breakdown by File

### 1. `src/ui/save-menu.ts` (1,645 lines)

**New Structure:**
```
src/ui/save-menu/
├── save-menu-styles.ts       # CSS styles (~600 lines)
├── save-slots.ts             # Slot rendering logic (~200 lines)
├── save-settings.ts          # Settings panel (~250 lines)
└── save-menu.ts              # Main orchestrator (~550 lines)
```

**Key Extraction:**
- CSS string (611 lines) → dedicated styles file
- Settings panel with complex form handling
- Save slot grid rendering
- Main `SaveMenu` class becomes thin orchestrator

---

### 2. `src/systems/asset-streaming.ts` (1,624 lines)

**New Structure:**
```
src/systems/asset-streaming/
├── asset-streaming-types.ts          # Types, enums, configs (~250 lines)
├── asset-loading-infrastructure.ts   # LRUCache, NetworkManager (~280 lines)
└── asset-streaming.ts                # AssetStreamer + loaders (~550 lines)
```

**Key Extraction:**
- Generic `LRUCache<K,V>` class (standalone utility)
- `NetworkManager` - HTTP/2, range requests, retry logic
- Specialized loaders remain in main file

---

### 3. `src/particles/compute-particles.ts` (1,544 lines)

**New Structure:**
```
src/particles/
├── compute-particles-types.ts    # Type definitions (~120 lines)
├── compute-particles-shaders.ts  # WGSL shaders (~450 lines)
├── cpu-particle-system.ts        # CPU fallback class (~450 lines)
└── compute-particles.ts          # GPU system + factory (~520 lines)
```

**Key Extraction:**
- WGSL shader code (350+ lines of shader strings)
- `CPUParticleSystem` - complete CPU fallback implementation
- Clean separation of GPU vs CPU concerns

---

### 4. `src/systems/physics.ts` (1,460 lines)

**New Structure:**
```
src/systems/physics/
├── physics.ts              # Orchestrator, types, exports (~250 lines)
├── physics-states.ts       # State handlers (~320 lines)
└── physics-abilities.ts    # Ability system (~180 lines)
```

**Key Extraction:**
- State handlers: `updateSwimmingState`, `updateDancingState`, `updateVineState`, etc.
- `handleAbilities()` - complex 177-line ability logic
- Main file keeps `player` state object and `updatePhysics()` entry point

---

### 5. `src/utils/wasm-loader.js` (1,435 lines)

**New Structure:**
```
src/utils/
├── wasm-loader-core.js      # Module init, instances (~395 lines)
├── wasm-animations.js       # Animation wrappers (~446 lines)
├── wasm-physics.js          # Collision, physics (~298 lines)
├── wasm-batch.js            # Batch processing (~296 lines)
└── wasm-loader.js           # Barrel export (thin)
```

**Key Extraction:**
- 30+ animation wrapper functions into dedicated file
- Collision/physics functions separate from batch processing
- Core initialization remains in base module

---

### 6. `src/systems/analytics.ts` (1,433 lines)

**New Structure:**
```
src/systems/analytics/
├── types.ts         # Interfaces, constants, utilities (~220 lines)
├── core.ts          # AnalyticsSystem class (~700 lines)
├── performance.ts   # PerformanceTracker class (~300 lines)
└── index.ts         # Barrel export (~100 lines)
```

**Key Extraction:**
- 11 TypeScript interfaces to types file
- `PerformanceTracker` as standalone class
- Main `AnalyticsSystem` retains event tracking and session management

---

### 7. `src/systems/performance-budget.ts` (1,359 lines)

**New Structure:**
```
src/systems/performance-budget/
├── performance-budget-types.ts     # Enums, interfaces, configs (~180 lines)
├── performance-budget-core.ts      # Main class (~580 lines)
├── performance-budget-overlay.ts   # Debug UI (~240 lines)
└── performance-budget.ts           # Barrel export (~50 lines)
```

**Key Extraction:**
- Debug overlay with canvas graphs → separate UI component
- Types and configuration constants isolated
- Core budget tracking logic stays in main class

---

### 8. `src/ui/accessibility-menu.ts` (1,287 lines)

**New Structure:**
```
src/ui/accessibility-menu/
├── accessibility-menu.ts           # Main class (~450 lines)
├── accessibility-components.ts     # UI factory (~320 lines)
├── accessibility-sections.ts       # Section renderers (~470 lines)
└── accessibility-button.ts         # Button helpers (~50 lines)
```

**Key Extraction:**
- UI component factory (`createToggle`, `createSlider`, etc.) - pure functions
- 6 `render*Section` methods into dedicated file
- Button creation helpers for external use

---

### 9. `src/systems/save-system.ts` (1,260 lines)

**New Structure:**
```
src/systems/save-system/
├── save-types.ts       # Types, constants (~130 lines)
├── save-database.ts    # IndexedDB + Migration (~290 lines)
└── save-system.ts      # Main orchestrator (~760 lines)
```

**Key Extraction:**
- 10 type definitions to dedicated types file
- `SaveDatabase` and `MigrationSystem` classes together
- `SaveSystem` retains slot management and auto-save logic

---

### 10. `src/main.ts` (1,171 lines)

**New Structure:**
```
src/
├── main.ts              # Entry point, init (~200 lines)
├── game-loop.ts         # animate() function (~500 lines)
├── hud.ts               # HUD updates (~200 lines)
└── deferred-init.ts     # Visual effects init (~250 lines)
```

**Key Extraction:**
- `animate()` function - the 632-line main render loop
- HUD update logic (energy bar, abilities, phase shift UI)
- `initDeferredVisuals()` - lazy-loaded visual effects

---

### 11. `src/rendering/culling-system.ts` (1,154 lines)

**New Structure:**
```
src/rendering/culling/
├── culling-types.ts       # Enums, interfaces (~150 lines)
├── culling-components.ts  # HashGrid, QueryManager, Debug (~400 lines)
└── culling-system.ts      # Main orchestrator (~600 lines)
```

**Key Extraction:**
- `SpatialHashGrid` - O(1) spatial queries
- `OcclusionQueryManager` + `CullingDebugVisualizer`
- Main `CullingSystem` class retains LOD and frustum logic

---

### 12. `src/core/input.ts` (1,148 lines)

**New Structure:**
```
src/core/input/
├── input-types.ts       # KeyStates, helpers (~40 lines)
├── playlist-manager.ts  # Jukebox/playlist UI (~350 lines)
├── audio-controls.ts    # Volume, mute (~200 lines)
└── input.ts             # Core coordination (~550 lines)
```

**Key Extraction:**
- Playlist/jukebox modal (250+ lines of UI rendering)
- Audio control handlers (mute, volume, buttons)
- Main file keeps keyboard/mouse/ability handlers

---

### 13. `src/foliage/common.ts` (1,138 lines)

**New Structure:**
```
src/foliage/
├── material-core.ts       # Shared resources, TSL, factory (~550 lines)
├── foliage-materials.ts   # Material instances (~150 lines)
└── foliage-reactivity.ts  # Reactivity system (~180 lines)
```

**Key Extraction:**
- TSL shader nodes (triplanar noise, rim lights, wind) - ~280 lines
- `foliageMaterials` object with material instances
- Reactivity registry and lifecycle management

---

### 14. `src/systems/weather.ts` (1,136 lines)

**New Structure:**
```
src/systems/weather/
├── weather.ts              # Core orchestrator (~350 lines)
├── weather-ecosystem.ts    # Cloud-mushroom interactions (~180 lines)
├── weather-atmosphere.ts   # Fog, darkness, wind (~220 lines)
└── weather-effects.ts      # Rainbow, aurora, lightning (~160 lines)
```

**Key Extraction:**
- Ecosystem manager (cloud-mushroom behavior, transformations)
- Atmosphere manager (fog, darkness, wind physics)
- Visual effects manager (rainbow, aurora, lightning)

---

### 15. `src/foliage/foliage-batcher.ts` (1,079 lines)

**New Structure:**
```
src/foliage/batcher/
├── foliage-batcher-types.ts   # Constants, interfaces (~70 lines)
├── foliage-batcher-audio.ts   # Audio helpers (~80 lines)
├── foliage-batcher-core.ts    # Main class (~650 lines)
└── foliage-batcher-effects.ts # Animation apply functions (~280 lines)
```

**Key Extraction:**
- Audio analysis helpers (`getVibratoAmount`, etc.)
- 9 animation-specific apply functions (snare snap, accordion, etc.)
- Memory layout constants and types

---

## General Recommendations

### Directory Structure Pattern
For each major file, create a subdirectory with the same name:
```
src/systems/physics.ts → src/systems/physics/
    ├── index.ts        (barrel export for compatibility)
    ├── types.ts        (if many types)
    ├── core.ts         (main logic)
    └── [feature].ts    (extracted functionality)
```

### Migration Strategy
1. **Start with type-only extractions** - Safest, no runtime changes
2. **Extract pure functions next** - No state dependencies
3. **Extract classes with clear boundaries** - E.g., `PerformanceTracker`
4. **Leave barrel exports** - Maintain backward compatibility during transition

### Dependency Management
- Keep shared state in the main module (e.g., `player` in physics)
- Pass dependencies as parameters to extracted functions
- Use TypeScript path aliases for clean imports

### Testing Consideration
After splitting:
- Unit test each new module independently
- Integration test the barrel exports
- Verify no circular dependencies introduced

---

## Priority Ranking (by complexity/impact)

| Priority | File | Reason |
|----------|------|--------|
| 1 | `compute-particles.ts` | Clear shader/CPU/GPU separation |
| 2 | `save-menu.ts` | CSS extraction alone is huge win |
| 3 | `input.ts` | Playlist is self-contained |
| 4 | `wasm-loader.js` | Animation wrappers are independent |
| 5 | `foliage/common.ts` | TSL effects are pure functions |
| 6 | `weather.ts` | Clear subsystem boundaries |
| 7 | `accessibility-menu.ts` | UI components are reusable |
| 8 | `performance-budget.ts` | Debug overlay is separable |
| 9 | `physics.ts` | State handlers are well-defined |
| 10 | `asset-streaming.ts` | Cache/Network are utilities |
| 11 | `analytics.ts` | Performance tracker is standalone |
| 12 | `save-system.ts` | Database layer is clear |
| 13 | `main.ts` | Requires careful state management |
| 14 | `culling-system.ts` | Components have interdependencies |
| 15 | `foliage-batcher.ts` | Complex animation coupling |

---

## Files Created

After full refactoring, the codebase will have:
- **~47-50 new module files** (up from 15)
- **~15 barrel index files** for backward compatibility
- **Average file size: ~300 lines** (down from ~1,200)
- **Maximum file size: ~700 lines** (down from ~1,600)

This represents a **~4x reduction** in maximum file size and **~3x reduction** in average file size.
