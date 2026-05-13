# Luminous Plant Scenic System (Audio-Driven)

## Visual Vision: Luminous Plant Scenic System (Status: Implemented ✅)
* Implementation Details: Created `luminousPlantBatcher` in `src/foliage/luminous-plant-batcher.ts` utilizing TSL for fake subsurface scattering and audio-reactive emissive pulses. Integrated around Melody Lake island in `src/world/generation.ts` and configured color palettes and dynamics in `src/core/config.ts`.


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
