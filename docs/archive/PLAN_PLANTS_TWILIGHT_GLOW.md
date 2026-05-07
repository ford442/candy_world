# Plants Twilight Glow

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
