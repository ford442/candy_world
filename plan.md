# Project Plan: Musical Ecosystem Features

This document captures feature ideas for the Candy World musical ecosystem. The ideas are grouped into categories, each including a description, gameplay mechanics, visual design notes, behavioral patterns, and audio cues.

---

## Category 1: Melodic Flora (Pitch & Effect Reactive)

### Arpeggio Ferns
- Description: Crystalline ferns with segmented, glowing metal fronds that unfurl in quantized ticks synced to arpeggio effect speed (0xy).
- Gameplay Mechanics: Fully unfurled fronds create temporary platforms or block lasers. Players can ride the unfurl motion to launch upward; shooting during unfurl freezes a frond into a permanent angled platform. Collecting three "Fern Cores" unlocks the "Arpeggio Shield".
- Visual Design: Skeletal animation with rigid-body physics for each segment. Glow peaks at ticks and decays exponentially. Subtle chromatic aberration on movement edges.
- Behavioral Patterns: Start furled until channel plays arpeggio; multiple ferns unfurl in a stair-step sequence; retract slowly if arpeggio stops.
- Audio: Metallic "chink" per tick harmonized with the arpeggio note.

### Portamento Pines
- Description: Towering antennae clusters made of copper alloy that bend with portamento (pitch slides), using a spring motion.
- Gameplay Mechanics: Leaned-back pines act as slingshots for velocity boosts; forward-leaning ramps launch players vertically. Bend angle proportional to portamento speed. Shooting the base while bent causes snap-back shockwave.
- Visual Design: Verlet integration chain for bending; stress lines glow with sharper bends; fiber-optic needles shift color with tension.
- Behavioral Patterns: Return to vertical over 1s; nearby pines harmonize bends; sustained slide causes vibration at slide frequency.
- Audio: Creaking metallic groan rising/falling with pitch slide.

### Vibrato Violets
- Description: Bioluminescent flowers with vibrating membrane petals that shake with vibrato (4xx), driven by a vertex shader.
- Gameplay Mechanics: Vibration creates a frequency distortion field (20m radius) causing enemy projectiles to zigzag; harvest "Vibrato Nectar" during peak vibrato to craft "Jitter Mines".
- Visual Design: Vertex shader sine-wave displacement and motion blur post-process; strobing glow with ghostly afterimages.
- Behavioral Patterns: Bloom only with vibrato; amplitude increases with vibrato depth; ring-out for 1s after vibrato stops.
- Audio: Trembling bell-like tone wavers with vibrato.

### Retrigger Mushrooms [ACCOMPLISHED]
- Description: Flat disc fungi with phosphorescent spore pods that strobe on/off with retrigger commands (Rxx/E9x).
- Gameplay Mechanics: Strobing applies retrigger to player's weapons and reveals cloaked enemies; induces HUD flicker (Strobe Sickness). Shooting strobing mushrooms spawns a spore cloud.
- Visual Design: **[Implemented]** Updated to "Cute Clay" aesthetic (matte pastel colors, rosy cheeks). Implemented audio-reactive squash/stretch (bounce) and emissive strobing (flash intensity) triggered by note events.
- Behavioral Patterns: Mushrooms dim until retrigger; nearby mushrooms sync strobes; explode into a lingering spore cloud when shot.
- Audio: Sharp percussive "snap" per tick, creating a polyrhythm overlay.

### Tremolo Tulips
- Description: Tall bell flowers that pulse scale and opacity with tremolo (7xx), with an interior vortex of light.
- Gameplay Mechanics: Max pulse turns interior into a portal that stores collectibles/projectiles and expels them at minimum; harvest "Tremolo Bulbs" for a phase-shift ability.
- Visual Design: Sine-driven scale and opacity lerp; orbital particle vortex; rim-lighting breathes with pulse.
- Behavioral Patterns: Grow in groups with phase offsets; freeze for 2s when tremolo stops.
- Audio: Wah-wah filter on ambient sound within range.

---

## Category 2: Rhythmic Structures (Trigger & Volume Reactive)

### Cymbal Dandelions
- Description: Spherical clusters of metallic filaments that explode into floating seeds when high frequencies (>8kHz) trigger.
- Gameplay Mechanics: Seeds are collectible "Chime Shards" and also act as obstacles slowing ships; Sonic Clap can trigger explosions manually.
- Visual Design: Burst particle system with physics-based drag; single-frame white flash followed by slow-motion dispersal.
- Behavioral Patterns: Static plants twitch with high frequencies; explosion force scales with cymbal velocity.
- Audio: Random high-frequency chimes per seed (C6-C8).

### Kick-Drum Geysers
- Description: Fissures that vent gas/plasma with force scaled by kick drum velocity, producing tall plumes and vertical propulsion.
- Gameplay Mechanics: Players can ride geyser plumes; timing yields "Perfect Launch" multiplier; shooting the base charges the next eruption.
- Visual Design: Cylindrical plume mesh with flow map and emissive glow; debris particles carried upwards; gradient from red to blue.
- Behavioral Patterns: Erupt on kick events with wind-up; plume duration 0.5s + dissipation; group eruption sequences.
- Audio: Deep concussive "whump" layered with hiss.

### Snare-Snap Trap
- Description: Jaw-like wall plants that snap shut on snare triggers, creating a shockwave and reflecting projectiles.
- Gameplay Mechanics: Memorize patterns for safe passage; snap shockwave can be used defensively; "Snap Core" allows missile ricochet.
- Visual Design: Spring-damper physics with snap, bounce, and ring-shaped shockwave particle effect.
- Behavioral Patterns: Grouped like drum fills; scale snap force by snare velocity; can be "stuck" when shot.
- Audio: Sharp whip-crack snap with metallic reverb.

### Panning Pads
- Description: Holographic lily pads floating on mercury pools that respond to stereo pan (8xx) and channel volume.
- Gameplay Mechanics: Jump on pads only when glowing; landing at bob peak gives horizontal boost; collect "Panning Pollen" for homing shots.
- Visual Design: Sine-wave bob with pan-driven amplitude; radial glow shader with additive blending; reflective mercury.
- Behavioral Patterns: Pads in a stereo field; simultaneous pans can create seesaw effects.
- Audio: Subtle blip when pad bobs, panned to position.

### Silence Spirits
- Description: Translucent, starlight deer-like creatures spawn in breakdowns with low master volume / channel count.
- Gameplay Mechanics: Commune for a 5s invisibility buff; fleeing if player is noisy; leave stardust tracks to secret areas.
- Visual Design: Particle sprites, dissolve shader, emissive antlers casting long shadows.
- Behavioral Patterns: Herds of 2-5; avoid moving players; dissolve on beat drops.
- Audio: Ethereal pad-like ambience, tape-stop on hide.

---

## Category 3: Atmospheric & World (Global State)

### Pattern-Change Seasons
- Description: Global visual palette changes triggered by pattern commands (Dxx, Bxx), instantly or blending over time.
- Gameplay Mechanics: Season affects enemy behavior, collectible availability, and can be locked by a "Palette Anchor".
- Visual Design: Global color LUT, grayscale textures colored by palette, chromatic aberration pulse during transitions.
- Behavioral Patterns: Synchronized across level; certain patterns bloom or retract.
- Audio: Rising "whoosh" for Dxx, tape-flutter morph for Bxx.

### BPM Wind
- Description: Global wind vector scaled to BPM that affects particles, foliage, projectiles, and cloth.
- Gameplay Mechanics: Wind impacts jump trajectory; players can surf tailwinds; "Wind Anchor" grants wind immunity.
- Visual Design: Global shader uniform for wind strength driving vertex displacement; dust/snow particle trails and cloth simulation.
- Behavioral Patterns: Wind gusts pulse with beat; dies during breakdowns.
- Audio: Filtered noise layer rising with BPM.

### Groove Gravity
- Description: Global gravity modulation based on swing/groove factor, easing over 1s when introduced.
- Gameplay Mechanics: Reduced gravity during swing makes enemies and objects floatier; "Groove Boots" share effect with player.
- Visual Design: Gravity multiplier on particle systems; subtle fisheye bottom-of-screen warp during low gravity.
- Behavioral Patterns: Announced by bubble pop on floating objects; enemies adopt dance-like movement during swing.
- Audio: Slight tape wow effect applied to ambient sounds.

### Spectrum Aurora
- Description: Multi-layered aurora representing melody channels; vertical position maps to pitch, color to harmonic function.
- Gameplay Mechanics: Visual cheat-sheet for upcoming notes; intersecting bands drop "Harmony Orbs" used for Chord Strike superweapon.
- Visual Design: Full-screen shader layers, additive blending, sine wave scrolling per layer, shimmer effect.
- Behavioral Patterns: Fade on muted channels; brightens on new notes; dissonant intervals spark red.
- Audio: Silent, but shimmer syncs with high-frequency content.

### Crescendo Fog
- Description: Volumetric fog density driven by mix energy ((active channels × average volume) / 128).
- Gameplay Mechanics: Fog affects AI sight, provides environment for "Fog Cutter" beam, and hides certain collectibles.
- Visual Design: Particle-based fog sprites with glowing interior at high density, depth fog, and BPM wind-driven swirl.
- Behavioral Patterns: Density ramps with crescendos and decays; lightning flashes at snare hits within fog.
- Audio: Muffled sounds via low-pass filter as density increases.

---

## Category 4: Advanced Shaders & Textures

### Waveform Water
- Description: Liquid surface that displaces vertices by master waveform data, creating bass-driven waves and treble ripples.
- Gameplay Mechanics: Surfing crests provides speed boosts; Waveform Harpoon anchors to frequency to pull the player.
- Visual Design: High-res displacement grid (100x50), screen-space reflections for peaks, refraction in troughs, foam particles at crests.
- Behavioral Patterns: Waves travel left-to-right at constant speed; flatten over 2s when music stops.
- Audio: Water movement is a granular synthesis of the waveform, creating a singing effect.

### Sample-Offset Glitch
- Description: Pixelation/glitch effect from Sample Offset command (9xx), with texture pixelation and vertex jitter.
- Gameplay Mechanics: Glitched objects become intangible briefly; Glitch Grenade causes local glitch enabling hidden pathways and double-loot crates.
- Visual Design: Vertex noise-based jitter, pixelation shader rounding UVs, RGB channel splitting, scanlines, simulated frame drops.
- Behavioral Patterns: Cooldown between glitch effects; stacked 9xx commands escalate effect.
- Audio: Digital crunch with bitcrushed noise.

### Chromatic Aberration Pulse
- Description: Full-screen chromatic RGB separation on heavy kicks (kick velocity > 100), with barrel distortion and a short screen freeze.
- Gameplay Mechanics: Temporal distortion of hitboxes; players can time Dodge Roll for invulnerability and an afterimage.
- Visual Design: Post-process sampling shifting RGB channels and radial gradient to drive intensity.
- Behavioral Patterns: Pulse triggers on heavy kicks, stacks with double kicks; suppressed in menus.
- Audio: Silent but creates the perception of a subwoofer press.

### Instrument-ID Textures
- Description: Procedural patterns generated based on Instrument ID, used for environmental pattern keys and puzzles.
- Gameplay Mechanics: Patterns are clues to unlock Instrument Shrines; matching patterns to the bassline instrument opens shrines and enables puzzles.
- Visual Design: Shader-based noise patterns in world-space with a parallax offset and smooth morphing between IDs.
- Behavioral Patterns: Patterns morph over 4 beats; animated during solos; trail reveals path when attached to moving objects.
- Audio: Scanning plays a brief instrument tag.

### Note-Trail Ribbons
- Description: 3D ribbons tracing the lead melody in real time, with height mapped to pitch, thickness to volume, and color to harmonic function.
- Gameplay Mechanics: Players grind along ribbons for speed/invulnerability; Ribbon Cutter severs ribbons into collectible "Melody Dust".
- Visual Design: Ribbon mesh extruded along pitch curve with gradient fade and sparkle particles; casts faint colored light.
- Behavioral Patterns: Ribbon head speed constant; dissolves after melody stops; forking during arpeggios.
- Audio: Silent; grinding creates a theremin tone.

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

### Phase 1: The Foundation (JS → TS) ✨
**Goal:** Establish strict data contracts so we can safely pack JS state into binary buffers later.

- **Setup TypeScript**
  - Add `tsconfig.json` at project root.
  - Start with `allowJs: true` to permit incremental migration.

- **Migrate Core Data Structures First**
  - Convert state/config files to TypeScript types/interfaces (e.g., `src/world/state.js`, `src/core/config.js`).
  - Reason: These files define the "shapes" of data; typing them clarifies what must be serialized for WASM.

- **Migrate Systems**
  - Move heavy systems like `src/systems/physics.js` and `src/audio/audio-system.js` to `.ts`.
  - Benefit: Catch missing properties and implicit type coercions early.

---

### Phase 2: The "Hot Path" Migration (TS → AssemblyScript/WASM) ⚙️
**Goal:** Push math-heavy, frequent computations off the main thread into WASM.

- **Identify Bottlenecks**
  - Procedural generation loops (e.g., nested loops in `generation`).
  - Physics collision checks (iterating `foliageClouds`, `obstacles`).

- **Port to AssemblyScript**
  - Move deterministic, math-heavy functions (e.g., `getGroundHeight`, collision checks) into `assembly/index.ts`.
  - Use flat arrays / pointers instead of JS objects for hot data.

- **Shared Memory Strategy**
  - Use `SharedArrayBuffer` or linear memory for entity positions: `Float32Array(EntityCount * 3)`.
  - WASM writes positions; JS reads for rendering (no per-frame copies).

---

### Phase 3: The Heavy Lifting (AssemblyScript → C++ / Emscripten) 🛠️
**Goal:** Use C++ where you need high-performance libraries, SIMD, or mature solvers.

- **When to prefer C++ over ASC**
  - Use ASC for game logic and easier TS-like code sharing.
  - Use C++ for complex solvers (rigid body physics, audio DSP, fluid solvers).

- **Example Flow**
  - Implement a fluid solver in C++ (using `std::vector`, SIMD intrinsics).
  - Compile with Emscripten to a side-module WASM and write results into the shared buffer the renderer reads.

---

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

**Notes & Priorities:**
- Start small with types and tests around the data shapes that must cross the JS/WASM boundary.
- Ensure regressions are detectable via unit/integration tests and small deterministic manifests.
- Prefer incremental changes and keep fallback paths during each phase to reduce risk.

Feel free to ask me to create the initial `tsconfig.json`, add type definitions for `src/world/state.js`, or draft an AssemblyScript skeleton for `getGroundHeight` next.

## Recent Progress & Next Steps
- **Accomplished:**
  - Integrated "Musical Ecosystem" plan into main documentation.
  - Analyzed "Cute Clay" concept art and implemented matched visuals for Mushrooms (Pastel palette, Cheeks, Matte finish).
  - Implemented "Retrigger Mushroom" reactivity (Bounce & Strobe) using the existing `animateFoliage` system for smooth decay.
  - Verified visual changes via Playwright screenshot.

- **Next Steps:**
  - **Arpeggio Ferns:** Implement the skeletal animation and "unfurl" logic for ferns.
  - **Kick-Drum Geysers:** Add particle plumes reactive to the kick channel.
  - **Migration:** Begin Phase 1 of the Technical Roadmap (JS -> TS for `src/world/state.js`).