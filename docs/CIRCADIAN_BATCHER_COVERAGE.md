# Circadian Batcher Coverage

Day/night plant behaviour for instanced flora. Circadian is an **additional gate** on top of music reactivity — channel math is unchanged.

## Uniforms

| Uniform | Writer | Meaning |
|---------|--------|---------|
| `dayNightBias` | `getDayNightBias()` (CPU) | 0 = night, 1 = day — feeds `PlantPoseMachine` |
| `uCircadianPhase` | `circadianController` | 0 = night, 1 = day (smoothed) |
| `uCircadianPoseOffset` | `circadianController` | lerp(nightPoseOffset, dayPoseOffset, ease(phase)) — higher by day |
| `uTwilight` | weather / atmosphere | dusk→night emissive window |

Helpers (prefer these over hand-rolled `mix`):

- `circadianNightGlowMult()` — nocturnal bioluminescence (`nightGlowMultiplier` → 1.0)
- `circadianDayGlowMult(floor)` — diurnal rest dim (`floor` → 1.0)

## Coverage matrix

| Batcher | Pose path | Glow gate | Rhythm |
|---------|-----------|-----------|--------|
| `simple-flower-batcher` | **PlantPoseMachine** → `aPoseState` | dayGlow + uTwilight | diurnal |
| `dandelion-batcher` | `uCircadianPoseOffset` droop & tuck | dayGlow + uTwilight | diurnal |
| `flower-batcher` | PlantPoseMachine → `aPoseState` | uTwilight | diurnal |
| `dandelion-batcher` | `uCircadianPhase` close/droop | dayGlow + uTwilight | diurnal |
| `arpeggio-batcher` | PlantPoseMachine | (pose-driven) | diurnal |
| `portamento-batcher` | PlantPoseMachine → bend spring | dayGlow + uTwilight | diurnal |
| `tree-batcher` | `uCircadianPoseOffset` droop | dayGlow + nightGlow×uTwilight | diurnal |
| `mushroom-batcher` | `uCircadianPoseOffset` tuck | nightGlow | nocturnal |
| `glass-mushroom-batcher` | `uCircadianPoseOffset` swell | nightGlow | nocturnal |
| `luminous-plant-batcher` | `uCircadianPoseOffset` swell | nightGlow + uTwilight | nocturnal |
| `gem-fruit-batcher` | `uCircadianPoseOffset` droop | nightGlow | nocturnal |
| `wisteria-cluster` | `uCircadianPhase` night droop | nightGlow + uTwilight | nocturnal |
| `subwoofer-lotus-batcher` | `uCircadianPoseOffset` droop | dayGlow + nightGlow×uTwilight | event |
| `kick-drum-geyser-batcher` | `uCircadianPoseOffset` droop | (plume color only) | event |
| `lantern-batcher` | — | nightGlow + uTwilight | nocturnal |

## Debug

`?debugCircadian=1` — HUD coverage table + amber/indigo screen tint (`src/debug/circadian-debug.ts`).

Console: `setTimeOfDay('night'|'day'|'sunset'|'dawn')`, `logCircadianCoverage()`.

`setTimeOfDay` / `setCircadianTimeOfDay` come from `src/core/time-of-day-presets.ts`, not the debug
module, so they also exist in dev builds, with `?debug=1`, and under automated captures (Playwright
`navigator.webdriver` or `__IS_FULL_BOOT_TEST`, which visual regression sets). The presets are cycle positions in seconds: dawn 30 and sunset 510 are the sun's horizon
crossings, day 270 is noon, night 780 is deep night. The day/night cycle is 960 s
(`getCyclePos` in `src/core/cycle.ts`); night runs from 540 s to the wrap.

## Visual regression

- `circadian_night` — Gem Canopy corridor at night
- `circadian_night_mycelium` — MYCELIUM_GROVE at night

```bash
pnpm run test:visual -- --viewpoints circadian_night,circadian_night_mycelium --qualities medium
```

## Behaviour contract

1. **Day** — baseline open pose + moderate emissive
2. **Twilight** — `uTwilight` lerp into emissive (multiply order: color × uTwilight × intensity × pulse)
3. **Night** — closed/dim pose for diurnal species; nocturnal species brighten via `circadianNightGlowMult`
4. Music wave / player interaction may override rest pose without changing channel math
