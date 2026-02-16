# Master Plan: Candy World 🍬

**Objective:** Create an immersive, audio-reactive 3D world with a "Cute Clay" aesthetic, featuring a robust musical ecosystem and advanced WebGPU visuals.

## Current Focus
**Phase:** Feature Implementation (Musical Ecosystem)
**Priority:** High (Category 4: Advanced Shaders / Category 1-3 Wrap-up)

---

## Next Steps

1. **Rare Flora Discovery**: Implement the discovery system for rare plants (Next Priority).
2. **Verify Data Flow**: Ensure `AudioSystem` correctly extracts and passes `order`/`row` data from the worklet to drive the Pattern-Change logic reliably.

---

## Recent Progress
- **Accomplished:**
  - **Cymbal Dandelion Harvesting**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented `harvest(batchIndex)` in `src/foliage/dandelion-batcher.ts` to hide seeds of harvested dandelions. Updated `src/foliage/musical_flora.ts` to trigger harvesting on interaction, awarding 'chime_shard' items and spawning 'spore' impact particles. Enhanced `createCandyMaterial` type safety.
  - **Migrate to TypeScript (Phase 1): Remaining Foliage Modules (`glitch`, `chromatic`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/glitch.js` and `src/foliage/chromatic.js` to TypeScript. Added strict typing for TSL nodes and shader uniforms. Updated `UnifiedMaterialOptions` in `src/foliage/common.ts` to support `emissive` properties, fixing a regression in Jitter Mines. Removed `src/foliage/pines.js` as it was dead code superseded by `src/foliage/portamento-batcher.ts`.
  - **Migrate to TypeScript (Phase 1): Visual Effects (`panning-pads`, `silence-spirits`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/panning-pads.js` and `src/foliage/silence-spirits.js` to TypeScript (`.ts`). Added strict typing for `PanningPadOptions`, `SilenceSpiritOptions`, and exported `UnifiedMaterialOptions` from `src/foliage/common.ts` for better type reuse. Updated `src/foliage/index.ts` exports.
  - **Migrate to TypeScript (Phase 1): Visual Effects (`ribbons`, `sparkle-trail`, `lotus`, `aurora`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/ribbons.js`, `src/foliage/sparkle-trail.js`, `src/foliage/lotus.js`, and `src/foliage/aurora.js` to TypeScript (`.ts`). Added strict typing for `RibbonUserData`, `SparkleTrailUserData`, `LotusOptions` and TSL nodes. Updated `src/foliage/index.ts` exports. Verified file presence and imports.
  - **Migrate to TypeScript (Phase 1): Core Effects (`impacts`, `instrument`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/impacts.js` and `src/foliage/instrument.js` to TypeScript (`.ts`). Added strict typing for `ImpactConfig`, `ImpactType`, and `InstrumentShrineOptions`. Updated imports in dependent files (`berries.ts`, `animation.ts`, `rainbow-blaster.ts`, etc.) to point to the new TypeScript modules.
  - **Instrument Shrine Puzzle Mechanics**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented interactive puzzle logic for Instrument Shrines in `src/foliage/instrument.js` and `src/foliage/animation.ts`. Shrines now detect active audio channels and "unlock" (with visual feedback and rewards) when the matching instrument ID is playing. Added 'Shrine Master' unlock to `src/systems/unlocks.ts` requiring collected shrine tokens.
  - **Panning Pads**: **Status: Implemented ✅**
    - *Implementation Details:* Created `src/foliage/panning-pads.js` with TSL mercury materials and stereo-pan driven bobbing animation (`panningBob` in `src/foliage/animation.ts`). Implemented physics interaction in `src/systems/physics.ts` to provide a vertical boost when landing on a pad at the peak of its bob (driven by audio pan/volume). Added to world generation in `src/world/generation.ts`.
  - **Jitter Mines**: **Status: Implemented ✅**
    - *Implementation Details:* Created `src/gameplay/jitter-mines.ts` utilizing `THREE.InstancedMesh` for efficient rendering of unstable, glitching mines. Mines are spawned via the 'F' key (Action) and explode on proximity, triggering a global TSL-driven chromatic aberration and glitch pulse (`uChromaticIntensity`, `uGlitchIntensity`). Integrated with `UnlockSystem` (consumes "Vibrato Nectar") and `src/foliage/flowers.ts` (harvesting logic for Vibrato Violets).
  - **Arpeggio Shield**: **Status: Implemented ✅**
    - *Implementation Details:* Created `src/foliage/shield.ts` using TSL for a crystalline, audio-reactive icosahedron (transmission, iridescence). Integrated with `src/systems/unlocks.ts` to instantiate the shield on the player when unlocked.
  - **Rare Flora Unlocks (Harvesting System)**: **Status: Implemented ✅**
    - *Implementation Details:* Created `src/systems/unlocks.ts` to manage inventory ("Fern Cores") and persistent unlocks ("Arpeggio Shield"). Integrated with `src/foliage/musical_flora.ts` to allow harvesting Arpeggio Ferns when they are fully unfurled. Added visual/UI feedback via `showToast` and updated interaction text.
  - **Phase 1 (JS -> TS): Gameplay Modules (`musical_flora`, `environment`, `rainbow-blaster`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/musical_flora.js`, `src/foliage/environment.js`, and `src/gameplay/rainbow-blaster.js` to TypeScript. Added strict typing for options interfaces and TSL nodes. Updated imports in `main.js`, `src/foliage/index.ts`, and `public/js/perf_instancing.js`. Verified build via `vite build`.
  - **Phase 1 (JS -> TS): Foliage Modules (`clouds`, `cave`, `stars`, `rainbow`, `moon`, `waterfalls`, `celestial-bodies`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated 7 foliage modules from JavaScript to TypeScript (`.ts`). Renamed `src/foliage/index.js` to `index.ts` and updated exports. Consolidated imports in `src/systems/weather.ts`, `src/world/generation.ts`, and `main.js`. Added strict typing for creation options and TSL uniforms. Verified build integrity via `vite build`.
  - **Phase 1 (JS -> TS): Core Modules (`src/core/input.ts`, `src/core/cycle.ts`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/core/input.js` and `src/core/cycle.js` to TypeScript. Added strict typing for `KeyStates`, `PaletteEntry`, `SeasonalState`, and system interaction callbacks. Updated dependent files (`main.js`, `weather.ts`, `rainbow-blaster.js`) to use correct imports. Verified logic with `verification/verify_input_logic.mjs`.
  - **Phase 1 (JS -> TS): Foliage Cleanup**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/berries.js` and `src/foliage/mushrooms.js` to TypeScript (`.ts`). Added strict typing for `BerryClusterOptions` and `MushroomOptions`. Deleted dead code `src/foliage/trees.legacy.js` as its functionality is fully superseded by `src/foliage/trees.ts`. Updated `MushroomOptions` to support `isBioluminescent` for compatibility with WeatherSystem.
  - **Phase 1 (JS -> TS): Foliage Core Migration**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/common.js` (the central TSL material factory), `src/foliage/grass.js`, and `src/foliage/flowers.js` to TypeScript (`.ts`). Added strict typing for TSL nodes, material options, and geometry helpers. Updated 35+ dependent files to import from the new `.ts` modules. Verified build integrity via `vite build`.
  - **Phase 1 (JS -> TS): Foliage Migration**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/sky.js`, `src/foliage/water.js`, and `src/foliage/mirrors.js` to TypeScript (`.ts`). Added strict typing for uniforms, function arguments, and return types. Updated `src/foliage/index.js` exports.
  - **Phase 4 (Three.js -> WebGPU): Fireflies Compute Shader**: **Status: Implemented ✅**
    - *Implementation Details:* Replaced legacy CPU/Vertex-shader fireflies with a raw WebGPU Compute Pipeline (`src/foliage/fireflies.ts`). Utilized `StorageBufferAttribute` for position/velocity/anchor state and a TSL Compute Node for physics (Spring force, Noise wander, Audio repulsion, Player interaction). Integrated `renderer.compute()` into the main render loop.
  - **Phase 3 (ASC -> C++): Fluid Simulation**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented a 2D "Stable Fluids" solver in C++ (`emscripten/fluid.cpp`) compiled to WASM via Emscripten. Created `FluidSystem` in TypeScript to bridge the WASM simulation with the render loop, injecting audio energy (Kick/Highs) into density/velocity fields. Visualized via `FluidFog` (`src/foliage/fluid_fog.js`) using a TSL `MeshBasicNodeMaterial` that samples the simulation density texture.
  - **Phase 2 (TS -> ASC)**: **Status: Implemented ✅**
    - *Implementation Details:* Optimized procedural world generation by moving collision/placement validation to AssemblyScript (WASM). Implemented `checkPositionValidity` in `assembly/physics.ts` using a spatial grid (O(1) lookup) to replace the legacy O(N) JavaScript loop. Increased `MAX_COLLISION_OBJECTS` to 4096 to support larger worlds. Updated `src/world/generation.ts` to utilize the new WASM pipeline.
  - **Migrate WeatherSystem (Phase 1)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/systems/weather.js` to `src/systems/weather.ts`. Defined strict interfaces (`WeatherState`) and typed class properties. Utilized `VisualState` from `src/audio/audio-system.ts` for type-safe audio data handling. Updated `main.js` to import the new TypeScript module.
  - **Migrate AudioSystem (Phase 1)**: **Status: Implemented ✅**
    - *Implementation Details:* Converted `src/audio/audio-system.js` to `src/audio/audio-system.ts`. Defined strict interfaces (`VisualState`, `ChannelData`, `ModuleInfo`) and typed class properties. Preserved audio worklet loading logic and legacy helper functions. Updated `main.js` and `src/audio/beat-sync.ts` to use the new TypeScript module.
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
  - **Migrate DiscoverySystem (Phase 1)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/systems/discovery.js` to `src/systems/discovery.ts`. Added strict typing for discovered items and storage keys. Updated `src/systems/physics.ts` to import the typed module correctly, removing legacy `@ts-ignore` directives. Confirmed build stability by fixing unrelated broken imports in foliage modules (`sky.js` -> `sky.ts`).

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
  - [x] Fluid Fog (C++ Simulation)
    - *Implementation Details:* Implemented C++ Stable Fluids solver coupled with TSL fog visualization.

### Category 5: Physics & Interaction
- **Status:** Active
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
  - [x] Phase Shift Ability & Tremolo Harvesting
    - *Implementation Details:* Implemented `Phase Shift` ability (invulnerability/speed boost) in `src/systems/physics.ts` triggered by 'Z' key. Requires and consumes 'Tremolo Bulb'. Added harvesting logic to `Tremolo Tulips` in `src/foliage/flowers.ts`.
  - [x] Instrument Shrine Puzzles
    - *Implementation Details:* Implemented interactive logic where shrines detect if their matching instrument ID is active in the audio mix. Unlocking triggers a visual burst and rewards a 'Shrine Token'.
  - **Plants Twilight Glow**: Implemented logic for plants to glow during twilight hours (pre-dawn/dusk).
    - *Implementation Details:* Added `uTwilight` global uniform to `src/foliage/sky.js` and integrated it into the TSL material pipeline for Flowers, Mushrooms, and Trees. The glow intensity ramps up at dusk and down at dawn, driven by the `WeatherSystem`.

---

## Migration Roadmap (Summary)
1. **Phase 1 (JS -> TS):** Typing core data structures and systems. [IN PROGRESS]
2. **Phase 2 (TS -> ASC):** Offloading hot paths to WASM. [DONE]
3. **Phase 3 (ASC -> C++):** Specialized solvers.
4. **Phase 4 (Three.js -> WebGPU):** Raw compute and render pipelines.
