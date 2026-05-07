# Master Archive: Completed Features 🍬

This document contains all the completed features, enhancements, and migrations that have been successfully implemented and verified for Candy World.

## Musical Ecosystem

### Category 0: Expanded Scenes

- **The Arpeggio Grove**: Expanded Scene: A clearing in the Crystalline Nebula featuring a Subwoofer Lotus surrounded by twelve Arpeggio Ferns, a Spectrum Aurora overhead, and reactive environmental features like Vibrato Violets and Kick-Drum Geysers. The Spectrum Aurora visually signals harmonic collisions and drops Harmony Orbs for a Chord Strike superweapon. Crescendo Fog, BPM Wind, and Vibrato Violets shape visibility and projectile behavior mid-combat. Snare-Snap Traps and timed geyser eruptions provide rhythm-based puzzles and traversal mechanics. Secrets: Glitching the Subwoofer Lotus (9xx) during a breakdown reveals a hidden Bass Portal leading to a waveform bonus stage.


### Category 1: Melodic Flora (Pitch & Effect Reactive)
- **Arpeggio Ferns**: Crystalline ferns with segmented, glowing metal fronds that unfurl in quantized ticks synced to arpeggio effect speed (0xy).
- **Portamento Pines**: Towering antennae clusters made of copper alloy that bend with portamento (pitch slides), using a spring motion.
- **Vibrato Violets**: Bioluminescent flowers with vibrating membrane petals that shake with vibrato (4xx), driven by a vertex shader. Frequency distortion field (20m radius) causes enemy projectiles to zigzag.
- **Retrigger Mushrooms**: Flat disc fungi with phosphorescent spore pods that strobe on/off with retrigger commands (Rxx/E9x). Proximity-based full-screen strobe effect based on channel 5 retrigger effects.
- **Tremolo Tulips**: Tall bell flowers that pulse scale and opacity with tremolo (7xx), with an interior vortex of light. Harvest "Tremolo Bulbs" for a phase-shift ability.

### Category 2: Rhythmic Structures (Trigger & Volume Reactive)
- **Cymbal Dandelions**: Spherical clusters of metallic filaments that explode into floating seeds when high frequencies (>8kHz) trigger. Seeds are collectible "Chime Shards".
- **Kick-Drum Geysers**: Fissures that vent gas/plasma with force scaled by kick drum velocity, producing tall plumes and vertical propulsion.
- **Snare-Snap Trap**: Jaw-like wall plants that snap shut on snare triggers, creating a shockwave and reflecting projectiles.
- **Panning Pads**: Holographic lily pads floating on mercury pools that respond to stereo pan (8xx) and channel volume.
- **Silence Spirits**: Translucent, starlight deer-like creatures spawn in breakdowns with low master volume / channel count. Commune for a 5s invisibility buff.
- **Chord Strike**: Superweapon using Harmony Orbs spawned during harmonic collisions. Consumes 3 Orbs (via Key V) and fires a massive, TSL-driven vertical plasma beam.

### Category 3: Atmospheric & World (Global State)
- **Sky & Celestial Enhancements**: Multi-Band Gradient, Time-of-Day Palettes, Enhanced Star Field (1500 stars + Twinkle), Sun Layers, Atmospheric Scattering.
- **Firefly Particles**: GPU-driven particle system simulating firefly movement and blinking.
- **Crescendo Fog**: Volumetric fog density driven by mix energy (average volume).
- **Pattern-Change Seasons**: Global visual palette changes triggered by pattern commands (Dxx, Bxx), instantly or blending over time.
- **BPM Wind**: Global wind vector scaled to BPM that affects particles, foliage, projectiles, and cloth.
- **Groove Gravity**: Global gravity modulation based on swing/groove factor, easing over 1s when introduced.
- **Spectrum Aurora**: Multi-layered aurora representing melody channels; vertical position maps to pitch, color to harmonic function.
- **Wisteria Clusters**: Hanging wisteria vines with organic sway animated by uTime and modulated by high frequency audio (uAudioHigh).

### Category 4: Advanced Shaders (WebGPU TSL)
- **Waveform Water**: Liquid surface that displaces vertices by master waveform data (simulated via TSL sine summation modulated by audio energy).
- **Sample-Offset Glitch**: Pixelation/glitch effect from Sample Offset command (9xx), with texture pixelation and vertex jitter. Glitch Grenade causes local glitch.
- **Chromatic Aberration Pulse**: Full-screen chromatic RGB separation on heavy kicks (kick velocity > 100), with barrel distortion and a short screen freeze.
- **Instrument-ID Textures**: Procedural noise patterns generated based on Instrument ID, used for environmental pattern keys and puzzles.
- **Note-Trail Ribbons**: 3D ribbons tracing the lead melody in real time, with height mapped to pitch, thickness to volume, and color to harmonic function.
- **Melody Mirrors**: TSL-driven faux reflection using a procedural environment texture, with UV distortion driven by audio intensity and time.
- **Subwoofer Lotus**: TSL material logic for bass-driven vertex displacement (rings) and a swirling vortex portal that activates via uGlitchIntensity or high bass. Bass Portal Secret reveals a hidden portal.
- **Plants Twilight Glow**: Bioluminescence for plants to glow during twilight hours (pre-dawn/dusk).
- **Fluid Fog (C++ Simulation)**: C++ Stable Fluids solver coupled with TSL fog visualization.
- **Waveform Harpoon**: Projectiles anchor to Waveform Water, pulling the player using audio-modulated speed, visualized with a dynamic TSL line.

### Category 5: Physics & Interaction
- **Advanced Collision**: WASM-based narrow phase collision detection using a Spatial Grid (Linked List) optimization to handle 2000+ objects efficiently.
- **Player Abilities**: Dash ('E') and Double Jump mechanics with visual feedback (chromatic pulse). Dodge Roll Ability bound to 'X' key, granting temporary intangibility. Phase Shift ability triggered by 'Z' key.
- **Instrument Shrine Puzzles**: Interactive puzzles where shrines detect if their matching instrument ID is active in the audio mix.
- **Rare Flora Discovery**: Proximity-based discovery logic using a throttled check against animatedFoliage objects. Visual Discovery Log UI accessible via 'L' key.

### Category 6: Environmental Discoveries
- **Melody Lake Island**: A floating island with a stylized creek path found in the middle of a lake basin.
- **Crystal Cave & Harmonic Waterfall**: Large enclosed structures generated procedurally with stalactites, stalagmites, and an inner waterfall. Bioluminescent glow from within.

## Migration Roadmap Features

### Phase 1 (JS -> TS)
- Typing core data structures and systems (`src/world/state.ts`, `src/core/config.ts`, `src/systems/physics.ts`, `src/systems/weather.ts`, `src/audio/audio-system.ts`).
- Foliage Modules (`clouds`, `cave`, `stars`, `rainbow`, `moon`, `waterfalls`, `celestial-bodies`, `glitch`, `chromatic`, `panning-pads`, `silence-spirits`, `ribbons`, `sparkle-trail`, `lotus`, `aurora`, `impacts`, `instrument`).
- Core Modules (`src/core/input.ts`, `src/core/cycle.ts`).
- InteractionSystem & DiscoverySystem.

### Phase 2 (TS -> ASC)
- Optimized procedural world generation by moving collision/placement validation to AssemblyScript (WASM).

### Phase 3 (ASC -> C++)
- Fluid Simulation implemented via a 2D "Stable Fluids" solver in C++ compiled to WASM.
- Animation Batch SIMD Vectorization (`batchSnareSnap_c`, `batchAccordion_c`, `batchTremoloPulse_c`, `batchFiberWhip_c`, `batchSpiralWave_c`, `batchVibratoShake_c`, `batchCymbalShake_c`, `batchPanningBob_c`, `batchSpiritFade_c`).

### Phase 4 (Three.js -> WebGPU)
- Fireflies Compute Shader utilizing StorageBufferAttribute.
- Wind Computation System (WebGPU Compute Shader).
- Migrated custom render passes and unmigrated `src/foliage/lake_features.js` to `src/foliage/lake_features.ts` using TSL.
- Migrated `src/foliage/environment.ts`, `src/foliage/celestial-bodies.ts`, `src/foliage/moon.ts`, and `src/foliage/trees.ts` to use TSL MeshStandardNodeMaterial, MeshBasicNodeMaterial, and PointsNodeMaterial.
