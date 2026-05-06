# Next Steps: Phase 2 Migration Roadmap

## Phase 1 (JS → TS) - ✅ COMPLETE

Successfully migrated ~15% of hot path functions from 3 critical systems to TypeScript:
- `physics.core.ts` - Movement and collision calculations
- `music-reactivity.core.ts` - Reactivity and culling logic
- `weather.core.ts` - Weather state and growth calculations

## Phase 2 (TS → AssemblyScript WASM) - FUTURE

### Top Candidates for WASM Migration

Based on profiling data, the following functions are called most frequently in hot paths:

#### 1. Music Reactivity Loop (Highest Priority)
**Current**: Iterates 3000+ objects per frame (60 FPS)

**Functions to migrate:**
- `calculateLightFactor()` - Called per visible object
- `calculateChannelIndex()` - Called per reactive object
- `isObjectVisible()` - Distance + frustum culling per object

**Expected improvement:** 2-3x faster with WASM SIMD operations

**Migration strategy:**
```typescript
// Create assembly/music-reactivity.ts
export function batchCalculateLightFactors(
    objects: Float32Array,  // [minLight, maxLight, ...] packed
    globalLight: f32,
    results: Float32Array   // Output: lightFactor per object
): void {
    // WASM SIMD batch processing
}
```

#### 2. Physics Calculations (Medium Priority)
**Current**: Complex movement calculations every frame

**Functions to migrate:**
- `calculateMovementInput()` - Vector math
- Collision detection loops (when implemented)

**Expected improvement:** 1.5-2x faster

#### 3. Weather System (Lower Priority)
**Current**: Many calculations but less frequent

**Functions to migrate:**
- `calculateMushroomGrowthRate()` - Affects all mushrooms
- Batch weather calculations

**Expected improvement:** 1.2-1.5x faster

### Implementation Plan

#### Step 1: Profile and Measure (Required First)
Before migrating to WASM, we need concrete performance data:

```bash
# Enable profiler in main.js
profiler.toggle()

# Look for functions taking >3ms in:
# - MusicReact
# - Physics
# - Weather
```

#### Step 2: Create AssemblyScript Module
```bash
# Install AssemblyScript if needed
npm install --save-dev assemblyscript

# Create new WASM module
# assembly/reactivity.ts
```

#### Step 3: Migrate ONE Function at a Time
Follow the 15% rule - migrate only the single hottest function first:

1. Profile and identify the #1 hottest function
2. Create AssemblyScript version
3. Create JS wrapper for WASM calls
4. Test performance (must show >20% improvement)
5. If successful, migrate next hottest function

#### Step 4: Maintain JS/TS Fallbacks
Always keep JS/TS versions as fallbacks for:
- Browsers without WASM support
- Development/debugging
- Error recovery

### Performance Targets

Only migrate if profiling shows:
- Function takes >3ms per frame (16ms budget @ 60 FPS)
- WASM version shows >20% improvement
- Function is called >100 times per frame

### Memory Management

WASM requires careful memory management:
- Use linear memory for data transfer
- Batch operations to minimize JS↔WASM overhead
- Reuse memory buffers (no GC in WASM)

## Phase 3 (ASC → C++ WASM) - LAST RESORT

Only for the absolute hottest paths (<1% of code):
- SIMD operations for bulk calculations
- Multi-threaded particle systems
- Custom algorithms requiring C++ libraries

## Phase 4 (Three.js → WebGPU Compute) - FUTURE

GPU acceleration for:
- Particle physics (compute shaders)
- Mass foliage animation
- Custom render pipelines

## Decision Tree

```
Is function taking >3ms/frame? 
├─ No → Leave in JS/TS
└─ Yes → Is it called >100 times/frame?
    ├─ No → Move to TS only (Phase 1) ✅ DONE
    └─ Yes → Profile WASM version
        ├─ <20% faster → Keep in TS
        └─ >20% faster → Migrate to WASM (Phase 2)
```

## Current Status

✅ **Phase 1 Complete**: TypeScript migration done  
⏸️ **Phase 2 Blocked**: Needs profiling data first  
📊 **Action Required**: Run profiler and gather metrics  

## Tools and Commands

### Enable Profiling
```javascript
// In browser console or main.js
profiler.toggle()
// Shows real-time frame breakdown
```

### Analyze Performance
```javascript
// After enabling profiler, watch for:
// - MusicReact > 5ms
// - Physics > 3ms  
// - Red bars (>10ms functions)
```

### Test WASM Build
```bash
npm run build:wasm
# Verify candy_physics.wasm is generated
```

## Notes

- Don't prematurely optimize - always profile first
- The 15% rule applies to every phase
- JS remains the "Drafting Ground" forever
- Type safety from TS helps WASM migration
- Document every migration decision

## References

- `PERFORMANCE_MIGRATION_STRATEGY.md` - Main strategy guide
- `PHASE1_MIGRATION_SUMMARY.md` - Phase 1 completion report
- `assembly/index.ts` - Existing WASM physics module (example)
