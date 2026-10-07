# Seasons

Candy World has a year: spring, summer, autumn and winter. Every existing biome changes with it,
so a returning player sees a different world.

## The clock

The season is a pure function of **(world seed, wall-clock time)**:
[`computeSeasonState`](../src/systems/season-core.ts).

- One season lasts `CONFIG.season.realDaysPerSeason` real days (default 1, so a year is 4 days).
- Year progress 0 is the start of spring at `CONFIG.season.epochMs`. With `CONFIG.season.seedPhase`
  on, each seed's year is shifted by a hash of the seed, so different worlds sit in different seasons.
- Everyone in a presence room shares a seed (room = `candy:${seed}`), so they share a season
  without any protocol change. Clock skew of a few seconds is invisible: seasons cross-fade over
  `CONFIG.season.transitionFraction` of a season (default a quarter, centred on each boundary).
- Nothing is saved. Loading an old save never changes the season.

The day/night cycle (16 minutes of game time, see [`cycle.ts`](../src/core/cycle.ts)) is
independent of the season. The moon stays on game time.

### Overrides

| Override                        | Effect                                                                |
| ------------------------------- | --------------------------------------------------------------------- |
| `?season=autumn`                | Pin a season at its midpoint, no blend. Never saved.                  |
| `?seasonSpeed=500`              | Run the calendar 500× fast from page load, starting on the real date. |
| `window.setSeason('winter')`    | Pin at runtime; `setSeason(null)` returns to the calendar.            |
| `CONFIG.season.enabled = false` | Pin spring unless `?season=` says otherwise.                          |

`window.setSeason` installs in dev builds, under CI / headless / visual-regression runs, and with
`?debug=1`. Visual regression pins every viewpoint to `spring` unless the viewpoint sets `season`,
because an unpinned capture would render whatever season it is on capture day.

## Palette and frost

Each foliage material opts into one role: `leaf`, `petal`, `cap`, `ground`, `bark` or `water`.
Per role and season, `CONFIG.season.palette` sets:

| Field    | Meaning                                                                     |
| -------- | --------------------------------------------------------------------------- |
| `color`  | Pastel hue the role moves toward (sRGB hex). Only hue and saturation count. |
| `amount` | 0 = untouched, 1 = fully that hue at the pixel's own luminance.             |
| `frost`  | Powdered-sugar coverage on upward-facing surfaces (×0.8 at most).           |
| `chroma` | Saturation multiplier around luminance; 1 = untouched, never below 1.       |

Spring is the identity: amount 0, frost 0, chroma 1, and the tint is exact at those values.
Summer turns the saturation up, autumn moves toward butterscotch and plum, and winter goes icy lilac
under powdered sugar. Frost is `CONFIG.season.frostColor`, a tinted cream.

The CPU blends the palette once per frame (premultiplied by `amount`, so spring fading into autumn
keeps autumn's hue at a smaller amount) and writes one uniform set per role. Shader graphs never
change, so switching season never recompiles anything. Far-LOD impostors get the same tint on the
CPU from `mesh.userData.seasonRole`.

The rules the palette must follow, and why albedo may change at all, are in
[`CANDY_AESTHETIC_GUARDRAILS.md`](./CANDY_AESTHETIC_GUARDRAILS.md#seasonal-albedo-moves). How to opt a
material in is in [`CANDY_MATERIAL_COOKBOOK.md`](./CANDY_MATERIAL_COOKBOOK.md#seasonal-tint-seasonrole).

## Code map

| File                                                                                    | Role                                                       |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`systems/season-core.ts`](../src/systems/season-core.ts)                               | Pure calendar, blend and tint math (no imports)            |
| [`systems/season-controller.ts`](../src/systems/season-controller.ts)                   | Per-frame update, overrides, announcer, `window.setSeason` |
| [`foliage/material-core/season-nodes.ts`](../src/foliage/material-core/season-nodes.ts) | Role uniforms and `applySeasonTint`                        |
| [`core/config/season.ts`](../src/core/config/season.ts)                                 | Defaults and palette                                       |

The controller runs in the visuals phase right after the circadian controller and hands its state
to weather (`WeatherSystem.setSeasonState`). Other systems read `getSeasonState()`; the controller
imports none of them.

## Tests

- `npm run test:season` ([`season-core.test.ts`](../tests/season-core.test.ts)): calendar
  boundaries, peer determinism, the blend window, frost and sun, overrides, spring identity (bit
  for bit), luminance preservation, the premultiplied blend, the palette guardrails, and zero
  per-frame allocation.
- `npm run test:season-wgsl` ([`season-tint-wgsl.test.mjs`](../tests/season-tint-wgsl.test.mjs)):
  builds the WGSL for every tinted material with three's own node builder under node, without a
  GPU, and checks the tint reaches the fragment stage. With [`naga`](https://github.com/gfx-rs/wgpu/tree/trunk/naga)
  on `PATH` it also validates every shader; without it the run says validation was skipped.
