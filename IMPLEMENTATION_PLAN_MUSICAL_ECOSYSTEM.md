# Project Plan: Musical Ecosystem Features

This document captures feature ideas for the Candy World musical ecosystem. Completed features have been moved to `archive/COMPLETED_FEATURES.md`. The ideas are grouped into categories, each including a description, gameplay mechanics, visual design notes, behavioral patterns, and audio cues.

---

## Visual Vision: "The Arpeggio Grove"
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

- **Stage B — Custom Render Passes**
  - Replace specific materials with `RawShaderMaterial` / WebGPU pipelines (e.g., cloud or terrain draws).

- **Stage C — Scene Graph Replacement**
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

## Next Steps

1. **Verify Data Flow**: Ensure `AudioSystem` correctly extracts and passes `order`/`row` data from the worklet to drive the Pattern-Change logic reliably.
2. **Identify Phase 4 Targets**: Find specific visual features that are still heavily reliant on CPU and transition them to WebGPU Compute Shaders (GPGPU).
