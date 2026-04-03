# Master Plan: Candy World 🍬

**Objective:** Create an immersive, audio-reactive 3D world with a "Cute Clay" aesthetic, featuring a robust musical ecosystem and advanced WebGPU visuals.

## Current Focus
**Phase:** Feature Implementation (Musical Ecosystem / Graphics Polish)
**Priority:** High (Category 4: Advanced Shaders / Category 1-3 Wrap-up)

---

## Next Steps

1. **Phase 4 (Three.js -> WebGPU) Stage C**: Scene Graph Replacement - Once compute + custom render passes are in place, migrate scene hierarchy to an ECS in WASM and call `device.queue.submit()` directly.
2. **Identify Phase 4 Targets**: Find specific visual features that are still heavily reliant on CPU and transition them to WebGPU Compute Shaders (GPGPU).

---

## Recent Progress
- **Accomplished:**
  - **Verify Data Flow (`AudioSystem`)**: **Status: Implemented ✅**
    - *Implementation Details: Updated `src/main.ts` and `index.html` with a Tracker Status HUD UI element that continuously monitors and displays the current Pattern (`order`) and Row. This verified that `AudioSystem` correctly extracts and passes tracker data from the worklet to the main thread.*
  - **Phase 4 (Three.js -> WebGPU) Stage B (Weather Particles)**: **Status: Implemented ✅**
    - *Implementation Details: Rewrote the legacy CPU/WASM particle system to use WebGPU Compute Shaders (`ComputeParticleSystem`) for weather effects (rain and mist). Moved physics updates and audio-reactive behavior completely to the GPU, and removed `LegacyParticleSystem` and `WasmParticleSystem`.*
  - **Phase 4 targets (Jitter Mines Compute)**: **Status: Implemented ✅**
    - *Implementation Details: Offloaded JitterMineSystem CPU-side matrix updates to WebGPU TSL Vertex Shaders. Used `InstancedBufferAttribute` and a custom Rodrigues' rotation formula in TSL to provide stateless, time-based particle rotation and scaling updates on the GPU without manual instanceMatrix updates on the CPU.*
  - **Phase 4 - Compute Shaders (GPGPU) - Harmony Orbs**: **Status: Implemented ✅**
    - *Implementation Details: Rewrote the `HarmonyOrbSystem` in `src/foliage/aurora.ts` to utilize WebGPU Compute Shaders. All physics (gravity, wind sway) and lifecycle updates were offloaded from the CPU to the GPU via TSL `Fn().compute()`. `StorageInstancedBufferAttribute` buffers map directly to the TSL material.*
  - **Planning Debt Resolution**: **Status: Implemented ✅**
    - *Implementation Details: Extracted all completed features into `archive/COMPLETED_FEATURES.md`. Cleaned up `plan.md` and `IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md` to remove the bloat from successfully implemented items.*
  - **Plan Consolidation Task**: Added `weekly_plan.md` directive. **Status: Implemented ✅**
    - *Implementation Details: Updated `weekly_plan.md` with a note to review, fix, and archive all old plan files because all active categories are mostly filled with 'Implemented' tasks.*

*(Note: The full list of past accomplishments and completed plan categories has been moved to `archive/COMPLETED_FEATURES.md` to resolve planning debt).*

---

## Migration Roadmap (Summary)
1. **Phase 1 (JS -> TS):** Typing core data structures and systems. [DONE]
2. **Phase 2 (TS -> ASC):** Offloading hot paths to WASM. [DONE]
3. **Phase 3 (ASC -> C++):** Specialized solvers. [DONE]
4. **Phase 4 (Three.js -> WebGPU):** Raw compute and render pipelines. [IN PROGRESS]
