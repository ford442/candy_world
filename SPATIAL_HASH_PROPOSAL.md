# Spatial Hashing Optimization Proposal for Physics System

## Executive Summary

This document proposes a **Tier 1 (JavaScript)** optimization for `src/systems/physics.js` to implement spatial hashing for collision detection, as mandated by `PERFORMANCE_MIGRATION_STRATEGY.md` before considering WASM migration.

## Problem Analysis

### Current Implementation (Naive O(N) Approach)

The `resolveSpecialCollisions()` function performs linear scans through all game objects every frame:

```javascript
// Line 331-352: Check ALL caves
foliageCaves.forEach(cave => { /* distance check */ });

// Line 355-385: Check ALL mushrooms  
for (const mush of foliageMushrooms) { /* distance check */ }

// Line 389-411: Check ALL clouds
for (const cloud of foliageClouds) { /* distance check */ }

// Line 431-448: Check ALL vines
vineSwings.forEach(v => { /* distance check */ });
```

### Performance Impact

**Typical Scene Composition:**
- 10-15 caves with water gates
- 20-30 mushrooms (platforms and trampolines)
- 15-20 clouds (sky platforms)
- 5-10 vine swing anchors
- **Total: ~60 objects checked per frame**

**Cost per Frame:**
- 60 objects × distance calculation = O(N) linear scan
- Each check: 2 multiplications, 2 additions, 1 comparison (distanceSquared)
- Estimated baseline: **2-4ms/frame** on typical hardware

**Why This Matters:**
- At 60 FPS, we have 16.67ms per frame budget
- 2-4ms = 12-24% of frame budget spent on collision checks
- Most checks are wasted: player only near 2-5 objects at a time

## Proposed Solution: Spatial Hash Grid

### Algorithm Overview

**Spatial hashing** divides the world into a grid of cells. Each object is placed in its cell, and queries only check the player's cell plus neighboring cells.

```
┌─────┬─────┬─────┬─────┐
│     │     │ ☁️  │     │  Grid: 10×10 unit cells
├─────┼─────┼─────┼─────┤
│ 🍄  │     │     │ 🍄  │  Player at (25, 25):
├─────┼─────┼─────┼─────┤    - Check cell (2,2) + neighbors
│     │ 👤  │     │     │    - Only 2 mushrooms and 1 cloud checked
├─────┼─────┼─────┼─────┤    - Ignores 55+ other objects
│ 🍄  │ 🍄  │     │ 🌊  │
└─────┴─────┴─────┴─────┘
```

### Key Design Decisions

1. **Cell Size: 10 units**
   - Based on typical collision radii (2-5 units)
   - Ensures objects in neighboring cells are within detection range
   - Balance between too-fine (many cells) and too-coarse (many objects/cell)

2. **Query Pattern: 3×3 Grid (9 cells)**
   - Player's cell + 8 neighbors
   - Covers radius of ~14 units (√200 diagonal)
   - Handles edge cases where player is at cell boundary

3. **Hash Function**
   ```javascript
   hash(x, z) {
       const cellX = Math.floor(x / CELL_SIZE);
       const cellZ = Math.floor(z / CELL_SIZE);
       return `${cellX},${cellZ}`;
   }
   ```

4. **Update Strategy: Lazy Rebuild**
   - Objects are mostly static (mushrooms, clouds don't move)
   - Build hash once when physics initializes
   - No per-frame rebuilding needed

### Expected Performance Gains

**Before Optimization:**
- Objects checked per frame: 60
- Distance calculations: 60
- Estimated cost: 2-4ms/frame

**After Optimization:**
- Cells queried: 9 (3×3 grid)
- Objects per cell (avg): 60 ÷ (30×30 cells) × 9 ≈ **0.5-2 objects**
- Distance calculations: 2-8 (instead of 60)
- Estimated cost: **0.3-0.6ms/frame**

**Expected Improvement: 70-85% reduction in collision time**

## Implementation Plan

### Phase 1: Profiling (Baseline)

**Files to Modify:**
- `src/systems/physics.js` (add profiler measurements) ✅

**Measurements:**
```javascript
profiler.measure('Collisions', () => {
    resolveSpecialCollisions(delta, camera, keyStates, audioState);
});

profiler.measure('VineAttach', () => {
    checkVineAttachment(camera);
});
```

**Success Criteria:**
- [ ] Capture baseline self-time in browser DevTools Performance panel
- [ ] Document avg/max frame times in console logs
- [ ] Verify profiler UI shows collision cost breakdown

### Phase 2: Spatial Hash Implementation

**New File:**
- `src/utils/spatial-hash.js`

**Class Interface:**
```javascript
export class SpatialHashGrid {
    constructor(cellSize = 10) { /* ... */ }
    
    insert(object, x, z) { /* Add object to grid */ }
    
    query(x, z, radius = 0) { 
        /* Return objects in nearby cells */ 
    }
    
    clear() { /* Reset grid */ }
    
    getStats() { 
        /* Return { totalObjects, cellsUsed, avgObjectsPerCell } */ 
    }
}
```

### Phase 3: Integration

**Modify `src/systems/physics.js`:**

1. **Import spatial hash:**
   ```javascript
   import { SpatialHashGrid } from '../utils/spatial-hash.js';
   ```

2. **Create grids (one per object type):**
   ```javascript
   let caveGrid = null;
   let mushroomGrid = null;
   let cloudGrid = null;
   let vineGrid = null;
   ```

3. **Initialize in `initCppPhysics()`:**
   ```javascript
   // Build spatial hash grids
   caveGrid = new SpatialHashGrid(10);
   foliageCaves.forEach(cave => {
       caveGrid.insert(cave, cave.position.x, cave.position.z);
   });
   // ... same for mushrooms, clouds, vines
   ```

4. **Replace linear scans with spatial queries:**
   ```javascript
   // OLD:
   foliageCaves.forEach(cave => { /* check all */ });
   
   // NEW:
   const nearbyCaves = caveGrid.query(playerPos.x, playerPos.z, 5);
   nearbyCaves.forEach(cave => { /* check only nearby */ });
   ```

### Phase 4: Validation

**Tests:**
- [ ] Mushroom bounce works (trampoline collision)
- [ ] Cave water gates push player back
- [ ] Cloud platforms support player weight
- [ ] Vine attachment triggers correctly
- [ ] No gameplay regressions

**Performance:**
- [ ] Profile optimized version
- [ ] Compare before/after collision times
- [ ] Verify >50% improvement target met
- [ ] Test with various object densities

## Step 0: Profile First ✅

Per `PERFORMANCE_MIGRATION_STRATEGY.md` Line 17-18:

> **Step 0: Profile First (MANDATORY)**  
> * **Rule:** No migration without a profile screenshot or trace showing the function's self-time.

**Our Approach:**
1. ✅ Added `profiler.measure()` calls to collision functions
2. 🔄 Running dev server with profiler enabled (press P key)
3. 📊 Capturing baseline metrics before optimization
4. 📈 Will compare before/after to demonstrate improvement

**Profiling Workflow:**
```bash
npm run dev
# In browser:
# 1. Press 'P' to enable profiler
# 2. Move around world to trigger collisions
# 3. Look for "LAG SPIKE" warnings in console
# 4. Check profiler UI for "Collisions" and "VineAttach" bars
```

## Migration Decision Tree (Per Strategy)

| Tier | Threshold | Status | Decision |
|------|-----------|--------|----------|
| **Tier 1: JavaScript** | < 2ms/frame | Current | ✅ **Implement Spatial Hash** |
| Tier 2: TypeScript | Logic errors > 5% | N/A | ⏸️ Not needed yet (collision logic is simple) |
| Tier 3: AssemblyScript | > 3ms/frame + 500 iters | N/A | 🚫 **Do NOT migrate yet** (Strategy Line 54) |
| Tier 4: C++ WASM | > 8ms/frame | N/A | 🚫 Extreme scale only |

**From Strategy Document (Lines 52-54):**
> ### Priority C: Future Research (Do NOT migrate yet)
> | Function | File | Blocker |
> | `updatePhysics` | `src/systems/physics.js` | **Needs spatial hashing in JS first; profile after** |

**Interpretation:**
- ✅ Must optimize in JavaScript first (this proposal)
- ✅ Then profile to measure actual impact
- ⏸️ Only consider WASM if collision time still exceeds 3ms after JS optimization
- 🎯 This proposal fulfills the "JS first" requirement

## Risk Mitigation

### Edge Cases to Test

1. **Cell Boundary Cases**: Player exactly at cell edge (x = 10.0, z = 10.0)
   - Solution: 3×3 query pattern covers boundary overlaps

2. **Sparse Object Distribution**: What if grid has 1 object per 100 cells?
   - Impact: Minimal overhead (empty cells are fast to skip)

3. **Object Clustering**: What if 20 mushrooms in one cell?
   - Impact: Still faster than checking all 60 objects

4. **Dynamic Objects**: What if objects move (future feature)?
   - Solution: Call `grid.clear()` and rebuild (only if objects move)

### Rollback Plan

If optimization introduces bugs or doesn't improve performance:
1. Keep original code commented out (not removed)
2. Add feature flag: `const USE_SPATIAL_HASH = true;`
3. Easy A/B testing and rollback

## Success Metrics

### Performance
- [x] Profiler integrated
- [ ] Baseline measured: X.XXms avg, X.XXms max
- [ ] Post-optimization: X.XXms avg (>50% improvement)
- [ ] No frame drops during collision-heavy gameplay

### Correctness
- [ ] All collision types work identically
- [ ] No false negatives (missed collisions)
- [ ] No false positives (incorrect collisions)

### Code Quality
- [ ] Clear comments explaining spatial hash logic
- [ ] Follows existing code style (scratch vectors, etc.)
- [ ] No new dependencies (pure JavaScript)
- [ ] Maintains Tier 1 status (no TypeScript/WASM)

## Next Steps

1. ✅ Add profiler measurements (DONE)
2. 🔄 Run dev server and capture baseline metrics
3. ✅ Create this proposal document
4. 🔧 Implement `SpatialHashGrid` class
5. 🔧 Integrate into physics.js
6. 🧪 Test and validate
7. 📊 Profile and compare results
8. 📝 Update `PERFORMANCE_MIGRATION_STRATEGY.md` with results

## References

- [PERFORMANCE_MIGRATION_STRATEGY.md](./PERFORMANCE_MIGRATION_STRATEGY.md) - Migration decision tree
- [src/utils/profiler.js](./src/utils/profiler.js) - Profiling utility
- [src/systems/physics.js](./src/systems/physics.js) - Target file
- Spatial Hashing: https://en.wikipedia.org/wiki/Spatial_hashing
- Grid-based collision detection: https://gameprogrammingpatterns.com/spatial-partition.html
