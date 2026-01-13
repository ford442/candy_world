# Master Plan: Candy World 🍬

**Objective:** Create an immersive, audio-reactive 3D world with a "Cute Clay" aesthetic, featuring a robust musical ecosystem and advanced WebGPU visuals.

## Current Focus
**Phase:** Feature Implementation (Musical Ecosystem)
**Priority:** High (Category 4: Advanced Shaders / Category 1-3 Wrap-up)

---

## Next Steps

1. **Migrate to TypeScript**: Begin Phase 1 of the migration roadmap to harden the codebase before adding more complex systems.
2. **Plants Twilight Glow**: Implement logic for plants to glow during twilight hours (pre-dawn/dusk) as described in `plan-moon-music-reactivity.md`.

---

## Recent Progress
- **Accomplished:**
  - **Verify Data Flow**: **Status: Implemented ✅**
    - *Implementation Details:* Fixed `public/js/audio-processor.js` to correctly send `order` and `row` data from the audio worklet to the main thread, and updated `AudioSystem` to store this data for use by the Weather/Pattern systems.
  - **Subwoofer Lotus**: Implemented `src/foliage/lotus.js` featuring TSL-driven bass-reactive "Speaker Rings" that pulse with `uAudioLow` and a "Glitch Portal" center that activates with `uGlitchIntensity`.
  - **Advanced Collision**: Implemented WASM-based narrow phase collision detection using a Spatial Grid (Linked List) optimization to handle 2000+ objects efficiently.
  - **Rare Flora Discovery**: Implemented `src/systems/discovery.js` and integrated with `src/systems/physics.js`. Tracks player interactions with environmental features (Vine Swing, Trampoline, Cloud Platform) and triggers a toast notification on first discovery. Persistence handled via localStorage.
  - **Spectrum Aurora**: Implemented `src/foliage/aurora.js` using TSL, featuring audio-reactive intensity and spectral color shifts. Integrated into `main.js`.
  - Integrated "Musical Ecosystem" plan into main documentation.
  - Analyzed "Cute Clay" concept art and implemented matched visuals for Mushrooms (Pastel palette, Cheeks, Matte finish).
  - **Sky Enhancements**: Implemented Multi-Band Gradients, Time-of-Day Palettes, Enhanced Stars (1500 count + Twinkle), and Sun God Rays.
  - **Environment**: Implemented Fireflies, BPM Wind, and Groove Gravity.
  - **Crescendo Fog**: Integrated audio-volume-driven fog density into the Weather System.
  - Implemented "Retrigger Mushroom" reactivity (Bounce & Strobe) using the existing `animateFoliage` system.
  - Implemented "Arpeggio Ferns" skeletal animation (unfurl).
  - Implemented "Kick-Drum Geysers" particle plumes reactive to kick intensity.
  - Implemented "Snare-Snap Traps" with jaw animation driven by snare channel.
  - **Rainbow After Storm**: Implemented procedural TSL rainbow arc that appears when storms clear.
  - **Mushroom Emission**: Added animated pulsing stripes to Giant Mushrooms using TSL.
  - **Vine Swinging**: Refined physics with "pumping" mechanics and safety clamping.
  - **Tremolo Tulips**: Implemented `createTremoloTulip` with `tremeloPulse` animation and TSL vortex materials.
  - **Cymbal Dandelions**: Implemented `createCymbalDandelion` with `cymbalShake` animation and particle explosion logic.
  - **Procedural Generation**: Added new musical flora (Tulips, Dandelions) to procedural extras spawning logic.
  - **Waveform Water**: Implemented `src/foliage/water.js` featuring a TSL-driven, audio-reactive water surface.
  - **Panning Pads**: Implemented `src/foliage/panning-pads.js` with mercury-like TSL materials and stereo-pan driven bobbing animation.
  - **Silence Spirits**: Implemented `src/foliage/silence-spirits.js` with volume-reactive AI.
  - **Pattern-Change Seasons**: Implemented global palette shifts triggered by music patterns.
  - **Instrument-ID Textures**: Implemented `createInstrumentShrine` in `src/foliage/instrument.js`.
  - **Portamento Pines**: Implemented `src/foliage/pines.js` with TSL vertex displacement.
  - **Sample-Offset Glitch**: Implemented TSL shader for glitch effect (`src/foliage/glitch.js`).
  - **Chromatic Aberration Pulse**: Implemented TSL-based full-screen distortion (`src/foliage/chromatic.js`).
  - **Note-Trail Ribbons**: Implemented `src/foliage/ribbons.js` featuring dynamic 3D ribbons that trace the melody (channel 2). The ribbon extrusion height is driven by pitch, and width by volume. Rendered with TSL gradient and sparkle effects.
  - **Player Abilities**: Implemented Dash ('E') and Double Jump mechanics in `src/systems/physics.js` with visual feedback (chromatic pulse) and discovery tracking.

---

## Plan Categories

### Category 4: Advanced Shaders (WebGPU TSL) [IN PROGRESS]
- **Status:** Active
- **Tasks:**
  - [x] Waveform Water (Displacement based on simulated waveform)
  - [x] Sample-Offset Glitch (Screen-space UV manipulation)
  - [x] Chromatic Aberration Pulse (Lens distortion on heavy kicks)
  - [x] Instrument-ID Textures (Procedural noise patterns)
  - [x] Note-Trail Ribbons (Melody tracing geometry)
  - [x] Melody Mirrors (Fake reflection shaders)
    - *Implementation Details:* TSL-driven faux reflection using a procedural environment texture, with UV distortion driven by audio intensity (`uAudioHigh`) and time. Geometry consists of floating shard clusters integrated into `src/world/generation.ts`.
  - [x] Subwoofer Lotus (Bass & Glitch Reactive)
    - *Implementation Details:* TSL material logic for bass-driven vertex displacement (rings) and a swirling vortex portal that activates via `uGlitchIntensity` or high bass.

### Category 5: Physics & Interaction
- **Status:** Pending
- **Tasks:**
  - [x] Rare Flora Discovery (Unlock system)
  - [x] Advanced Collision (WASM-based narrow phase)
     - *Implementation Details:* Implemented Spatial Grid (16x16) in AssemblyScript to optimize collision detection from O(N) to O(1) for nearby objects. Handles Mushrooms, Clouds, Gates, and Trampolines.
  - [x] Player Abilities (Dash, Double Jump extensions)
    - *Implementation Details:* Added Double Jump (air jump) and Dash (horizontal impulse) abilities to `src/systems/physics.js`.
      - **Double Jump:** Allows one extra jump in mid-air (reset on ground). Triggers `ability_double_jump` discovery.
      - **Dash:** Instant velocity boost in camera direction (mapped to 'E'). Cooldown 1s. Triggers `ability_dash` discovery.
      - **Visuals:** Triggers a chromatic aberration pulse (`uChromaticIntensity`) on use.

---

## Migration Roadmap (Summary)
1. **Phase 1 (JS -> TS):** Typing core data structures and systems. [NEXT]
2. **Phase 2 (TS -> ASC):** Offloading hot paths to WASM.
3. **Phase 3 (ASC -> C++):** Specialized solvers.
4. **Phase 4 (Three.js -> WebGPU):** Raw compute and render pipelines.
