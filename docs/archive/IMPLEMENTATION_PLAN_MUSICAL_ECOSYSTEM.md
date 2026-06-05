# Project Plan: Musical Ecosystem Features

This document captures feature ideas for the Candy World musical ecosystem. Completed features have been moved to `archive/COMPLETED_FEATURES.md`. The ideas are grouped into categories, each including a description, gameplay mechanics, visual design notes, behavioral patterns, and audio cues.

---

## Visual Vision: "The Arpeggio Grove" (Status: Implemented ✅)
* Implementation Details: Created `populateArpeggioGrove` in `src/world/generation.ts` as a manual setpiece and added the `crystallineNebula` biome to the procedural map generator.
- Expanded Scene: A clearing in the Crystalline Nebula featuring a Subwoofer Lotus surrounded by twelve Arpeggio Ferns, a Spectrum Aurora overhead, and reactive environmental features like Vibrato Violets and Kick-Drum Geysers.
- Key Interactions:
  - Arpeggio Ferns unfurl as chords play, providing dynamic platforming and defensive structures.
  - The Spectrum Aurora visually signals harmonic collisions and drops Harmony Orbs for a Chord Strike superweapon.
  - Crescendo Fog, BPM Wind, and Vibrato Violets shape visibility and projectile behavior mid-combat.
  - Snare-Snap Traps and timed geyser eruptions provide rhythm-based puzzles and traversal mechanics.
- Gameplay Loop: Use the musical elements as rhythm-puzzle mechanics involving timed traversal, grind-path navigation, and environmental management to survive and find secrets.
- Secrets: Glitching the Subwoofer Lotus (9xx) during a breakdown reveals a hidden Bass Portal leading to a waveform bonus stage.

---

This plan serves as a master list for implementing musical, visual, and gameplay synergies driven by the tracked music engine. Break these into smaller implementation tasks, and prioritize interactions that yield interesting gameplay emergent behaviors.

---

## Migration Roadmap: JS → TS → AssemblyScript/WASM → C++ → WebGPU 🚀

This phased plan outlines a progressive migration to stronger typing, offloading heavy computation to WASM, and eventually replacing parts of the renderer with raw WebGPU for maximum control and performance.

*(Note: Phases 1, 2, and 3 are successfully completed. Below is the active Phase 4 plan.)*

### Phase 4: The Graphics Rewire (Three.js → Raw WebGPU) 🎨🔥
**Goal:** Gain full control over rendering and compute for particle systems and specialized passes.

- **Hybrid Strategy (Don't delete Three.js yet)**
  - Keep Three.js as a shell while replacing internals incrementally.

- **Stage A — Compute Shaders (GPGPU)**
  - Run WGSL compute passes to update particle/physics buffers on a `gpuDevice`.
  - Use a `THREE.BufferAttribute` pointing to the GPU buffer for rendering.

- ~~**Stage B — Custom Render Passes**~~ [DEPRECATED - Superseded by TSL & InstancedMesh Batching]
  - Replace specific materials with `RawShaderMaterial` / WebGPU pipelines (e.g., cloud or terrain draws).

- ~~**Stage C — Scene Graph Replacement**~~ [DEPRECATED - Superseded by TSL & InstancedMesh Batching]
  - Once compute + custom render passes are in place, migrate scene hierarchy to an ECS in WASM and call `device.queue.submit()` directly.

---

### Summary Flowchart
```
JS src/world/generation.js -> TS (Add Types)

TS generation.ts -> ASC assembly/generation.ts (WASM Logic)

JS src/audio/audio-system.js -> C++ candy_audio.cpp (WASM DSP)

Three.js Particles -> WebGPU ComputeShader.wgsl (Raw Updates)

Three.js Renderer -> WebGPU RenderPipeline (Raw Draw Calls)
```

---

## Recent Progress

1. **Phase 4: The Graphics Rewire (Three.js → Raw WebGPU) Stage A — Compute Shaders (GPGPU)** (Status: Implemented ✅)
   - *Implementation Details:* Implemented the GPGPU compute passes for particle updates and transitioned the particle systems (fireflies, pollen, berries, rain, sparks) entirely to WebGPU Compute Shaders to realize Phase 4 Stage A objectives.

2. **Subwoofer Lotus InstancedMesh Batcher** (Status: Implemented ✅)
   - *Implementation Details:* Created `SubwooferLotusBatcher` using TSL and InstancedMesh to handle Subwoofer Lotus rendering efficiently at massive scale with bass reactivity.

3. **Foliage Growth & Rain-Driven Spreading** (Status: Implemented ✅)
   - *Implementation Details:* Implemented `spawnNearbyFoliage` in `src/world/generation.ts` and integrated it into the weather ecosystem's update loop (`src/systems/weather/weather-ecosystem.ts`). It pulls source positions from existing batched mushrooms and flowers, and uses a distance threshold check to cap local density.

4. **Moon Dance & Note-Color Reactivity** (Status: Implemented ✅)
   - *Implementation Details:* Updated `CONFIG.noteColorMap` and `MUSHROOM_NOTES` to strictly adhere to the `assets/colorcode.json` note-color mappings. Also modified the `skyLutData` node in `src/systems/biome-uniforms.ts` to procedurally map the 12 chromatic notes across its 128 slots matching the specified color palette.

5. **Phase 4: The Graphics Rewire (Three.js → Raw WebGPU) Stage B — Advanced Post-Processing** (Status: Implemented ✅)
   - *Implementation Details:* Replaced standard post-processing with an advanced TSL-based pipeline featuring Chromatic Aberration and Vignette, driven by uniforms, within `src/foliage/post-processing.ts`.

6. **Refactoring Large Files: generation.ts** (Status: Implemented ✅)
   - *Implementation Details:* Modularized `src/world/generation.ts` into `generation-core.ts`, `generation-decorators.ts`, and `generation-utils.ts`, reducing file size and improving maintainability.

7. **Subwoofer Lotus InstancedMesh Batcher** (Status: Implemented ✅)
   - *Implementation Details:* Created `SubwooferLotusBatcher` using TSL and InstancedMesh to handle Subwoofer Lotus rendering efficiently at massive scale with bass reactivity.

## Next Steps

1. **Refactoring Large Files: region-manager.ts** (Status: Implemented ✅)
   - *Next Step Suggestion:* Continue the refactoring plan by splitting `src/systems/region-manager.ts` into smaller, well-scoped modules to improve long-term maintainability.
1. **Phase 4: The Graphics Rewire (Three.js → Raw WebGPU) Stage C — Scene Graph Replacement** (Status: Implemented ✅)
   - *Implementation Details:* Implemented AssemblyScript WASM ECS system using high-performance pointer arrays and memory mappings. Exported `ecs_createEntity`, `ecs_addComponent`, etc. to typescript.
   - *Next Step Suggestion:* Replace the large file refactoring tasks from `REFACTORING_PLAN_REMAINING.md`, starting with `src/world/generation.ts`.
