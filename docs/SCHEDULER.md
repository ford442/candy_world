# Frame scheduler

`animate()` (`src/core/game-loop.ts`) no longer calls systems directly. Each
frame it:

1. reads the clock (photo mode can scale or freeze the delta; clamped to 0.1 s),
2. samples audio once (`updateAudioPhase`) and advances BPM-scaled game time,
3. calls `frameScheduler.runFrame(...)`, which runs every registered system in
   phase order,
4. reads back GPU timings for the performance budget.

The frame's systems are declared in `src/core/game-loop-systems.ts`
(`FRAME_SYSTEMS`). The scheduler is in `src/core/scheduler/` (#1973).

## Phases

Phases run in this order. Within a phase, systems run in registration order
unless `after` / `before` say otherwise.

| Phase         | What belongs here                                                                  | Systems today                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `input`       | Device reads, raycasts, clamping the player to streamed terrain                    | `interaction`, `chunk-streaming`                                                                                                   |
| `fixed`       | Deterministic simulation at `fixedDt` (1/60 s), 0–5 times per frame                | none yet                                                                                                                           |
| `simulate`    | Variable-step simulation                                                           | `player-physics`, `fauna`, `entity-behaviors`, `sugar-caves-traversal`, `presence`, `gameplay`                                     |
| `animate`     | Things that read the settled sim: sky, weather, lighting, foliage, particles, rigs | `beat-pulse`, `sky-weather-lighting`, `foliage`, `particles`, `firefly-visibility`, `impacts`, `dandelion-seeds`, `hero-animation` |
| `audio`       | Pushing this frame's world state into the music engine                             | `generative-audio-context`, `living-score`                                                                                         |
| `render-prep` | Post-FX uniforms, camera handoff, GPU compute dispatch                             | `postfx-uniforms`, `explore-camera`, `gpu-compute`                                                                                 |
| `postfx`      | The render                                                                         | `render`                                                                                                                           |
| `ui`          | DOM work that must see the rendered frame                                          | none yet (the HUD still updates inside `gameplay`)                                                                                 |

`tests/fixtures/frame-order.json` pins the resolved order, and
`npm run test:scheduler` fails on any change. The audio _analysis_ is not a
system: it runs before the scheduler, so every phase sees the same
`ctx.audio`. The `audio` phase is for systems that feed state _into_ the music
engine.

### What moved when the frame went onto the scheduler

Before #1973 the hand-written list ran player physics and gameplay last, just
before the render. Visuals, particles and post-FX therefore read the
previous frame's player position. In the phased order physics runs in
`simulate`, ahead of everything that reads it, so that one-frame lag is gone.
Fauna, behaviors, sugar-caves traversal and presence now run after physics
too (all read the player and none write it). The other moves: the beat
flash/zoom pulse runs at the start of `animate`, after `input`, and the two
music-feed systems run after foliage and particles. Neither reads anything
those systems write.

## Registering a system

```ts
import type { System } from './scheduler/index.ts';

const mySystem: System = {
    id: 'my-system', // unique; shows up in logs and the order snapshot
    phase: 'animate',
    after: ['sky-weather-lighting'], // optional, same phase only; absent ids are ignored
    enabled: (ctx) => ctx.caps.computeAvailable, // optional per-frame gate
    update: (ctx) => {
        /* ctx.dt, ctx.time, ctx.audio, ctx.player, ctx.camera, ctx.caps … */
    },
    dispose: () => {}, // optional; called by unregister()
};
```

Add frame systems to `FRAME_SYSTEMS` and keep each entry as an object literal
that starts with `id` and then `phase`, because the order test parses them.
Then run `npx tsx tests/scheduler-order.test.ts --update` and commit the
snapshot. A system that registers itself at runtime can call
`frameScheduler.register(system)` (exported from `game-loop.ts`), which returns
an unregister function.

`FrameContext` is reused every frame, so don't keep a reference to it past
`update`.

## Fixed step

`FixedStepClock` (`scheduler/fixed-step.ts`) accumulates `ctx.dt`. Each frame
the `fixed` phase runs once per whole `fixedDt` owed, at most 5 times. If a
hitch owes more than that, the excess is dropped (the simulation slows down
instead of spiralling). In the `fixed` phase:

- `ctx.fixedDt` is the step to integrate with (not `ctx.dt`),
- `ctx.fixedTick` is the step's global index, starting at 0,
- `ctx.fixedAlpha` is the leftover fraction, which render code can use to
  interpolate between the last two fixed states.

The clock does no clock reads of its own, so the same sequence of deltas
always yields the same steps (`tests/scheduler.test.ts` checks 10k frames).
Nothing runs in `fixed` yet. Moving `player-physics` there also needs
render-side interpolation of the camera, so it gets its own PR. Seasons and
weather still hash wall-clock time.

## Errors and the circuit breaker

The scheduler catches every throw from `enabled` or `update`. The rest of the
frame still runs (before, one throw aborted the frame, render included).

- The first throw of a streak logs a `console.warn` with the error.
- After `maxConsecutiveErrors` throwing frames in a row (default 30), the
  system is disabled and logged once with `console.error`.
- A frame that doesn't throw resets the streak.
- `render` and `player-physics` set `maxConsecutiveErrors: Infinity`: they are
  never disabled, but they still warn only once per streak.

`frameScheduler.getStats()` returns per-system `lastMs` / `avgMs`, error counts
and paused/tripped state. `frameScheduler.setEnabled(id, on)` pauses a system,
or re-arms one the breaker tripped.

`safeUpdateBatcher` / `safeSystemUpdate` (`game-loop-core.ts`) still guard
individual calls inside the phase modules. They go away as those calls become
systems of their own.
