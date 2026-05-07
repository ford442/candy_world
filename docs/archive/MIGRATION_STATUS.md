# Candy World Migration Status

> **Last Updated:** 2026-04-07  
> **Migration Path:** JavaScript → TypeScript → AssemblyScript → C++ → WebGPU

---

## 1. Migration Overview

This document tracks the progressive optimization migration of the Candy World codebase through multiple performance tiers.

### Migration Layers

| Layer | Technology | Responsibility | Performance Target |
|-------|------------|----------------|-------------------|
| **Tier 0** | JavaScript (ES6+) | Legacy fallback, UI logic | Baseline |
| **Tier 1** | TypeScript | Type-safe application layer, systems | Maintainable |
| **Tier 2** | AssemblyScript | WASM modules for physics, animation, batching | 5-10x faster |
| **Tier 3** | C++ / Emscripten | Heavy compute, OpenMP parallelization | 10-50x faster |
| **Tier 4** | WebGPU Compute | GPU-accelerated physics, particles, mesh deformation | 100x+ faster |

### Migration Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   JavaScript    │ ──► │   TypeScript    │ ──► │ AssemblyScript  │
│   (Legacy)      │     │  (Type Safety)  │     │    (WASM/WA)    │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                              ┌──────────────────────────┘
                              ▼
                    ┌─────────────────┐     ┌─────────────────┐
                    │  C++/Emscripten │ ──► │  WebGPU Compute │
                    │  (Heavy Compute)│     │  (GPU Parallel) │
                    └─────────────────┘     └─────────────────┘
```

---

## 2. Current Status

### ✅ Already Migrated to TypeScript

The following directories/files have been fully migrated to TypeScript:

| Directory | File Count | Status |
|-----------|-----------|--------|
| `src/core/` | 4 files | ✅ Complete (config.ts, cycle.ts, init.ts, input.ts) |
| `src/audio/` | 2 files | ✅ Complete |
| `src/foliage/` | 46 files | ✅ Complete |
| `src/gameplay/` | 4 files | ✅ Complete |
| `src/particles/` | 7 files | ✅ Complete |
| `src/rendering/` | 6 files | ✅ Complete |
| `src/systems/` | 22 files | ✅ Complete |
| `src/ui/` | 5 files | ✅ Complete |
| `src/utils/` | 2 files | ✅ Partial (geometry-dedup.ts, startup-profiler.ts) |
| `src/workers/` | 6 files | ✅ Complete |
| `src/world/` | 2 files | ✅ Complete |
| `src/compute/` | 9 files | ✅ Complete |
| `src/wasm/` | 1 file (.d.ts) | ✅ Types Complete |

**Total TypeScript Files:** 126

---

### ⏳ JavaScript Files Pending Migration

| Source File | Target File | Priority | Status | Notes |
|-------------|-------------|----------|--------|-------|
| `src/core/init.js` | `src/core/init.ts` | 🔴 High | ⚠️ IN PROGRESS | Entry point initialization |
| `src/utils/toast.js` | `src/utils/toast.ts` | 🟡 Medium | ⚠️ IN PROGRESS | UI notifications |
| `src/utils/profiler.js` | `src/utils/profiler.ts` | 🟡 Medium | ⚠️ IN PROGRESS | Performance profiling |
| `src/utils/wasm-loader.js` | `src/utils/wasm-loader.ts` | 🔴 High | ⚠️ IN PROGRESS | WASM module loading |
| `src/utils/wasm-orchestrator.js` | `src/utils/wasm-orchestrator.ts` | 🔴 High | ⚠️ IN PROGRESS | WASM coordination |
| `src/utils/wasm-utils.js` | `src/utils/wasm-utils.ts` | 🔴 High | ⚠️ IN PROGRESS | WASM utilities |
| `src/utils/bootstrap-loader.js` | `src/utils/bootstrap-loader.ts` | 🟡 Medium | ⚠️ IN PROGRESS | Bootstrap loading |

**Note:** `init.ts` exists but migration may be incomplete. Verify type coverage.

---

### 🧹 Files with Duplicate JS/TS (Cleanup Required)

These files have both `.js` and `.ts` versions and need cleanup:

| JS File | TS File | Action Required |
|---------|---------|-----------------|
| `src/utils/interaction-utils.js` | `src/utils/interaction-utils.ts` | Compare and remove JS stub or consolidate |
| `src/utils/shared-buffer-example.js` | `src/utils/shared-buffer-example.ts` | Compare and remove JS stub or consolidate |
| `src/utils/toast.js` | `src/utils/toast.ts` + `toast.d.ts` | Verify TS implementation, deprecate JS |

**Cleanup Checklist:**
- [ ] Compare functionality between JS and TS versions
- [ ] Ensure TS version has full feature parity
- [ ] Add migration stub header to JS files
- [ ] Update all imports to use TS version
- [ ] Remove JS files after verification

---

## 3. AssemblyScript (AS) Modules

Location: `/root/candy_world/assembly/`

AssemblyScript compiles to WebAssembly for high-performance computation.

| File | Purpose | Exports |
|------|---------|---------|
| `index.ts` | Module exports aggregator | All AS modules |
| `math.ts` | Math utilities | `lerp`, `clamp`, `getGroundHeight`, `freqToHue` |
| `physics.ts` | Physics system & spatial grid | Collision detection, grid management |
| `animation.ts` | Animation batching | Animation state management |
| `animation_batch.ts` | Batch animation processing | Batch update routines |
| `batch.ts` | Generic batching system | Instance batching |
| `discovery.ts` | Discovery/effect system | Discovery triggers, effects |
| `foliage.ts` | Foliage generation | Plant/vegetation logic |
| `material_batch.ts` | Material batching | Material property batching |
| `particles.ts` | Particle system | Particle simulation |
| `constants.ts` | AS constants | Shared constants |
| `memory.ts` | Memory management | Buffer allocation |

**Build Output:** `build/optimized.wasm`, `build/untouched.wasm`

---

## 4. C++ / Emscripten Modules

Location: `/root/candy_world/emscripten/`

C++ modules compiled with Emscripten for maximum performance with OpenMP support.

| File | Purpose | Key Functions |
|------|---------|---------------|
| `animation.cpp` | Procedural animations | Fiber whip, hop, shiver, spiral, prism effects |
| `animation_batch.cpp` | Batch animation processing | Large-scale animation batches |
| `math.cpp` | Advanced math | Hash, noise, FBM, fastInvSqrt, getGroundHeight |
| `physics.cpp` | Physics engine | Collision, forces, integration |
| `batch.cpp` | Instance batching | Render batch management |
| `fluid.cpp` | Fluid simulation | SPH, grid-based fluids |
| `mesh_deformation.cpp` | Mesh deformation | Vertex manipulation |
| `particle_physics.cpp` | Particle physics | Particle forces, collisions |
| `bootstrap_loader.cpp` | Module loader | Runtime WASM loading |
| `lod_batch.cpp` | LOD batching | Level-of-detail management |

**Build Script:** `build.sh` (with OpenMP support)  
**Dependencies:** `libomp.a`, `omp.h`

---

## 5. WebGPU Compute

Location: `/root/candy_world/src/compute/`

GPU-accelerated compute shaders for massive parallelization.

| File | Purpose | Compute Kernels |
|------|---------|-----------------|
| `gpu-compute-library.ts` | Core GPU compute framework | Pipeline management, buffer handling |
| `gpu-compute-shaders.ts` | WGSL shader definitions | Compute shader source |
| `mesh-deformation-gpu.ts` | GPU mesh deformation | Vertex displacement compute |
| `mesh_deformation.ts` | Mesh deformation interface | JS/WASM bridge |
| `mesh_deformation_wasm.ts` | WASM-integrated deformation | Hybrid CPU/GPU path |
| `noise-generator-gpu.ts` | GPU noise generation | Perlin, Simplex, FBM on GPU |
| `noise_generator.ts` | Noise interface | Noise generation API |
| `particle_compute.ts` | GPU particle system | Particle update compute shaders |
| `index.ts` | Compute module exports | Public API |

**Capabilities:**
- Particle physics (100k+ particles)
- Mesh deformation (real-time vertex updates)
- Noise generation (terrain, effects)
- Culling (frustum, occlusion)

---

## 6. Next Steps

### Immediate Actions (This Sprint)

- [ ] Complete `src/core/init.js` → `src/core/init.ts` migration
- [ ] Complete `src/utils/wasm-loader.js` → `src/utils/wasm-loader.ts` migration
- [ ] Complete `src/utils/wasm-orchestrator.js` → `src/utils/wasm-orchestrator.ts` migration
- [ ] Complete `src/utils/wasm-utils.js` → `src/utils/wasm-utils.ts` migration
- [ ] Clean up duplicate `interaction-utils.js` / `.ts`
- [ ] Clean up duplicate `shared-buffer-example.js` / `.ts`

### Short Term (Next 2 Weeks)

- [ ] Migrate `src/utils/profiler.js` → `src/utils/profiler.ts`
- [ ] Migrate `src/utils/toast.js` → `src/utils/toast.ts`
- [ ] Migrate `src/utils/bootstrap-loader.js` → `src/utils/bootstrap-loader.ts`
- [ ] Audit `src/wasm/candy_physics.js` for TS types

### Medium Term (Next Month)

- [ ] Expand AS physics module coverage
- [ ] Optimize C++ particle physics with SIMD
- [ ] Add WebGPU compute for foliage wind
- [ ] Implement GPU-based LOD system

### Long Term (Ongoing)

- [ ] Profile and migrate hot paths to appropriate tier
- [ ] Document WASM boundary contracts
- [ ] Add automated migration testing
- [ ] Create migration decision tree for new features

---

## 7. Stub File Convention

When a `.js` file is fully migrated to `.ts`, follow this convention:

### Step 1: Create the TypeScript Implementation

Create the full TypeScript implementation with proper types.

### Step 2: Create the Stub JS File

Replace the original `.js` file with a stub that re-exports:

```javascript
/**
 * @fileoverview MIGRATION STUB - DO NOT MODIFY
 * This file has been migrated to TypeScript.
 * 
 * @deprecated This JavaScript stub is kept for backwards compatibility.
 * Import from the TypeScript version directly: `import { ... } from './module.ts'`
 * 
 * Migration Date: 2026-04-07
 * Original: src/utils/example.js
 * Migrated: src/utils/example.ts
 */

// Re-export everything from the TypeScript implementation
export * from './example.ts';
export { default } from './example.ts';
```

### Step 3: Update Imports

Update all internal imports to use the `.ts` version directly.

### Step 4: Deprecation Timeline

| Phase | Action | Timeline |
|-------|--------|----------|
| 1 | Add deprecation JSDoc | Immediate |
| 2 | Update all internal imports | 1 week |
| 3 | Add console warning in stub | 2 weeks |
| 4 | Remove stub file | 1 month |

---

## Migration Metrics

| Metric | Count | Percentage |
|--------|-------|------------|
| Total Source Files | 136 | 100% |
| TypeScript Files | 126 | 92.6% |
| JavaScript Files (Pending) | 9 | 6.6% |
| AssemblyScript Modules | 12 | - |
| C++ Emscripten Modules | 10 | - |
| WebGPU Compute Modules | 9 | - |

---

## Notes for Agents

- Always check this file before starting migration work
- Update status after completing each file migration
- Add any discovered blockers or dependencies to the Notes column
- When creating stub files, use the exact convention in Section 7
- Test WASM bindings after any AS or C++ changes

---

*This document is maintained by the development team. Last updated by migration agent on 2026-04-07.*
