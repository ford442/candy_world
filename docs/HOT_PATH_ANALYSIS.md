# Hot-Path Analysis Document - Candy World

> **Version:** 1.0  
> **Date:** 2026-04-07  
> **Scope:** JS/TS Hot Paths → WASM Migration Analysis

---

## 1. Executive Summary

### Current State
The candy_world codebase has an active WASM migration initiative with significant progress in both **AssemblyScript (AS)** and **C++/Emscripten (CPP)** layers. Hot paths have been identified through `@perf-migrate` annotations, manual code review, and performance profiling markers.

### Identified Hot Paths Summary

| Category | Count | Est. Frame Time | Migration Status |
|----------|-------|-----------------|------------------|
| Foliage Animation | 12 functions | ~3-5ms | 40% Migrated |
| Particle Systems | 6 systems | ~2-4ms | GPU (WebGPU) |
| Physics Collisions | 8 functions | ~1-2ms | 70% Migrated |
| Culling/LOD | 4 functions | ~0.5ms | JS (THREE.js bound) |
| Material Updates | 5 functions | ~1ms | Keep in JS |

### Potential Performance Gains from WASM Migration

| Migration Target | Expected Gain | Current Bottleneck |
|------------------|---------------|-------------------|
| AssemblyScript (Math/Animation) | 3-5x | JS loop overhead, GC pressure |
| C++ SIMD (Batch Processing) | 5-10x | Math.sin/cos in hot loops |
| GPU Compute (Particles) | 20-50x | CPU particle iteration |

### Priority Ranking

| Priority | Items | Rationale |
|----------|-------|-----------|
| 🔴 **P0** | 4 functions | Critical path, >2ms/frame, user-facing lag |
| 🟡 **P1** | 8 functions | Important, 0.5-2ms/frame, scalability issues |
| 🟢 **P2** | 12 functions | Nice-to-have, <0.5ms/frame, future-proofing |

---

## 2. Hot Path Inventory

### 2.1 Foliage Animation (`/root/candy_world/src/foliage/animation.ts`)

#### Function: `animateFoliage`
| Attribute | Value |
|-----------|-------|
| **Line Range** | 173-661 |
| **Est. Cost** | ~3ms/frame (scales with object count) |
| **Target** | C++ (core math) + JS (material updates) |
| **Status** | 🟡 **Partially Migrated** |

**Hot Loops Breakdown:**

| Sub-Function | Lines | Est. Cost | Target | Status |
|--------------|-------|-----------|--------|--------|
| Material Flash Updates | 179-284 | ~1.0ms | JS* | Keep in JS |
| Mushroom Bioluminescence | 286-301 | ~0.2ms | AS | 🟡 P1 - Planned |
| Scale Animation | 303-324 | ~0.1ms | AS | ✅ Complete |
| Wobble Smoothing | 326-336 | ~0.2ms | AS | 🔴 P0 - Needed |
| Batcher Queue Check | 350-356 | ~0.1ms | JS | ✅ Complete |
| Shiver Animation | 377-383 | ~0.3ms | C++ | ✅ Migrated to `batchShiver_c` |
| Spring Animation | 384-391 | ~0.3ms | C++ | ✅ Migrated to `batchSpring_c` |
| Float Animation | 396-402 | ~0.3ms | C++ | ✅ Migrated to `batchFloat_c` |
| Cloud Bob Animation | 431-438 | ~0.3ms | C++ | ✅ Migrated to `batchCloudBob_c` |
| Geyser Eruption | 439-483 | ~0.4ms | C++ | 🟡 P1 - Partial |
| Retrigger Pulse | 484-579 | ~0.5ms | C++ | 🟡 P1 - Planned |
| Instrument Shrine | 580-660 | ~0.3ms | AS | 🟢 P2 - Low priority |

**Notes:**
- *Material updates must stay in JS due to THREE.js object manipulation
- The `@perf-migrate` annotation at line 172 indicates this is the primary hot loop
- WASM Batching integration at line 354 already handles most animation types

#### Function: `triggerGrowth`
| Attribute | Value |
|-----------|-------|
| **Line Range** | 18-58 |
| **Est. Cost** | ~0.5ms (scales with plant count) |
| **Target** | AssemblyScript |
| **Status** | 🟢 **Not Started** |

**Hot Loop Pattern:**
```typescript
// Line 20: for (let i = 0, len = plants.length; i < len; i++)
// Performs: scale calculations, userData lookups, clamping
```

**Migration Notes:**
- Simple math operations, ideal for AS
- Requires Float32Array batching interface
- No THREE.js dependencies (pure math)

#### Function: `triggerBloom`
| Attribute | Value |
|-----------|-------|
| **Line Range** | 60-77 |
| **Est. Cost** | ~0.3ms |
| **Target** | AssemblyScript |
| **Status** | 🟢 **Not Started** |

**Hot Loop Pattern:**
```typescript
// Line 62: for (let i = 0, len = flowers.length; i < len; i++)
// Performs: scale.addScalar(), bloom calculations
```

---

### 2.2 Physics System (`/root/candy_world/src/systems/physics/physics.ts`)

#### Function: `updatePhysics` (Main Loop)
| Attribute | Value |
|-----------|-------|
| **Line Range** | 87-149 |
| **Est. Cost** | ~1-2ms/frame |
| **Target** | C++ (core) + JS (state management) |
| **Status** | 🟡 **Partially Migrated** |

**Hot Physics Calculations:**

| Sub-Function | Lines | Est. Cost | Target | Status |
|--------------|-------|-----------|--------|--------|
| C++ Physics Update | 292-303 | ~0.5ms | C++ | ✅ `updatePhysicsCPP` wrapper |
| WASM Collision Resolver | 354-374 | ~0.3ms | C++ | ✅ `resolveGameCollisionsWASM` |
| Panning Pad Check | 772-822 | ~0.2ms | C++ | 🟡 P1 - Planned |
| Geyser Check | 730-770 | ~0.2ms | C++ | 🟡 P1 - Planned |
| Snare Trap Check | 677-728 | ~0.2ms | C++ | 🟡 P1 - Planned |
| Portamento Pine | 591-675 | ~0.3ms | AS | 🟡 P1 - Planned |
| Vine Attachment | 898-927 | ~0.1ms | JS | Keep in JS (async imports) |
| Flora Discovery | 151-187 | ~0.2ms | C++ | 🟡 P1 - Uses WASM spatial grid |

**Critical Hot Loop:**
```typescript
// Line 196-201: Vine swing updates
for (let i = 0; i < vineSwings.length; i++) {
    const v = vineSwings[i];
    // Dynamic import in loop - expensive!
}
```

**Recommendation:** Move dynamic import outside the loop or pre-cache modules.

---

### 2.3 Culling System (`/root/candy_world/src/rendering/culling/culling-system.ts`)

#### Function: `CullingSystem.update`
| Attribute | Value |
|-----------|-------|
| **Line Range** | 211-262 |
| **Est. Cost** | ~0.3-0.5ms/frame |
| **Target** | JS (or future C++ if needed) |
| **Status** | ✅ **Optimized in JS** |

**Hot Loops:**

| Sub-Function | Lines | Est. Cost | Target | Status |
|--------------|-------|-----------|--------|--------|
| Process All Objects | 246-248 | ~0.3ms | JS | ✅ Optimized |
| Frustum Intersection | 315-334 | ~0.1ms | JS | ✅ Uses THREE.js native |
| Distance Culling | 296-312 | ~0.05ms | JS | ✅ Fast path |
| LOD Calculation | 363-366 | ~0.05ms | JS | ✅ Cached |

**Performance Characteristics:**
- Uses spatial hash grid for O(1) lookups
- Static object caching when camera hasn't moved
- Frustum culling via THREE.js native `intersectsSphere`
- Target overhead: <0.5ms (currently achieved)

**Migration Notes:**
- Currently **not a priority** - already optimized
- C++ migration would add complexity for marginal gains
- Keep in JS due to THREE.js scene graph dependencies

---

### 2.4 Particle Systems (`/root/candy_world/src/particles/`)

#### CPU Particle System (`cpu-particle-system.ts`)

| Function | Lines | Est. Cost | Target | Status |
|----------|-------|-----------|--------|--------|
| `update` (main loop) | 225-265 | ~2-4ms | GPU | 🟡 WebGPU fallback |
| `updateFirefly` | 267-305 | ~0.8ms | GPU | ✅ WebGPU compute |
| `updatePollen` | 307-354 | ~0.8ms | GPU | ✅ WebGPU compute |
| `updateBerry` | 356-374 | ~0.3ms | GPU | ✅ WebGPU compute |
| `updateRain` | 376-394 | ~0.5ms | GPU | ✅ WebGPU compute |
| `updateSpark` | 396-411 | ~0.3ms | GPU | ✅ WebGPU compute |

**Hot Loop Pattern:**
```typescript
// Line 230: for (let i = 0; i < this.count; i++)
// Iterates over 10,000+ particles per frame
// Performs: life decay, physics updates, position writes
```

**Primary Strategy:** WebGPU Compute Shaders
- `/root/candy_world/src/particles/compute-particles.ts` implements GPU-based simulation
- `/root/candy_world/src/particles/compute-particles-shaders.ts` contains WGSL shaders
- CPU fallback only when WebGPU unavailable

**WASM Migration Status:**
- Not applicable for primary path (GPU handles this)
- AS particle functions exist for fallback scenarios (`assembly/particles.ts`)

---

### 2.5 Batch Processing (`/root/candy_world/src/utils/wasm-batch.ts`)

#### Batch Upload Functions

| Function | Lines | Est. Cost | Target | Status |
|----------|-------|-----------|--------|--------|
| `uploadPositions` | 87-106 | ~0.1ms | AS | ✅ Complete |
| `uploadAnimationData` | 130-156 | ~0.1ms | AS | ✅ Complete |
| `batchDistanceCull` | 258-280 | ~0.2ms | AS | ✅ Complete |
| `batchAnimationCalc` | 430-450 | ~0.3ms | AS | ✅ Complete |

**Hot Loop Patterns:**
```typescript
// Memory copy loops - already optimized
for (let i = 0; i < count; i++) {
    wasmMemory[offset + i] = data[i];
}
```

---

## 3. Migration Priority Matrix

### 🔴 P0 - Critical (Do First)

| Function | Location | Effort | Impact | Target | Status |
|----------|----------|--------|--------|--------|--------|
| `smoothWobble` | animation.ts:326-336 | Low | High | AS | 🟡 Not Started |
| `batchGroundHeight` | Multiple call sites | Low | High | AS | 🟡 Partial |
| `vineSwings.update` | physics.ts:196-201 | Low | High | C++ | 🔴 In-loop import |
| `triggerGrowth` | animation.ts:18-58 | Low | Med | AS | 🟢 Not Started |

### 🟡 P1 - Important (Do Next)

| Function | Location | Effort | Impact | Target | Status |
|----------|----------|--------|--------|--------|--------|
| `animateFoliage` core | animation.ts:173-661 | Med | High | C++ | 🟡 40% done |
| `geyserEruption` | animation.ts:439-483 | Med | Med | C++ | 🟡 Planned |
| `retriggerPulse` | animation.ts:484-579 | Med | Med | C++ | 🟡 Planned |
| `particle updates` (CPU) | cpu-particle-system.ts | Med | Med | GPU | ✅ WebGPU |
| `portamentoPine` | physics.ts:591-675 | Med | Med | AS | 🟡 Planned |
| `checkPanningPads` | physics.ts:772-822 | Low | Med | C++ | 🟡 Planned |

### 🟢 P2 - Future Work

| Function | Location | Effort | Impact | Target | Status |
|----------|----------|--------|--------|--------|--------|
| `noise functions` | Multiple | Low | Med | AS | ✅ AS has fbm2D |
| `instrumentShrine` | animation.ts:580-660 | Med | Low | AS | 🟢 Not Started |
| `color space conversions` | material updates | Low | Low | AS | ✅ hslToRgb exists |
| `culling components` | culling-components.ts | High | Low | C++ | ✅ JS optimized |

---

## 4. Implementation Notes

### 4.1 Data Format Requirements

#### Float32Array Layout for Foliage Batch
```
// Stride: 16 floats (64 bytes)
// Offset 0-2:   posX, posY, posZ (in/out)
// Offset 3-5:   rotX, rotY, rotZ (in/out)
// Offset 6-8:   scaleX, scaleY, scaleZ (in/out)
// Offset 9:     originalY (in)
// Offset 10:    animationType (in, as float)
// Offset 11:    animationOffset (in)
// Offset 12:    intensity (in)
// Offset 13-15: param1-3 (in/out)
```

#### Particle Data Layout
```
// Position: Float32Array[count * 3]
// Velocity: Float32Array[count * 3]
// Life:     Float32Array[count]
// Size:     Float32Array[count]
// Color:    Float32Array[count * 4]
// Seed:     Float32Array[count]
```

### 4.2 THREE.js Dependencies (Cannot Move)

| Functionality | Reason |
|--------------|--------|
| Material color updates | Requires `material.color.lerp()` |
| Emissive updates | Requires `material.emissive` access |
| Object visibility | Requires `object.visible` setter |
| Scene graph traversal | Requires `object.children` access |
| Matrix updates | Requires `object.matrixWorld` |
| Instance matrix updates | Requires `mesh.setMatrixAt()` |

**Strategy:** Keep material/scene updates in JS, move math to WASM.

### 4.3 Memory Access Patterns

#### Aligned Access (Preferred)
```typescript
// 4-byte aligned for f32
const offset = index * 16; // 64-byte stride
wasmMemory[offset + 0] = x;  // Aligned
wasmMemory[offset + 4] = y;  // Aligned
```

#### Unaligned Access (Avoid)
```typescript
// Would cause performance penalty
const offset = index * 14 + 1; // Not 4-byte aligned
```

### 4.4 Batch Size Recommendations

| Operation | Recommended Batch | Max Batch | Reason |
|-----------|-------------------|-----------|--------|
| Animation updates | 1000-4000 | 4000 | Cache-friendly, SIMD lanes |
| Distance culling | 1000-2000 | 10000 | O(N) but cache-bound |
| Particle updates | 10000+ | 100000 | GPU-compute preferred |
| Collision checks | 100-500 | 1000 | Narrow phase complexity |

---

## 5. Benchmarking Guidelines

### 5.1 Before/After Measurement Template

```typescript
// Before migration (JS version)
console.time('hotPath');
for (let i = 0; i < 1000; i++) {
    hotPathJS(data);
}
console.timeEnd('hotPath');

// After migration (WASM version)
console.time('hotPathWasm');
for (let i = 0; i < 1000; i++) {
    hotPathWASM(data);
}
console.timeEnd('hotPathWasm');

// Calculate speedup
const speedup = timeJS / timeWASM;
console.log(`Speedup: ${speedup.toFixed(2)}x`);
```

### 5.2 Frame Time Measurement

```typescript
// In game loop
const start = performance.now();

// Call hot path
animateFoliageBatch(objects, time, audioData);

const elapsed = performance.now() - start;
if (elapsed > 2.0) {
    console.warn(`[Perf] Hot path exceeded budget: ${elapsed.toFixed(2)}ms`);
}
```

### 5.3 Memory Pressure Test

```typescript
// Check for GC pressure
const before = performance.memory?.usedJSHeapSize;

// Run hot path 1000 times
for (let i = 0; i < 1000; i++) {
    hotPath(data);
}

const after = performance.memory?.usedJSHeapSize;
console.log(`Memory delta: ${((after - before) / 1024 / 1024).toFixed(2)} MB`);
```

### 5.4 Existing Performance Markers

The codebase already contains timing markers:
- `Core Scene Setup` (src/core/main.ts:51)
- `Audio & Systems Init` (src/core/main.ts:60)
- `World Generation` (src/core/main.ts:68)
- `Deferred Visuals Init` (src/core/deferred-init.ts:61)

---

## 6. Current WASM Coverage

### 6.1 AssemblyScript Modules (`/root/candy_world/assembly/`)

| Module | Functions | Status | Exports |
|--------|-----------|--------|---------|
| `math.ts` | 12 | ✅ Complete | lerp, clamp, hslToRgb, fbm2D, distSq, etc. |
| `physics.ts` | 15 | ✅ Complete | collision detection, spatial grid |
| `animation.ts` | 18 | 🟡 Active | calcBounceY, calcSwayRotZ, calcWobble, etc. |
| `animation_batch.ts` | 4 | ✅ Complete | batch animation processing |
| `batch.ts` | 5 | ✅ Complete | culling, spawning, material analysis |
| `particles.ts` | 3 | ✅ Complete | particle physics helpers |
| `foliage.ts` | 2 | ✅ Complete | foliage-specific math |

**Total AS Functions:** ~60 exported functions

### 6.2 C++/Emscripten Modules (`/root/candy_world/emscripten/`)

| Module | Functions | SIMD | OpenMP | Status |
|--------|-----------|------|--------|--------|
| `animation_batch.cpp` | 8 | ✅ | ✅ | ✅ Complete |
| `animation.cpp` | 6 | ❌ | ❌ | ✅ Complete |
| `physics.cpp` | 12 | ❌ | ❌ | ✅ Complete |
| `math.cpp` | 4 | ❌ | ❌ | ✅ Complete |
| `batch.cpp` | 3 | ❌ | ❌ | ✅ Complete |
| `mesh_deformation.cpp` | 6 | ✅ | ✅ | 🟡 In Progress |
| `particle_physics.cpp` | 5 | ❌ | ❌ | 🟡 In Progress |
| `fluid.cpp` | 4 | ❌ | ❌ | 🟡 Planned |
| `lod_batch.cpp` | 4 | ✅ | ❌ | 🟡 In Progress |

**Total C++ Functions:** ~50 exported functions

### 6.3 WASM Loader Integration (`/root/candy_world/src/utils/`)

| Module | Purpose | Status |
|--------|---------|--------|
| `wasm-loader-core.ts` | Core WASM initialization | ✅ Complete |
| `wasm-animations.ts` | Animation function wrappers | ✅ Complete |
| `wasm-physics.ts` | Physics function wrappers | ✅ Complete |
| `wasm-batch.ts` | Batch processing wrappers | ✅ Complete |
| `wasm-orchestrator.ts` | Loading coordination | ✅ Complete |

---

## 7. Next Steps

### Phase 2 Completion Action Items

#### 🔴 P0 - Immediate (This Sprint)

- [ ] **Expand `assembly/math.ts`** with color/noise functions
  - Add `smoothWobble` function for mushroom wobble smoothing
  - Add `median` calculation for velocity buffers
  - Add `lerpColor` variants for material updates

- [ ] **Expand `assembly/batch.ts`** with culling/lerp functions
  - Add `batchLerpPositions` for smooth animations
  - Add `batchUpdateScales` for growth/bloom effects

- [ ] **Add foliage wobble smoothing to AS**
  - Port `median` calculation from JS (animation.ts:329)
  - Create `calcSmoothedWobble(time, offset, intensity, medianVel)`

#### 🟡 P1 - Short Term (Next 2 Sprints)

- [ ] **Migrate `animateFoliage` core to C++**
  - Port `geyserEruption` logic to `batchGeyser_c`
  - Port `retriggerPulse` logic to `batchRetrigger_c`
  - Maintain JS material flash logic

- [ ] **Update TS files to call WASM batch functions**
  - Replace direct `animateFoliage` calls with batcher queue
  - Ensure fallback to JS when WASM not available

- [ ] **Benchmark before/after**
  - Measure frame time with 1000+ foliage objects
  - Measure GC pressure during growth animations
  - Document speedup ratios

#### 🟢 P2 - Future Work

- [ ] **Complete particle physics C++**
  - Port remaining CPU particle logic to `particle_physics.cpp`
  - Add SIMD-optimized particle updates

- [ ] **Fluid simulation integration**
  - Complete `fluid.cpp` for waterfall effects
  - Integrate with existing fluid fog system

- [ ] **Mesh deformation optimization**
  - Complete `mesh_deformation.cpp` for foliage sway
  - Add vertex shader integration

---

## 8. Appendix: Search Patterns Used

To identify hot paths, the following patterns were searched:

```bash
# @perf-migrate annotations
@perf-migrate

# Hot loops
for (let i = 0; i <

# Performance markers
console.time
console.profile

# Optimization comments
OPTIMIZATION
optimization
⚡ OPTIMIZATION

# Function definitions in critical files
export function
```

---

## 9. References

- `/root/candy_world/MIGRATION_STATUS.md` - Overall migration progress
- `/root/candy_world/PERFORMANCE_MIGRATION_STRATEGY.md` - Strategy document
- `/root/candy_world/PHASE2_ROADMAP.md` - Roadmap for Phase 2
- `/root/candy_world/assembly/` - AssemblyScript source
- `/root/candy_world/emscripten/` - C++ source
