# Project Plan: Musical Ecosystem Features

This document captures feature ideas for the Candy World musical ecosystem. The ideas are grouped into categories, each including a description, gameplay mechanics, visual design notes, behavioral patterns, and audio cues.

---

## Category 1: Melodic Flora (Pitch & Effect Reactive)

### Arpeggio Ferns
- **Status: Implemented ✅**
- Description: Crystalline ferns with segmented, glowing metal fronds that unfurl in quantized ticks synced to arpeggio effect speed (0xy).
- Gameplay Mechanics: Fully unfurled fronds create temporary platforms or block lasers. Players can ride the unfurl motion to launch upward.
- Visual Design: Skeletal animation with rigid-body physics. Glow peaks at ticks.
- Behavioral Patterns: Start furled until channel plays arpeggio; multiple ferns unfurl in a stair-step sequence.

### Portamento Pines
- **Status: Implemented ✅**
- Description: Towering antennae clusters made of copper alloy that bend with portamento (pitch slides).
- Gameplay Mechanics: Leaned-back pines act as slingshots.
- Visual Design: TSL vertex displacement shader bends the cylinder mesh based on `uBendStrength`.
- Behavioral Patterns: Reacts to "Melody" channel (Channel 2); bends in random directions on note triggers.

### Vibrato Violets
- **Status: Implemented ✅**
- Description: Bioluminescent flowers with vibrating membrane petals that shake with vibrato (4xx).
- Gameplay Mechanics: Vibration creates a frequency distortion field.
- Visual Design: Vertex shader sine-wave displacement and motion blur post-process.
- Behavioral Patterns: Bloom only with vibrato; amplitude increases with vibrato depth.

### Retrigger Mushrooms
- **Status: Implemented ✅**
- Description: Flat disc fungi with phosphorescent spore pods that strobe on/off with retrigger commands (Rxx/E9x).
- Gameplay Mechanics: Strobing applies retrigger to player's weapons.
- Visual Design: **"Cute Clay" Aesthetic** (Matte pastel colors, rosy cheeks, smiles) matching concept art (`image.png`). Features audio-reactive squash/stretch (bounce) and emissive strobing.
- Behavioral Patterns: Mushrooms dim until retrigger; nearby mushrooms sync strobes.

### Tremolo Tulips
- **Status: Implemented ✅**
- Description: Tall bell flowers that pulse scale and opacity with tremolo (7xx).
- Gameplay Mechanics: Max pulse turns interior into a portal.
- Visual Design: Sine-driven scale and opacity lerp; orbital particle vortex.
- Behavioral Patterns: Grow in groups with phase offsets.

---

## Category 2: Rhythmic Structures (Trigger & Volume Reactive)

### Cymbal Dandelions
- **Status: Implemented ✅**
- Description: Spherical clusters of metallic filaments that explode into floating seeds when high frequencies (>8kHz) trigger.
- Gameplay Mechanics: Seeds are collectible "Chime Shards".
- Visual Design: Burst particle system with physics-based drag.
- Behavioral Patterns: Static plants twitch with high frequencies; explosion force scales with cymbal velocity.

### Kick-Drum Geysers
- **Status: Implemented ✅**
- Description: Fissures that vent gas/plasma with force scaled by kick drum velocity.
- Gameplay Mechanics: Players can ride geyser plumes.
- Visual Design: Cylindrical plume mesh with flow map and emissive glow.
- Behavioral Patterns: Erupt on kick events with wind-up.

### Snare-Snap Trap
- **Status: Implemented ✅**
- Description: Jaw-like wall plants that snap shut on snare triggers.
- Gameplay Mechanics: Memorize patterns for safe passage.
- Visual Design: Spring-damper physics with snap, bounce, and ring-shaped shockwave.
- Behavioral Patterns: Grouped like drum fills; scale snap force by snare velocity.

### Panning Pads
- **Status: Implemented ✅**
- Description: Holographic lily pads floating on mercury pools that respond to stereo pan (8xx).
- Gameplay Mechanics: Jump on pads only when glowing; landing at bob peak gives horizontal boost.
- Visual Design: Sine-wave bob with pan-driven amplitude; radial glow shader.
- Behavioral Patterns: Pads in a stereo field; simultaneous pans can create seesaw effects.

### Silence Spirits
- **Status: Implemented ✅**
- Description: Translucent, starlight deer-like creatures spawn in breakdowns.
- Gameplay Mechanics: Commune for a 5s invisibility buff.
- Visual Design: Particle sprites, dissolve shader, emissive antlers casting long shadows.
- Behavioral Patterns: Herds of 2-5; avoid moving players; dissolve on beat drops.

---

## Category 3: Atmospheric & World (Global State)

### Sky & Celestial Enhancements
- **Status: Implemented ✅**
- **Multi-Band Gradient**: Replaced single-color fog with a 3-way gradient (Horizon, Bottom, Top).
- **Time-of-Day Palettes**: Defined specific palettes for Sunrise, Day, Sunset, and Night in `WeatherSystem`.
- **Enhanced Star Field**: 1500 stars with individual `size`, `offset`, and `starColor` attributes. Twinkling driven by TSL.
- **Sun Layers**: Composition of Glow, Corona, and God Rays.
- **Moon**: Implemented with Blink (squashing eyes) and Dance (bobbing) animations.

### Firefly Particles
- **Status: Implemented ✅**
- Description: GPU-driven particle system (`PointsNodeMaterial`) simulating firefly movement and blinking.

### Crescendo Fog
- **Status: Implemented ✅**
- Description: Volumetric fog density driven by mix energy (average volume).
- Implementation: Logic integrated into `WeatherSystem.updateFog()`.

### Pattern-Change Seasons
- **Status: Implemented ✅**
- Description: Global visual palette changes triggered by pattern commands (Dxx, Bxx).
- Implementation: `getCycleState` supports 'neon' and 'glitch' palette modes driven by song patterns.

### BPM Wind
- **Status: Implemented ✅**
- Description: Global wind vector scaled to BPM.
- Implementation: Global shader uniform for wind strength driving vertex displacement.

### Groove Gravity
- **Status: Implemented ✅**
- Description: Global gravity modulation based on swing/groove factor.
- Implementation: Gravity multiplier on particle systems.

### Spectrum Aurora
- **Status: Implemented ✅**
- Description: Multi-layered aurora representing melody channels.
- Implementation: TSL Shader with curtain/fold distortion and spectral color shifts.

---

## Category 4: Advanced Shaders & Textures

### Waveform Water
- **Status: Implemented ✅**
- Description: Liquid surface that displaces vertices by master waveform data.
- Implementation: TSL-driven `MeshStandardNodeMaterial` using `CandyPresets.SeaJelly`.

### Sample-Offset Glitch
- **Status: Implemented ✅**
- Description: Pixelation/glitch effect from Sample Offset command (9xx).
- Implementation: Global `uGlitchIntensity` uniform and `applyGlitch` TSL function.

### Chromatic Aberration Pulse
- **Status: Implemented ✅**
- Description: Full-screen chromatic RGB separation on heavy kicks.
- Implementation: Camera-attached lens distortion effect (`createKickOverlay`).

### Instrument-ID Textures
- **Status: Implemented ✅**
- Description: Procedural patterns generated based on Instrument ID.
- Implementation: `createInstrumentShrine` using procedural TSL patterns.

### Note-Trail Ribbons
- **Status: Implemented ✅**
- Description: 3D ribbons tracing the lead melody in real time.
- Implementation: `MelodyRibbon` in `src/foliage/ribbons.js` with dynamic Triangle Strip geometry.

---

## Category 5: Vertical Ecosystem

### Melody Lake
- **Status: Implemented ✅**
- Description: High-vertex plane at ground level with ripple shaders.
- Implementation: `src/foliage/water.js` using `MeshStandardNodeMaterial`.

### Cloud Hierarchy
- **Status: Implemented ✅**
- **Tier 1 (High/Solid)**: Large, dense, walkable platforms with collision meshes.
- **Tier 2 (Mid/Transitional)**: Smaller clouds/mist acting as elevators.
- Implementation: `src/foliage/clouds.js`.

### Bioluminescent Waterfalls
- **Status: Implemented ✅**
- Description: Viscous/Neon flow meshes connecting clouds and ground.
- Implementation: `src/foliage/waterfalls.js` using TSL materials with UV scrolling and splash particles.

---

## Recent Progress & Status Report

- **Concept Art Alignment**:
    - **Aesthetic**: Validated codebase against `image.png`, confirming "Cute Clay" aesthetics (rounded forms, pastel colors) are active.
    - **Character Features**: Implemented facial features (eyes, pupils, smile, rosy cheeks) on Mushrooms (`src/foliage/mushrooms.js`) matching the concept art.
    - **Palette**: Implemented "Cute Clay" material presets (Matte, Pastels).

- **Implementation Status**:
    - All major categories (Melodic Flora, Rhythmic Structures, Atmospheric, Advanced Shaders, Vertical Ecosystem) are **Implemented**.
    - **Moon Reactivity**: Implemented blink/dance behavior and Note-Color mapping in `src/core/config.js`.
    - **Inverse Day/Night**: Implemented in cycle logic.

- **Notes**:
    - **Population Density**: Increased procedural extras count to `400` (intermediate target) to improve world density.
    - **Lake Features**: Implemented `createIsland` (island mesh with creek path) and integrated into `src/world/generation.ts`.

## Next Steps

1.  **Population Scale-Up**: `extrasCount` increased to 400. Verified via `verification/verify_lake_features.spec.ts`.
2.  **Lake Features**: Completed `createIsland` and world integration.
3.  **Migrate to TypeScript**: Continue Phase 1 of the migration roadmap (converting JS files to TS).
3.  **Fine-Tune Glitch Triggers**: Currently mapped to Retrigger/Arpeggio. Explore exposing raw `9xx` commands.
4.  **Optimize Ribbons**: Move to GPU-based trail renderer if performance drops.

---

## Bug Fix: TSL getNodeType Error (January 2026)

*Resolved `Uncaught TypeError: i.getNodeType is not a function` by ensuring `uniform()` receives Three.js objects (Vector3, Color) instead of TSL nodes.*
