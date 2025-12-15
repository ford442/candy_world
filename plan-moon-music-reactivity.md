# Moon Dance & Note-Color Reactivity — Implementation Plan

Summary
-------

Add a charming moon animation (blink and/or dance at night) and make scene objects react to specific musical notes via colors. Colors will be aligned to the sequencer project's color codes (see `assets/colorcode.png`), and each species will have its own note→color mapping so behavior is identifiable by species.

Goals
-----

- Moon: blink and/or dance during night-time and optionally on beat/note events.
- Music reactivity: objects (flowers, trees, clouds, mushrooms, etc.) should change color and optionally animation based on the note played and the species' mapping.
- Color alignment: use the same color codes as the sequencer — include `assets/colorcode.png` in the repo and reference it in docs.

Specification
-------------

1) Night detection

- Definition: Night when `sun.angle` (or a simple time-of-day value) falls below a configurable threshold. Allow override with a `MOON_ACTIVE` toggle.

2) Moon behavior

- Blink: quick scale/opacity pulse around the eye or a localized emissive intensity spike. Parameters: `blinkDuration` (default 200ms), `blinkInterval` (randomized +/- jitter), `blinkOnBeat` (bool).
- Dance: small, rhythmic bob/rotation tied to either the global beat or a per-moon LFO. Parameters: `danceAmplitude` (0.1–0.5 units), `danceFrequency` (Hz), `danceOnBeat` (bool).
- Implementation notes: store animation state in `moon.userData.animation`. Use `requestAnimationFrame` loop (existing `animate`) to update transforms, or a small `THREE.AnimationMixer`/GSAP tween for smooth interpolation.

3) Note → Color reactivity (per-species)

- Data structure:

```js
// example
CONFIG.noteColorMap = {
  speciesA: { 'C4': '#FF69B4', 'D4': '#87CEFA', ... },
  speciesB: { 'C4': '#98FB98', ... },
}
```

- Each species maps MIDI note names (or integers) to hex colors. Colors should be taken from the sequencer's palette; include a canonical table in `assets/colorcode.png` and replicate the table into a JSON or JS object as the source-of-truth.

4) Visual behavior when receiving a note

- On `noteOn(note, velocity, species)` event, the object(s) for that species should:
  - briefly tint or lerp their `material.color` toward the mapped color (smooth transition, e.g. 120–300ms), and/or
  - set an emissive stripe/highlight using the mapped color scaled by `velocity`.
- Optionally trigger an animation (petal wiggle, tree lean, cloud pulse) with configurable intensity.

Implementation Plan
-------------------

Files to touch/create

- `main.js` — add `CONFIG.noteColorMap` and moon config; expose a `triggerNote(species, note, velocity)` helper.
- `foliage.js` — accept color hints in factory functions and expose a `reactToNote(note, color, options)` method on groups/meshes.
- `music-reactivity.js` (new) — small module to centralize note routing: map incoming notes to species, call `reactToNote()` and notify moon if configured.
- `assets/colorcode.png` — canonical image (user will add). Also add `assets/colorcode.json` (derived) to store machine-readable mappings.

Acceptance criteria
-------------------

- At night, moon blinks and/or dances smoothly and configurable via `CONFIG`. Blink/dance can be tied to beats or notes.
- Playing a note causes the mapped species objects to change color toward the mapped color, with smooth transitions and a fallback if mapping missing.
- Colors match the sequencer's palette (visual check by comparing to `assets/colorcode.png`).

Testing & Verification
----------------------

- Run `npm run dev`, play a song from the sequencer and confirm:
  - Moon animates at night and when note/beat triggers are enabled.
  - Species react with the expected colors and visual effects.
- Add a small debug mode that overlays active notes and mapped colors as a HUD.

Next steps
----------

1. Add `assets/colorcode.png` (your image) and convert into `assets/colorcode.json` listing color hex codes.
2. I can implement the config + basic moon animation and a small note-reactivity system; would you like me to proceed with that implementation now?

Notes
-----

- Keep color mapping editable in code and optionally exposed in a small UI so you can tweak species palettes live.
- We should standardize note naming (e.g. `C4` or MIDI number) across projects — pick one and document it in this plan.

Player Dance Moves & Proximity Reactions
---------------------------------------

- Feature: The player has explicit dance moves (single-trigger moves and an optional looping dance) that can be triggered by keybinds/actions.
- Trigger types:
  - **One-shot move**: a single animation sequence (e.g., spin, kick, hop) triggered by input/button.
  - **Looping dance**: toggled on/off; plays a looping dance animation and emits periodic "dance pulses".
- Proximity reaction:
  - Dance pulses notify nearby foliage/creatures (within configurable radius) causing them to perform a species-specific dance or animation sequence.
  - Each species exposes a `reactToDance(intensity, sourcePosition, danceId)` API; reactions can vary by species and danceId.
- Data & API:
  - `PLAYER_DANCE_MOVES = { 'spin': {...}, 'twirl': {...}, 'groove': {...} }`
  - `triggerPlayerDance(danceId, duration?, intensity?)` in `main.js` / `player.js`.
  - `foliage.reactToDance(danceId, intensity, position)` implemented in `foliage.js`.
  - `music-reactivity.js` can map a dance loop to note/beat events if desired (danceOnBeat).
- Visual & audio design:
  - Dance pulses optionally carry tonal/color metadata so nearby objects can tint or emit corresponding color (reusing `CONFIG.noteColorMap` / palette).
  - Provide subtle audio stings or per-species chirps to reinforce the reaction.
- Parameters:
  - `danceRadius` (default 8 units), `dancePulseInterval`, `danceIntensityScale`, `danceOnBeat` (bool).
- Implementation notes:
  - Store player dance state on `player.userData.dance`.
  - Use small LERP or GSAP to blend transforms and material properties.
  - Make dance reactions lightweight for many actors (use instance-level flags or a small job queue).
- Acceptance criteria:
  - Player can trigger one-shot and looping dances.
  - Nearby foliage/creatures respond with species-unique dance animations and optional color/emissive changes.
  - Reactions are tunable and do not cause frame drops at moderate actor counts.
- Next steps:
  1. Add dance configs to `CONFIG`.
  2. Implement `triggerPlayerDance()` and `foliage.reactToDance()`.
  3. Add an on-screen debug HUD showing active dance pulses and affected targets.

Jumping & Local Movement
------------------------

- Feature: Include jumps as part of player dance moves with multiple heights and allow the player to automatically move around a small local area while looping a dance.
- Jump design:
  - One-shot and looping dances may include discrete jump levels (e.g., `low`, `medium`, `high`) selectable per dance or randomized with a configured distribution.
  - Jumps affect vertical position and can include animation curves (ease-in/out) and optional squash/stretch for stylized motion.
  - Parameters: `jumpHeights = { low: 0.5, medium: 1.2, high: 2.0 }` (units), `jumpDuration`, `jumpCooldown`, `jumpBlend`.
- Local movement:
  - Looping dances optionally enable an `autoRoam` mode where the player moves within a small radius (`roamRadius`) around the original position following a gentle steering behavior.
  - Movement should be constrained to navigable ground and avoid large obstacles; use small random walk or perlin noise-based offsets for organic feel.
  - Parameters: `roamRadius`, `roamSpeed`, `roamPauseChance`, `roamSmoothing`.
- Interaction with proximity reactions:
  - Dance jumps and movement generate pulses with `intensity` scaled by jump height and proximity effects should scale accordingly.
  - Provide a `dancePulse` payload that includes `position`, `intensity`, `danceId`, and optionally `color` so reactors can respond appropriately.
- Implementation notes:
  - Integrate jump states into `player.userData.dance` and use existing animation/update loop to safely modify position/velocity.
  - Ensure collision and ground checks remain robust (raycast to ground for vertical repositioning) and avoid moving the player into unwalkable areas.
- Acceptance criteria:
  - Jumps of different heights are visually distinct and blend smoothly into existing animations.
  - Looping dance with `autoRoam` moves the player gently within the configured radius and emits pulses that cause nearby foliage to react.

Foliage Growth & Rain-Driven Spreading
-------------------------------------

- Feature: Foliage can spread into empty areas during/after rain according to local spawning rules.
- Growth rules (example):
  - Candidate spawn spots are chosen within `spawnRadius` of an adult plant.
  - Each adult plant can spawn up to `maxOffspring` per growth window.
  - Spawn chance is a function of `soilMoisture`, `lightLevel`, and `localDensity` (lower chance when local density is high).
  - Rain event increases `soilMoisture` and triggers a growth window where spawn probabilities are higher.
- Data & parameters:
  - `spawnRadius`, `spawnChanceBase`, `maxOffspring`, `growthWindowMs`, `densityLimit`.
  - Persist minimal state in `plant.userData` (`age`, `mature`, `lastSpawnTime`).
- Implementation notes:
  - Implement a `foliage.spawnNearby(parentPlant, species, options)` helper.
  - Use spatial partitioning (grid or quadtree) to efficiently query local density and nearby adults.
  - Include safeguards to avoid runaway exponential growth (global cap, density checks).
- Acceptance criteria:
  - After rain, foliage visibly expands into nearby empty areas following probabilistic rules and caps.
  - Growth is performant with many plants (use batching/instancing where possible).

Lake, Island & Creek
--------------------

- Feature: Add a lake with an island and a creek that flows into the lake; water should have a gentle flow animation and interact with moisture/growth systems.
- Design notes:
  - Create a `lake` mesh with a water material that supports flow direction and normal-based reflections.
  - Add a small island mesh with rocks/vegetation and a creek mesh/path that visually connects a source to the lake.
  - Optional: use a simple heightfield or spline-based mesh to define creek path and animate texture UVs for flow.
- Interaction with foliage/growth:
  - Areas near the creek and lake have increased `soilMoisture` and support faster growth/spawning.
  - Allow fish or water-specific species to spawn near the lake/island (future work).
- Implementation notes:
  - Add a `water.js` helper for a simple flow shader (or reuse an existing water shader from examples).
  - Ensure creek/lake scale and placement are configurable in the scene editor or level config.
- Acceptance criteria:
  - Lake and creek visually match the expected aesthetic, the creek visibly flows into the lake, and surrounding foliage growth reacts to increased moisture.

Build & WASM migration notes
---------------------------

- Implementation workflow reminder: start with a TypeScript implementation so behavior is easy to iterate and test in `main.js`/`music-reactivity.js`.
- Move performance-critical or compute-heavy parts to `assembly/index.ts` (AssemblyScript) and compile with the project's AssemblyScript toolchain (see `npm run build:wasm` in the repo). This lets us run hot paths in asc-generated WASM.
- For additional performance or when integrating with existing native audio tooling, port or re-implement the same logic in C/C++ and place it under `src/audio` (the `emscripten/` folder in this repo contains examples). Use emscripten to produce C++-generated WASM and provide a small JS shim for the interface.
- Pay attention to data serialization across JS↔WASM boundaries (typed arrays, shared memory) and keep a small, well-defined API surface for tests.

Plants Twilight Glow
--------------------

- Feature: Certain plant species begin to glow during twilight — starting a configurable amount of time before sunset and stopping before dawn.
- Behavior:
  - `glowStartOffset` (e.g., 30 minutes before sunset) and `glowEndOffset` (e.g., 30 minutes before sunrise) define a twilight window.
  - Glow intensity ramps up as sunset approaches and ramps down toward dawn; optionally include a gentle pulse (frequency/amplitude).
  - Glow color can be per-species and optionally tied to `CONFIG.noteColorMap` or a separate `CONFIG.glowColorMap`.
- Visual options:
  - Use `material.emissive` + `emissiveIntensity` for simple tinting, or a small custom shader/uniform for more control (bloom pass recommended for stronger glow).
  - Per-species variations: hue, pulse frequency, pulse sync offset (desynchronize large groups).
- Implementation notes:
  - Compute twilight window from `sun.angle`, time-of-day, or `sunsetTime`/`sunriseTime` values; provide a `isTwilight(time)` helper.
  - Update `plant.userData.glow` state and set `material.emissive`/uniforms inside the existing animation loop or via a lightweight manager to minimize per-frame work.
  - Provide fallbacks for non-shader materials (use emissive color lerp) and guard against excessive draw cost (only apply to a subset if needed).
- Parameters to expose in `CONFIG`:
  - `glowStartOffsetMinutes`, `glowEndOffsetMinutes`, `glowPulseFrequency`, `glowPulseAmplitude`, `glowIntensityMax`, `glowColorMap`.
- Acceptance criteria:
  - Plants show a visible, tunable glow in the twilight window and stop glowing outside that window.
  - Glow looks consistent with species palettes and doesn't cause severe performance regressions.

Luminous Plant Scenic System (Audio-Driven)
-------------------------------------------

These are the key scenic and technical rules to render music-reactive luminous plants in 3D. The ideas are organized by visual storytelling layers and are directly mappable to MOD data (note, volume, duration, channel, effects).

1) Plant Architecture & Light Organs

- Bioluminescent Tissue: Model translucent leaves/petals with subsurface scattering and internal emission that reveal vein networks pulsing like fiber optics.
- Modular Light Nodes: Implement nodal 'pixels' (glowing droplets, spores, nodules). Some nodes are staccato responders (percussive), others hold sustained emission (moss beds).
- Hierarchical Response: Map frequency bands to plant scales — stems/bases respond to low/bass, fronds/filaments to high notes. Use bloom intensity + response delay to convey scale.
- Growth State: Use `plant.userData.age`/`maturity` to scale emissive intensity, pulse speed, and pattern complexity.

2) Light Propagation Dynamics

- Wave Ripples: Drive shader vertex/vertex-colour animation to make light flow along branches with visible propagation delay.
- Resonance Overtones: For sustained notes, add secondary color shifts (core vs rim hues) to imply harmonic overtones.
- Beat Entrainment: On strong beats, propagate a brightness shockwave from roots to tips and spawn short luminous particle trails.
- Volume Sensitivity: Map velocity/volume to emission range: whisper => faint twinkle; crescendo => intense bloom + lens flare.

3) Environmental Interaction

- Mist & Volumetrics: Add a fog/mist layer that scatters plant light (god rays, sound-wave ripples in air).
- Symbiotic Ecosystem: Light attracts small critters that leave bioluminescent trails and can reinforce plant glow in a visible feedback loop.
- Reflective Surfaces: Water, crystals, and dew surfaces mirror/multiply the light; objective: let the environment feel like a resonant instrument.
- Crowd Behavior: Nearest plants to the music source react first; reactions cascade outward creating a visible choir effect.

4) Temporal & Procedural Layers

- Audio-Reactive Shaders: Live inputs (from MOD or FFT) directly drive emission strength, hue rotation, flicker noise and gentle displacement.
- Time-Lapse Cycles: Plants have diurnal breathing (sleeping) states and large-scale dawn/dusk chorus behaviors.
- Memory Trails: Implement short afterglow ghosting so recent musical phrases leave fading visual traces.

5) Cinematic & Atmospheric

- Macro Shots: Support extreme close-ups with SSS + shallow depth-of-field for tight musical moments.
- Drone Perspective: Render large-scale choir visuals where species map to instrument sections.
- POV Shots: Plant blooms subtly orient toward the music source and track it when it moves.
- Seasonal Palettes: Offer configurable color palettes per season or song style.

6) Technical Rendering Priorities

- Global Illumination & HDR: Ensure plants can illuminate neighbors; HDR + adaptive bloom are crucial for crescendos.
- Procedural Instancing: Add per-instance phase offsets, random genetic variations andLOD to keep forests lively and performant.
- Physics-Based Sway: Combine wind and audio displacement so bass notes produce ground/plant shake.
- Critical: Prioritize Subsurface Scattering and Volumetric God Rays — these make the light feel internal and air-filled.

MOD-Driven Mapping (Leveraging Tracker Precision)
-----------------------------------------------

- Note-Level Precision Mapping: Use MOD note value and velocity to trigger specific morphs or node responses (exact pitch → unique animation state; velocity → emission/visual radius).
- Instrument-Specific Architecture: Map channels to plant organ types (bass→vines, melody→flowers, hi-hat→seed popping, arpeggios→spiral fronds, vibrato→stem tremor). Store instrument metadata (decay, displacement, color hints) alongside instrument definitions.
- Temporal Sequencing & Prediction: Use the MOD player's row callback for lookahead (1-2 rows) to render ghost pre-glows and to queue long fades or slides (portamento) so visuals are rhythmically anticipatory and deterministic.
- Structural Visualization: Use morphological blendshapes driven by pattern/row (verse vs chorus states), and render inter-instrument filaments/bridges to show counterpoint.
- Camera Integration: Assign camera moves to empty MOD channels for choreographed cinematography and use row-accurate triggers to drive focus pulls, dolly moves, and macro-shot timing.
- Performance & Efficiency: Drive large sets of plants via instanced vertex shader animation, with a uniform buffer representing current row's note stack and compact per-instance parameters (phase, channel, species id).

Implementation Notes & Acceptance
--------------------------------

- Hook into the MOD player's row callback as the canonical timing source (row frequency ~50-60Hz). Emit `noteOn`, `noteOff`, `patternBoundary`, and `slide` events to the reactivity system.
- Provide a `modVisualizer` subsystem that translates tracker events into compact uniform data for shaders (e.g., top-N active notes, channel intensities, slide endpoints).
- Acceptance criteria:
  - Musical events (notes, slides, volume changes) are visually synchronized to tracker rows with lookahead-based pre-glows.
  - Macro-shot POC: a stamen portamento sequence with matching color morphing and trailing spores, timed from MOD data, plays back reliably.

— end plan —
