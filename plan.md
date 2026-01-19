# Master Plan: Candy World 🍬

**Objective:** Create an immersive, audio-reactive 3D world with a "Cute Clay" aesthetic, featuring a robust musical ecosystem and advanced WebGPU visuals.

## Current Focus
**Phase:** Feature Implementation (Musical Ecosystem)
**Priority:** High (Category 4: Advanced Shaders / Category 1-3 Wrap-up)

---

## Next Steps

1. **Migrate Systems (Phase 1)**: Continue migrating key systems to TypeScript (e.g., `src/systems/interaction.js` or `src/audio/audio-system.js`) to improve type safety.

---

## Recent Progress
- **Accomplished:**
  - **Rare Flora Discovery (Unlock system)**: **Status: Implemented ✅**
    - *Implementation Details:* Integrated discovery logic into `src/systems/physics.ts`. Checks player proximity (radius 5.0) to registered `animatedFoliage` objects every 10 frames. Triggers `discoverySystem.discover()` using a separated mapping file (`src/systems/discovery_map.ts`) which defines display names and icons for all rare flora types. Verified via `verification/test_discovery.js`.
  - **Migrate Core Data Structures (Phase 1)**: **Status: Implemented ✅**
    - *Implementation Details:* Converted `src/core/config.js` to `src/core/config.ts` and defined comprehensive TypeScript interfaces (`ConfigType`, `PaletteEntry`) for configuration objects. Updated all import references to use standard module resolution.
  - **Migrate Physics System (Phase 1)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/world/state.js` to `src/world/state.ts` and `src/systems/physics.js` to `src/systems/physics.ts`. Added strict typing for player state, key states, and foliage objects. Preserved logic for C++/WASM physics integration and fixed potential regression in Vine Swing camera synchronization.
  - **Plants Twilight Glow**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented `uTwilight` global uniform in `src/foliage/sky.js` driven by `WeatherSystem`. Updated TSL materials for Flowers, Mushrooms, and Fiber Optic Trees to accept this uniform and boost emissive intensity during twilight hours.
  - **Verify Data Flow**: **Status: Implemented ✅**
    - *Implementation Details:* Fixed `public/js/audio-processor.js` to correctly send `order` and `row` data from the audio worklet to the main thread, and updated `AudioSystem` to store this data for use by the Weather/Pattern systems.
  - **Subwoofer Lotus**: Implemented `src/foliage/lotus.js` featuring TSL-driven bass-reactive "Speaker Rings" that pulse with `uAudioLow` and a "Glitch Portal" center that activates with `uGlitchIntensity`.
  - **Advanced Collision**: Implemented WASM-based narrow phase collision detection using a Spatial Grid (Linked List) optimization to handle 2000+ objects efficiently.
  - **Rare Flora Discovery (Initial)**: Implemented `src/systems/discovery.js` and integrated with `src/systems/physics.js`. Tracks player interactions with environmental features (Vine Swing, Trampoline, Cloud Platform) and triggers a toast notification on first discovery. Persistence handled via localStorage.
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
  - **Migrate InteractionSystem (Phase 1)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/systems/interaction.js` to `src/systems/interaction.ts`. Added strict typing for `InteractiveObject`, `ReticleCallback`, and system logic. Replaced legacy Sets with typed `Set<InteractiveObject>` and optimized double-buffered update loop. Updated `main.js` to import the new TypeScript module.

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
  - [x] Plants Twilight Glow (Bioluminescence)
    - *Implementation Details:* Implemented `uTwilight` global uniform in `src/foliage/sky.js` driven by `WeatherSystem`'s day/night cycle. Updated TSL materials for Flowers, Mushrooms, and Fiber Optic Trees to accept this uniform and boost emissive intensity during twilight hours.

### Category 5: Physics & Interaction
- **Status:** Pending
- **Tasks:**
  - [x] Rare Flora Discovery (Unlock system)
    - *Implementation Details:* Implemented proximity-based discovery logic in `src/systems/physics.ts` using a throttled check against `animatedFoliage` objects and a decoupled data map in `src/systems/discovery_map.ts`.
  - [x] Advanced Collision (WASM-based narrow phase)
     - *Implementation Details:* Implemented Spatial Grid (16x16) in AssemblyScript to optimize collision detection from O(N) to O(1) for nearby objects. Handles Mushrooms, Clouds, Gates, and Trampolines.
  - [x] Player Abilities (Dash, Double Jump extensions)
    - *Implementation Details:* Added Double Jump (air jump) and Dash (horizontal impulse) abilities to `src/systems/physics.js`.
      - **Double Jump:** Allows one extra jump in mid-air (reset on ground). Triggers `ability_double_jump` discovery.
      - **Dash:** Instant velocity boost in camera direction (mapped to 'E'). Cooldown 1s. Triggers `ability_dash` discovery.
      - **Visuals:** Triggers a chromatic aberration pulse (`uChromaticIntensity`) on use.
  - **Plants Twilight Glow**: Implemented logic for plants to glow during twilight hours (pre-dawn/dusk).
    - *Implementation Details:* Added `uTwilight` global uniform to `src/foliage/sky.js` and integrated it into the TSL material pipeline for Flowers, Mushrooms, and Trees. The glow intensity ramps up at dusk and down at dawn, driven by the `WeatherSystem`.

---

## Migration Roadmap (Summary)
1. **Phase 1 (JS -> TS):** Typing core data structures and systems. [IN PROGRESS]
2. **Phase 2 (TS -> ASC):** Offloading hot paths to WASM.
3. **Phase 3 (ASC -> C++):** Specialized solvers.
4. **Phase 4 (Three.js -> WebGPU):** Raw compute and render pipelines.
