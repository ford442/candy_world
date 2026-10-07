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
- Nothing is saved. Loading an old save never changes the season (see "Saving and presence").

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

## Weather fronts

Weather follows the same clock. Wall-clock time is cut into slots of
`CONFIG.season.weather.slotMinutes` (20 minutes, about 1¼ game days). Each slot hashes from the seed
to a front — clear, rain or storm, with a peak intensity — drawn from the odds of the season at the
slot's midpoint (`CONFIG.season.weather.odds`): showery spring, stormy summer, gentle winter. The
first `CONFIG.season.weather.rampMinutes` of a slot ramp from the previous front, and neighbouring
slots of the same type merge into one long front, so a storm arrives, holds and clears instead of
flickering. [`sampleWeatherFront`](../src/systems/weather/weather-fronts-core.ts) is a pure function
of seed and time, so presence peers share a sky.

| Who                          | Say over the weather                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `WeatherSystem.setWeather()` | Pins the type and intensity until `setWeather(null)`. Debug and visual regression only.      |
| The front                    | Decides clear / rain / storm and the base intensity.                                         |
| Music                        | Nudges intensity by up to `CONFIG.season.weather.musicIntensityRange`; never flips the type. |

Mist and drizzle are now only flavours of a rain front (morning and dusk), not weather of their own.
The announcer says when clouds gather, a storm builds or breaks or eases, and when the sky clears.

Fronts leave roughly half the year clear. Before them, rain followed the bass line, so with music
playing it rained most of the time; ground water, rain-grown mushrooms and rainbows are now rarer.
Tune `CONFIG.season.weather.odds` if that reads too dry.

## Fauna, flora and music

| Knob                          | What it does                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CONFIG.season.fauna`         | Flock size, roosting and autumn migration toward the sky islands ([`FAUNA.md`](./FAUNA.md#seasons)).          |
| `CONFIG.season.spawnScale`    | Share of berries, gem fruit, fireflies and dandelion seeds shown.                                             |
| `CONFIG.season.music`         | Generative soundtrack tempo, filter brightness, arrangement density and reverb, layered on the biome profile. |
| `CONFIG.season.luminousBoost` | Luminous-plant glow; winter nights glow brighter.                                                             |
| `CONFIG.season.windGustScale` | Gust swell on the shared wind; autumn is the windy one ([`WIND_OPTIMIZATION.md`](./WIND_OPTIMIZATION.md)).    |

Spring is 1 (or 0) everywhere, so spring is today's world. **Seasons only thin what world generation
placed; they never add.** Berries, gem fruit and fireflies are thinned on the GPU: `seasonDensityKeep`
scales an instance to zero when a stable per-instance key (the instance index, or the gem's phase,
which moves with it on removal) is above the season's density, with a soft edge so a density change
fades rather than pops. No streaming, spawning or CPU work changes. Dandelion bursts spawn fewer
seeds, and fewer berries shake loose.

Music modifiers are applied to the biome crossfade right after each blend, so they never compound,
and each is exact at its identity value. Tempo is kept within ±8% on purpose: game time runs at
120 / BPM, so a season's tempo also stretches the day. Reverb is a single convolver send that is only
built the first time a season asks for it.

## Frozen lake

When the season's frost passes `CONFIG.season.lake.freezeAt`, the lake freezes over
`CONFIG.season.lake.easeSeconds`: waves still, the surface turns an icy pastel
(`CONFIG.season.lake.iceColor`), and halfway through it holds weight. The lake has no collider, so
ice is a ground-height rule ([`lake-ice-core.ts`](../src/systems/physics/lake-ice-core.ts)): over open
water, ground reads as the water surface, and because swimming is an eye-height check the player
simply walks. The island is untouched, and a 7 m strip along the Sugar Caves descent never freezes, so
the caves stay reachable all year.

Freezing waits while the player is in the water beneath where the ice would form (swimming or
wading, whatever they are doing), so nobody is lifted onto it. Thawing never waits: anyone standing
on the ice when it melts drops into the lake, which looks open by then. Everything that puts the player
on the ground (movement, the eye-height follow, dancing, the camera snap, spawning) uses the
ice-aware `getPlayerGroundHeight`; world generation does not, so nothing is planted on the ice.
Freezing depends only on frost, a smooth function of seed and clock, so peers agree without
hysteresis.

## Saving and presence

Nothing about seasons or weather is saved or sent. The save file records the live season, weather
and time of day for reference ([`SAVE_SYSTEM.md`](./SAVE_SYSTEM.md)), but loading never applies
them. Presence peers share a seed, so they share the season, the fronts and the lake.

## Deferred from the original pitch

| Item                                    | Why it waits                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Kick-drum geysers firing more in summer | Geysers only erupt from the night-gated sky wave, and the kick channel they read is never filled in. |
| Longer summer days, Night Market hours  | The day length is a constant read across the codebase; nights already grew 40% with the cycle fix.   |
| Heat shimmer                            | Post-FX does not run in CI or screenshots, so it could not be verified.                              |
| Sky-wave cue on weather changes         | The sky wave is night-gated; the announcer marks transitions instead.                                |
| Snow particles                          | Winter precipitation still renders as rain.                                                          |
| Autumn leaf debris                      | Candy debris has no drag or flutter; leaves need their own emitter.                                  |
| Mode shift to dorian / minor            | Would override each biome's own scale, and needs tuning by ear.                                      |
| Animated fireflies                      | Their compute node is never dispatched — a separate bug.                                             |
| HUD season indicator                    | The announcer covers season changes for now.                                                         |

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
- `npm run test:weather-fronts` ([`weather-fronts.test.ts`](../tests/weather-fronts.test.ts)):
  peer determinism, continuity across slots, season odds, run length, no flicker, phases, the music
  bound, override precedence, and zero allocation.
- `npm run test:fauna` ([`fauna-behavior.test.ts`](../tests/fauna-behavior.test.ts)): identity
  modifiers change nothing, roosting, parked critters, migration, and the season mapping.
- `npm run test:season-music` ([`season-music.test.ts`](../tests/season-music.test.ts)): spring is
  bit-for-bit identity in every biome, winter is slower and darker, bounds, no compounding.
- `test:season-wgsl` also builds the berry, gem-fruit, firefly and luminous materials and checks the
  density mask reached the vertex stage.
- `npm run test:lake-ice` ([`lake-ice.test.ts`](../tests/lake-ice.test.ts)): the island and the
  descent hole never freeze, the ice holds weight only when solid, freezing waits for swimmers and
  waders while thawing never waits, the player-facing ground height sees the ice, and the real
  character controller rests on it.
- `npm run test:season-determinism` ([`season-determinism.test.ts`](../tests/season-determinism.test.ts)):
  two peers with 2 s of clock skew and different join times see the same season, palette, front and
  lake, except across a transition inside their skew; different rooms differ.
