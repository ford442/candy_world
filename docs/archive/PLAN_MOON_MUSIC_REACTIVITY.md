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
  - Create a `CONFIG.noteColorMap` mapping note names (e.g., 'C', 'C#', 'D') to hex colors matching `assets/colorcode.png`.
  - In each species' configuration (e.g., `FLOWER_CONFIG`, `TREE_CONFIG`), add a `reactiveNotes` array (e.g., `['C', 'E', 'G']`).
- Behavior:
  - Listen for `noteOn` events from the audio system.
  - If the played note is in a species' `reactiveNotes` list, trigger a color pulse.
  - Color pulse: briefly override or mix the object's base color/emissive with the note's mapped color.
  - Parameters: `pulseDuration` (default 150ms), `pulseIntensity` (0.0 to 1.0 multiplier).
- Implementation notes:
  - Add a uniform or instance attribute for `activeNoteColor` and `notePulseIntensity` to the shaders/materials used by reactive objects.
  - Update these values in the animation loop based on recent `noteOn` events.
