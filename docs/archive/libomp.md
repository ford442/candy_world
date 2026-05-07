# libomp.md: OpenMP Strategy for Candy World C++/Emscripten

## Current Status

### Active OMP Usage
- **`batch.cpp`** (Primary batch processing):
  - Multiple `#pragma omp parallel for schedule(static) if(count > 500)`
  - Targets: Visibility culling, distance checks, animation updates, physics batches.
  - Functions: Batch visibility, distance culling, animation/position updates.
- **`particle_physics.cpp`**:
  - `#pragma omp parallel for schedule(static)` on particle processing loop (line ~76).
  - Handles multi-threaded particle updates when OpenMP available.

### Prepared/Commented (No Active Pragmas)
- **`bootstrap_loader.cpp`**: Comments mention OpenMP for heightmap gen/shader warmup; uses pthread master + OMP.
- **`mesh_deformation.cpp`**: Defines no-op macros (`#ifndef _OPENMP`); ready for vertex deformation loops.
- **`physics.cpp`**: No-op defines; potential for collision/obstacle loops.
- **`omp.h`**: Local copy of OpenMP header (LLVM-based).
- **`libomp.a`**: Static lib in `emscripten/` for linking.

### Build Integration
- **`build.sh`**: 
  - Flags: `-fopenmp -pthread -matomics -mbulk-memory -msimd128 -ffast-math`
  - Linking: `-L$SCRIPT_DIR -lomp`
- Emscripten supports OMP via pthreads (multi-threaded WASM).
- Fallback: Single-threaded mode (common in browser) ignores pragmas gracefully via no-op defines.

### Performance Impact
- **Multi-threaded**: 2-8x speedup on loops >500 iterations (e.g., 10k particles).
- **Overhead**: `if(count > 500)` prevents spawn on small batches.
- **Tested**: Works in dev/prod builds; verified via `verify_build.js`.

## Strategic Opportunities for New OMP Pragmas
High-impact loops (add `#pragma omp parallel for schedule(static) if(N > 500)`):

1. **`animation_batch.cpp`**: Batch animation calcs (sway, bounce, wobble).
2. **`fluid.cpp`**: Fluid sim steps (velocity/pressure updates).
3. **`mesh_deformation.cpp`**: Vertex deformation loops (wave/jiggle).
4. **`physics.cpp`**: Collision detection, obstacle queries.
5. **`math.cpp`**: Batched noise/FBM/invSqrt (if vectorized).
6. **`bootstrap_loader.cpp`**: Heightmap gen chunks.

**Priorities**:
- **High**: Particle/fluid/physics batches (>10k elements).
- **Medium**: Animation/mesh deformation (per-frame).
- **Low**: Math utils (SIMD-first).

## Rules & Guidelines

### Including omp.h
```
#include &quot;omp.h&quot;  // Local copy in emscripten/

// Always add no-op defines for ST fallback:
#ifndef _OPENMP
#define omp_get_thread_num() 0
#define omp_get_num_threads() 1
#endif
```
- Include **only** in files with pragmas (reduces binary size).
- Place no-ops early (before any `omp_get_*` calls).

### Pragma Syntax
```
#pragma omp parallel for \
    schedule(static) if(count &gt; 500) \
    reduction(+:sum)  // If needed
```
- **schedule(static)**: Best for uniform work (e.g., particles).
- **Threshold**: `if(N > 500)` – Emscripten pthread spawn cost ~100-500 iters.
- **Reductions**: Use for scalars (e.g., `visibleCount`).
- **No dynamic/shared**: Avoid unless profiled.

### Compiler Flags (build.sh)
```
COMPILE_FLAGS=&quot;-O2 -msimd128 -ffast-math -fwasm-exceptions -fno-rtti -funroll-loops -mbulk-memory -fopenmp -pthread -matomics -I.&quot;
LINK_FLAGS=&quot;... -fopenmp -pthread -L$SCRIPT_DIR -lomp&quot;
```
- **MANDATORY**: `-fopenmp -pthread` (enables pthreads).
- **OPT**: `-msimd128` (combine with OMP for hybrid speedup).
- **DEBUG**: `CANDY_DEBUG=1` enables assertions.

### Emscripten/WASM Limitations
- **Multi-thread**: Requires SharedArrayBuffer (COOP/COEP headers via Vite).
- **ST Fallback**: Pragmas become no-ops; no crash.
- **Pthread Pool**: OMP uses Emscripten pthreads (max 2048 threads).
- **No GPU OMP**: CPU-only; use WebGPU compute for shaders.
- **Verify**: `npm run verify:emcc` checks exports/pragmas.

### Testing & Validation
```
# Build with OMP
npm run build:emcc

# Verify exports & perf
npm run test:integration
node verify_build.js  # Checks OMP symbols

# Profile (Chrome DevTools → Performance → WASM)
```
- Benchmark: Compare OMP vs. serial on loops >1k iters.
- Threshold Tune: Adjust `500` based on perf (e.g., 1000 for mobile).

### Migration Path
1. Add no-op defines to new files.
2. Profile serial loop → Add pragma if >2x speedup.
3. Update `AGENTS.md` & `PERFORMANCE_MIGRATION_STRATEGY.md`.
4. Commit with `PERF: +OMP batch-xyz`.

**Goal**: 20-50% perf uplift in ST/multi-thread; maintain JS fallback compatibility.
