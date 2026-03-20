# Master Plan: Candy World 🍬

**Objective:** Create an immersive, audio-reactive 3D world with a "Cute Clay" aesthetic, featuring a robust musical ecosystem and advanced WebGPU visuals.

## Current Focus
**Phase:** Feature Implementation (Musical Ecosystem / Graphics Polish)
**Priority:** High (Category 4: Advanced Shaders / Category 1-3 Wrap-up)

---

## Next Steps

1. **Phase 4 (Three.js -> WebGPU)**: Raw compute and render pipelines. Begin migrating custom render passes.
2. **Phase 3 (ASC -> C++): Fluid Simulation**: Polish the stable fluids solver and WebGPU integration.

---

## Recent Progress
- **Accomplished:**
  - **WebGPU Migration (Phase 4): Wind Computation System (WebGPU Compute Shader)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `WindComputeSystem` from a CPU-based 2D noise generator that partially updated a `Float32Array` into a fully TSL-driven WebGPU Compute Shader writing to a `StorageTexture`. All pixels (256x256) update simultaneously per frame. Rewrote noise and gust formulas with `mx_noise_float` and math nodes. Interfaced compute dispatch directly into `src/main.ts`'s render loop.
  - **Category 6: Melody Lake Island**: **Status: Implemented ✅**
    - *Implementation Details:* Ensured the island is fully interactive by making the central Retrigger Mushroom harvestable. Added logic in `src/world/generation.ts` to wrap it with `makeInteractive`, allowing players to harvest a "Lake Core". Added the `island_scholar` unlock definition in `src/systems/unlocks.ts`.
  - **Category 1: Retrigger Mushrooms (Strobe Sickness)**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented the "Strobe Sickness" HUD flicker effect in `src/systems/physics.ts`. Players within 15 units of an actively strobing Retrigger Mushroom will experience rapid random pulses of chromatic aberration. Added `strobe_sickness` to the discovery map.
  - **Category 2: Cymbal Dandelions (Sonic Clap)**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented the "Sonic Clap" mechanic bound to the 'C' key. Emits a localized pulse that manually triggers nearby Cymbal Dandelions to explode into collectable 'Chime Shards' using `dandelionBatcher.harvest()` and `spawnDandelionExplosion`. Added `ability_sonic_clap` to the discovery map.
  - **Category 1: Retrigger Mushrooms (Strobe Sickness HUD Flicker)**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented TSL-driven full-screen strobe overlay in `src/foliage/strobe.ts` and proximity-based activation in `src/systems/physics.ts` reactive to channel effect 5 (Retrigger).
  - **Category 2: Snare-Snap Trap Core**: **Status: Implemented ✅**
    - *Implementation Details:* Added "Snap Core" to `src/systems/unlocks.ts`. Updated `src/foliage/musical_flora.ts` to make Snare-Snap Traps interactive, allowing players to harvest "Snap Shards". Updated collision logic in `src/gameplay/rainbow-blaster.ts` so that projectiles reflect off traps *only* if the "Snap Core" is unlocked; otherwise, the projectile breaks and the trap triggers normally.
  - **Category 3: Wisteria Clusters**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented `createWisteriaCluster` in `src/foliage/wisteria-cluster.ts` which generates hanging wisteria vines. Uses a TSL `MeshStandardNodeMaterial` with the "Cute Clay" preset and modifies `positionLocal` to create an organic sway animated by `uTime` and modulated by high frequency audio (`uAudioHigh`). The plant is interactive and triggers discovery logs. Added to `src/world/generation.ts` and exported in `src/foliage/index.ts`.
  - **Phase 3 (ASC -> C++): Specialized solvers (Remaining Animations SIMD)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated the remaining batch animation loops in `emscripten/animation_batch.cpp` (`batchFiberWhip_c`, `batchSpiralWave_c`, `batchVibratoShake_c`, `batchCymbalShake_c`, `batchPanningBob_c`, `batchSpiritFade_c`) to utilize explicit `v128_t` SIMD intrinsics. Processed items in chunks of 4 using Taylor series approximations for trigonometric functions to avoid scalar fallbacks. Verified via automated tests and visual inspection.
  - **Phase 3 (ASC -> C++): Animation Batch SIMD Vectorization**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented explicit WebAssembly SIMD (`v128_t` intrinsics) in `emscripten/animation_batch.cpp`. Rewrote high-frequency array loops for `batchSnareSnap_c`, `batchAccordion_c`, and `batchTremoloPulse_c` to process 4 items concurrently. Replaced math operations with a custom `fast_sin_simd` (Taylor series) and `fast_sqrt_simd` to avoid scalar fallbacks.
  - **Rare Flora Discovery (Unlock system)**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented proximity-based discovery logic in `src/systems/physics.ts` using a throttled check against `animatedFoliage` objects and a decoupled data map in `src/systems/discovery_map.ts`. Added a visual Discovery Log UI in `src/systems/discovery.ts` accessible via the 'L' key. It reads discovered items and displays them with icons and names from `DISCOVERY_MAP`. Added the keyboard shortcut and auto-unlocking logic in `src/core/input.ts`.
  - **Category 4: Instrument-ID Textures**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented procedural patterns generated based on Instrument ID in `src/foliage/instrument.ts` using shader-based noise patterns. Uses a complex mix of Grid, Noise, Ripple, and Stripes patterns blended dynamically via TSL's `smoothstep` and `abs` math operations based on the puzzle's `uInstrumentID`.
  - **Glitch Grenade**: **Status: Implemented ✅**
    - *Implementation Details:* Built `src/systems/glitch-grenade.ts` to throw dynamic projectiles that explode into localized glitch fields using `uGlitchExplosionCenter` and `uGlitchExplosionRadius` uniforms. Integrated into `src/foliage/common.ts` `applyGlitch` to smoothly blend glitch intensity. Integrated into `src/systems/physics.ts` to grant `player.isPhasing = true` (intangibility) when standing inside the glitch area.
  - **Category 6: Crystal Cave & Harmonic Waterfall**: **Status: Implemented ✅**
    - *Implementation Details:* Added bioluminescent stalactites and stalagmites using `THREE.ConeGeometry` inside `src/foliage/cave.ts`. These formations utilize a new dedicated TSL `crystalMat` material featuring `mix` and `smoothstep` nodes driven by `uAudioLow` to pulse dynamically with the bass. Confirmed integration of the inner waterfall via `createWaterfall` from `src/foliage/waterfalls.ts`.
  - **Waveform Harpoon**: **Status: Implemented ✅**
    - *Implementation Details:* Added `harpoon` state to `PlayerExtended`. Projectiles from `rainbow-blaster` now anchor to the Waveform Water (when `y <= 1.5` in lake basin). When anchored, the player is pulled towards the impact point with speed modulated by `audioState.kickTrigger`. Implemented visual feedback using a TSL-driven `MeshStandardNodeMaterial` thin cylinder that dynamically updates its geometry to connect the player to the anchor point.
  - **Bass Portal Secret (Subwoofer Lotus Glitch)**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented secret mechanic where interacting with a Subwoofer Lotus during high glitch intensity reveals a hidden Bass Portal.
  - **Environmental Discoveries**: **Status: Implemented ✅**
    - *Implementation Details:* Integrated the missing waterfall object into the optimized discovery spatial grid via a proxy object, allowing players to discover Melody Lake Island, Crystal Cave, and Harmonic Waterfall through proximity.
  - **Vibrato Violets Frequency Distortion**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented frequency distortion field logic in `src/systems/physics.ts`. Checks if the player is within a 20m radius of a `vibratoViolet`. When the player is in range and the plant is vibrating (driven by channel 4xx vibrato effect), a subtle TSL-driven chromatic aberration screen shake is applied via `uChromaticIntensity` (which manipulates viewport sampling) to simulate the frequency distortion field. This prevents enemies from locking on correctly.
  - **Silence Spirits Gameplay Mechanics**: **Status: Implemented ✅**
    - *Implementation Details:* Added interaction logic to `src/foliage/silence-spirits.ts` allowing players to commune with spirits before they fully fade. Implemented `grantInvisibility` in `src/systems/physics.ts` which provides a 5s buff tracked via `player.isInvisible`, applies a chromatic pulse effect, and shows a UI toast.
  - **Instrument Shrine Puzzle Mechanics**: **Status: Implemented ✅**
    - *Implementation Details:* Updated `src/foliage/instrument.ts` to use TSL uniforms for dynamic pattern generation. Shrines can now be cycled via interaction to "tune" them to different patterns. The logic in `src/foliage/animation.ts` specifically verifies if the tuned ID matches the active bassline instrument (channel 1), fulfilling the puzzle mechanic.
  - **Rare Flora Discovery Visuals**: **Status: Implemented ✅**
    - *Implementation Details:* Added `src/foliage/discovery-effect.ts` to render a TSL-driven magical particle burst (expanding, color-shifting, twinkling) upon rare plant discovery. Hooked into `checkPlayerDiscovery` and instantiated as a deferred visual in `src/main.ts`.
  - **Post-Processing Pipeline (Bloom & Color Correction)**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented `src/foliage/post-processing.ts` using `three/webgpu` `PostProcessing` with TSL. Added audio-reactive `BloomNode` (driven by `uAudioLow` for kick drums) and custom color correction logic (saturation & contrast). Integrated into `src/main.ts` replacing standard renderer.
  - **Audio-Reactive Terrain**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented `createTerrainMaterial` in `src/foliage/terrain.ts` using TSL for bass-driven vertex displacement (breathing) and treble-driven sparkles (magic dust). Replaced static MeshPhysicalMaterial in `src/world/generation.ts`.
  - **Procedural Cloud Layer**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented `src/foliage/procedural-sky.ts` to generate a dense, noise-based cloud layer using `CloudBatcher`. Updated `CloudBatcher` to support 20k puffs and dynamic day/night/storm lighting via `uSkyDarkness` and `uTwilight`.
  - **WebGPU Migration (Phase 4): Remaining Foliage Materials**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/environment.ts`, `src/foliage/celestial-bodies.ts`, `src/foliage/moon.ts`, and `src/foliage/trees.ts` to use TSL `MeshStandardNodeMaterial`, `MeshBasicNodeMaterial`, and `PointsNodeMaterial`. Replaced legacy `MeshStandardMaterial` with `CandyPresets` (Clay, Gummy) for consistent "Cute Clay" aesthetic. Updated logic to use TSL nodes for colors and emissions.
  - **Cymbal Dandelion Harvesting**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented `harvest(batchIndex)` in `src/foliage/dandelion-batcher.ts` to hide seeds of harvested dandelions. Updated `src/foliage/musical_flora.ts` to trigger harvesting on interaction, awarding 'chime_shard' items and spawning 'spore' impact particles. Enhanced `createCandyMaterial` type safety.
  - **Pattern-Change Seasons & Audio Data Flow**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented logic in `src/systems/weather.ts` to switch global palette modes (Standard, Neon, Glitch) based on the current audio pattern index. Updated `src/foliage/types.ts` to include `pan`, `instrument`, and `patternIndex` in `ChannelData`/`AudioData` interfaces, fixing type compatibility issues. Updated `public/js/audio-processor.js` to calculate stereo pan for 4-channel MODs using a heuristic (L-R-R-L).
  - **Weather-Cycle Integration**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented `calculateTimeOfDayBias` in `src/systems/weather-utils.ts` to drive weather changes (Morning Mist, Afternoon Storms, Evening Drizzle) based on cycle position. Integrated this into `WeatherSystem.update()` and `WeatherSystem.updateFog()`, enhancing visual feedback for time-of-day weather.
  - **Migrate `main.js` to TypeScript**: **Status: Implemented ✅**
    - *Implementation Details:* Converted the main entry point to `src/main.ts`. Defined global type definitions in `src/types/global.d.ts` for window augmentations and untyped JS modules. Updated `index.html` to point to the new TypeScript entry file and verified the build. This completes the core Phase 1 migration.
  - **Pattern-Change Seasons Logic**: **Status: Implemented ✅**
    - *Implementation Details:* Verified data flow of `order`/`row` from AudioWorklet to `AudioSystem`. Implemented logic in `src/systems/weather.ts` to cycle `targetPaletteMode` (Standard -> Neon -> Standard -> Glitch) based on the music pattern index (`patternIndex`), driving the global visual theme.
  - **Portamento Pine Slingshot Physics**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented interaction logic in `src/systems/physics.ts`. Players can "push" the pine to bend it (modifying its velocity state). If the tree is bent forward, running into it launches the player up (Ramp). If the tree is bent backward and snaps forward, it launches the player forward (Slingshot). Added debounce and visual impacts.
  - **Snare-Snap Trap Physics**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented interaction logic in `src/systems/physics.ts` using `foliageTraps` global list. Traps trigger (snap shut) when the player steps inside (radius < 0.8, open state). If the player is inside when the trap is closing/closed, a strong knockback impulse is applied along with visual/audio feedback. Integrated projectile reflection in `src/gameplay/rainbow-blaster.ts`: projectiles reflect off traps and force them to snap shut.
  - **Cymbal Dandelion Explosion**: **Status: Implemented ✅**
    - *Implementation Details:* Created `src/foliage/dandelion-seeds.ts` using `InstancedMesh` and TSL `MeshStandardNodeMaterial` to render floating seeds (Stalk + Tip). Seeds explode outward with drag, wind influence (`uWindDirection`), and sinusoidal sway. Integrated into `src/foliage/musical_flora.ts` to trigger on harvest.
  - **Migrate to TypeScript (Phase 1): Remaining Foliage Modules (`glitch`, `chromatic`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/glitch.js` and `src/foliage/chromatic.js` to TypeScript. Added strict typing for TSL nodes and shader uniforms. Updated `UnifiedMaterialOptions` in `src/foliage/common.ts` to support `emissive` properties, fixing a regression in Jitter Mines. Removed `src/foliage/pines.js` as it was dead code superseded by `src/foliage/portamento-batcher.ts`.
  - **Migrate to TypeScript (Phase 1): Visual Effects (`panning-pads`, `silence-spirits`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/panning-pads.js` and `src/foliage/silence-spirits.js` to TypeScript (`.ts`). Added strict typing for `PanningPadOptions`, `SilenceSpiritOptions`, and exported `UnifiedMaterialOptions` from `src/foliage/common.ts` for better type reuse. Updated `src/foliage/index.ts` exports.
  - **Migrate to TypeScript (Phase 1): Visual Effects (`ribbons`, `sparkle-trail`, `lotus`, `aurora`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/ribbons.js`, `src/foliage/sparkle-trail.js`, `src/foliage/lotus.js`, and `src/foliage/aurora.js` to TypeScript (`.ts`). Added strict typing for `RibbonUserData`, `SparkleTrailUserData`, `LotusOptions` and TSL nodes. Updated `src/foliage/index.ts` exports. Verified file presence and imports.
  - **Migrate to TypeScript (Phase 1): Core Effects (`impacts`, `instrument`)**: **Status: Implemented ✅**
    - *Implementation Details:* Migrated `src/foliage/impacts.js` and `src/foliage/instrument.js` to TypeScript (`.ts`). Added strict typing for `ImpactConfig`, `ImpactType`, and `InstrumentShrineOptions`. Updated imports in dependent files (`berries.ts`, `animation.ts`, `rainbow-blaster.ts`, etc.) to point to the new TypeScript modules.
  - **Kick-Drum Geyser Physics**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented physics interaction for Kick-Drum Geysers in `src/systems/physics.ts`. Players can now "ride" the active plume for a vertical boost. Added gameplay mechanic to charge the eruption by shooting the base (handled in `src/gameplay/rainbow-blaster.ts`), which boosts the plume height and intensity via `chargeLevel` in `src/foliage/animation.ts`.
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
  - **Waveform Water**: **Status: Implemented ✅**
    - *Implementation Details:* Implemented `src/foliage/water.ts` featuring a TSL-driven, audio-reactive water surface. Displaces vertices based on simulated waveform data (Bass/Treble). Implemented "Surfing" mechanic in `src/systems/physics.ts` providing speed boosts and visual feedback when moving in water during heavy bass kicks.
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
  - [x] Waveform Water (Displacement based on simulated waveform) **Status: Implemented ✅**
  - [x] Sample-Offset Glitch (Screen-space UV manipulation) **Status: Implemented ✅**
    - *Implementation Details:* Integrated global and local glitch shaders. Added Glitch Grenade logic using `uGlitchExplosionCenter` and `uGlitchExplosionRadius` for localized distortion fields.
  - [x] Chromatic Aberration Pulse (Lens distortion on heavy kicks) **Status: Implemented ✅**
  - [x] Instrument-ID Textures (Procedural noise patterns) **Status: Implemented ✅**
  - [x] Note-Trail Ribbons (Melody tracing geometry) **Status: Implemented ✅**
  - [x] Melody Mirrors (Fake reflection shaders) **Status: Implemented ✅**
    - *Implementation Details:* TSL-driven faux reflection using a procedural environment texture, with UV distortion driven by audio intensity (`uAudioHigh`) and time. Geometry consists of floating shard clusters integrated into `src/world/generation.ts`.
  - [x] Subwoofer Lotus (Bass & Glitch Reactive) **Status: Implemented ✅**
    - *Implementation Details:* TSL material logic for bass-driven vertex displacement (rings) and a swirling vortex portal that activates via `uGlitchIntensity` or high bass. Fully documented TSL math nodes (e.g., `atan2`, `mix`, `mx_noise_float`). Also implemented the Bass Portal secret mechanic which reveals a hidden portal and triggers discovery logic when the lotus is interacted with during high glitch intensity.
  - [x] Plants Twilight Glow (Bioluminescence) **Status: Implemented ✅**
    - *Implementation Details:* Implemented `uTwilight` global uniform in `src/foliage/sky.js` driven by `WeatherSystem`'s day/night cycle. Updated TSL materials for Flowers, Mushrooms, and Fiber Optic Trees to accept this uniform and boost emissive intensity during twilight hours.
  - [x] Fluid Fog (C++ Simulation) **Status: Implemented ✅**
    - *Implementation Details:* Implemented C++ Stable Fluids solver coupled with TSL fog visualization.
  - [x] Waveform Harpoon **Status: Implemented ✅**
    - *Implementation Details:* Projectiles anchor to Waveform Water, pulling the player using audio-modulated speed, visualized with a dynamic TSL line.

### Category 5: Physics & Interaction
- **Status:** Active
- **Tasks:**
  - [x] Bass Portal Secret (Subwoofer Lotus Glitch) **Status: Implemented ✅**
  - [x] Advanced Collision (WASM-based narrow phase)
     - *Implementation Details:* Implemented Spatial Grid (16x16) in AssemblyScript to optimize collision detection from O(N) to O(1) for nearby objects. Handles Mushrooms, Clouds, Gates, and Trampolines.
  - [x] Player Abilities (Dash, Double Jump extensions)
    - *Implementation Details:* Added Double Jump (air jump) and Dash (horizontal impulse) abilities to `src/systems/physics.js`.
      - **Double Jump:** Allows one extra jump in mid-air (reset on ground). Triggers `ability_double_jump` discovery.
      - **Dash:** Instant velocity boost in camera direction (mapped to 'E'). Cooldown 1s. Triggers `ability_dash` discovery.
      - **Visuals:** Triggers a chromatic aberration pulse (`uChromaticIntensity`) on use.
  - [x] Phase Shift Ability & Tremolo Harvesting
    - *Implementation Details:* Implemented `Phase Shift` ability (invulnerability/speed boost) in `src/systems/physics.ts` triggered by 'Z' key. Requires and consumes 'Tremolo Bulb'. Added harvesting logic to `Tremolo Tulips` in `src/foliage/flowers.ts`.
  - [x] Cymbal Dandelion Harvesting & Explosion
    - *Implementation Details:* Implemented seed harvesting for Cymbal Dandelions. Interacting with the flower head triggers a `spawnDandelionExplosion` (floating seeds with drag/wind) alongside a 'spore' particle burst. The seeds are rendered efficiently using `InstancedMesh` in `src/foliage/dandelion-seeds.ts`.
  - [x] Instrument Shrine Puzzles
    - *Implementation Details:* Implemented interactive logic where shrines detect if their matching instrument ID is active in the audio mix. Unlocking triggers a visual burst and rewards a 'Shrine Token'.
  - [x] Kick-Drum Geyser Physics & Charging
    - *Implementation Details:* Implemented "Riding the Plume" mechanic in `src/systems/physics.ts` (vertical velocity boost). Added charging mechanic: shooting the base increases `eruptionStrength` via `chargeLevel`.
  - [x] Snare-Snap Trap Physics
    - *Implementation Details:* Implemented player interaction (trigger on step, knockback on close) and projectile reflection in `src/systems/physics.ts` and `src/gameplay/rainbow-blaster.ts`.
  - [x] Retrigger Mushrooms (Strobe Sickness)
    - *Implementation Details:* Proximity-based full-screen strobe effect based on channel 5 retrigger effects.
  - [x] **Plants Twilight Glow**: Implemented logic for plants to glow during twilight hours (pre-dawn/dusk).
    - *Implementation Details:* Added `uTwilight` global uniform to `src/foliage/sky.js` and integrated it into the TSL material pipeline for Flowers, Mushrooms, and Trees. The glow intensity ramps up at dusk and down at dawn, driven by the `WeatherSystem`.

---

## Migration Roadmap (Summary)
1. **Phase 1 (JS -> TS):** Typing core data structures and systems. [DONE]
2. **Phase 2 (TS -> ASC):** Offloading hot paths to WASM. [DONE]
3. **Phase 3 (ASC -> C++):** Specialized solvers.
4. **Phase 4 (Three.js -> WebGPU):** Raw compute and render pipelines.
