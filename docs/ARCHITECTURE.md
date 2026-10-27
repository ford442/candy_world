# Engine architecture

How a frame runs, how to add a system to it, how the fixed step works, and who
owns entities today. Issue #1973 tracks the foundation work. Its first two
slices, the scheduler and the fixed step, are what this page describes. The
entity registry and the `InstancedBatcher` base are still to come; see the end.

## The frame

`animate()` (`src/core/game-loop.ts`) calls no system directly. Each frame it:

1. reads the clock (photo mode can scale or freeze the delta; clamped to 0.1 s),
2. calls `frameScheduler.runFrame(...)`, which
    1. samples the **frame source** (`audioClockSource` in
       `game-loop-audio.ts`): audio is analysed once and game time advances at
       the track's tempo, so every system sees the same `ctx.audio` and
       `ctx.time`;
    2. runs every registered system in phase order. The `fixed` phase runs
       0–5 times at `fixedDt`, and every other phase runs once;
3. reads back GPU timings for the performance budget.

The scheduler is in `src/core/scheduler/`. The frame's systems are declared in
`src/core/game-loop-systems.ts` (`FRAME_SYSTEMS`), and `frameScheduler` is the
instance `animate()` runs (`scheduler/frame-scheduler.ts`).

## Phases

Phases run in this order. Within a phase, systems run in registration order
unless `after` / `before` say otherwise.

| Phase         | What belongs here                                                                  | Systems today                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `input`       | Device reads, raycasts, clamping the player to streamed terrain                    | `interaction`, `chunk-streaming`                                                                                                   |
| `fixed`       | Deterministic simulation at `fixedDt` (1/60 s), 0–5 times per frame                | `player-physics`                                                                                                                   |
| `simulate`    | The render-side view of the fixed state, then variable-step simulation             | `player-view`, `rigid-bodies`, `fauna`, `entity-behaviors`, `sugar-caves-traversal`, `presence`, `gameplay`                        |
| `animate`     | Things that read the settled sim: sky, weather, lighting, foliage, particles, rigs | `beat-pulse`, `sky-weather-lighting`, `foliage`, `particles`, `firefly-visibility`, `impacts`, `dandelion-seeds`, `hero-animation` |
| `audio`       | Pushing this frame's world state into the music engine                             | `generative-audio-context`, `living-score`                                                                                         |
| `render-prep` | Post-FX uniforms, camera handoff, GPU compute dispatch                             | `postfx-uniforms`, `explore-camera`, `gpu-compute`                                                                                 |
| `postfx`      | The render                                                                         | `render`                                                                                                                           |
| `ui`          | DOM work that must see the rendered frame                                          | none yet (the HUD still updates inside `gameplay`)                                                                                 |

`tests/fixtures/frame-order.json` pins the resolved order, frame source first.
`npm run test:scheduler` fails on any change, and also fails if `animate()`
calls an `update*` / `tick*` function itself. The `audio` phase is for systems
that feed state _into_ the music engine. The audio _analysis_ is the frame
source.

### What moved when the frame went onto the scheduler

Before #1973, the hand-written list ran player physics and gameplay last, just
before the render. Visuals, particles and post-FX therefore read the previous
frame's player position. Physics now runs in `fixed`, ahead of everything that
reads it, so that one-frame lag is gone. Fauna, behaviors, sugar-caves
traversal and presence now run after physics too: all read the player, and
none write it. The beat flash/zoom pulse runs at the start of `animate`, after
`input`. The two music-feed systems run after foliage and particles. Neither
reads anything those systems write.

## Registering a system

```ts
import { registerSystem, type System } from './scheduler/index.ts';

const mySystem: System = {
    id: 'my-system', // unique; shows up in logs, the debug panel and the order snapshot
    phase: 'animate',
    after: ['sky-weather-lighting'], // optional, same phase only; absent ids are ignored
    budgetMs: 0.5, // optional CPU budget per frame, checked after warm-up
    enabled: (ctx) => ctx.caps.computeAvailable, // optional per-frame gate
    update: (ctx) => {
        /* ctx.dt, ctx.time, ctx.audio, ctx.player, ctx.camera, ctx.caps … */
    },
    dispose: () => {}, // optional; called on unregister
};

const unregister = registerSystem(mySystem);
```

- **Core frame systems** go in `FRAME_SYSTEMS`. Keep each entry an object
  literal that starts with `id` and then `phase`, because the order test parses
  them. Then run `npx tsx tests/scheduler-order.test.ts --update` and commit the
  snapshot.
- **A feature that registers at runtime** calls `registerSystem(system)` and
  keeps the unregister function. Registration resolves the order straight away.
  An ordering cycle or a duplicate id throws at the `registerSystem` call that
  caused it, and leaves the scheduler unchanged.
- `FrameContext` is reused every frame, so don't keep a reference to it past
  `update`.

## Fixed step

`FixedStepClock` (`scheduler/fixed-step.ts`) accumulates `ctx.dt`. Each frame,
the `fixed` phase runs once for each whole `fixedDt` owed, at most 5 times. If a
hitch owes more than that, the excess is dropped (the simulation slows down
instead of spiralling); the debug panel shows the dropped seconds. In the
`fixed` phase:

- `ctx.fixedDt` is the step to integrate with (not `ctx.dt`),
- `ctx.fixedTick` is the step's global index, starting at 0,
- `ctx.fixedSteps` is how many steps this frame runs,
- `ctx.fixedAlpha` is the leftover fraction. The render blends the last two
  fixed states by it.

**Render interpolation.** `player-physics` writes `player` and the camera at
60 Hz. `player-view` (first in `simulate`) uses `PlayerInterpolator`
(`systems/physics/player-interpolation.ts`) to blend the camera between the
last two fixed states by `fixedAlpha`. Player-following visuals (the
`uPlayerPosition` uniform, the sparkle trail, the shield) use the blended
player position too. Before the next step, the interpolator puts the sim's own
camera back, so the blend never feeds into the simulation.

- A camera moved by something else (spawn, teleport, the explore camera's exit)
  is adopted, not blended over.
- A move larger than 4 units in one step snaps.
- The cost is about half a fixed step of render latency, the usual price of
  interpolation.

**What is not on the fixed step yet.**

- **Rigid bodies and joints:** the solver syncs mesh transforms inside its own
  step, so they need per-body interpolation first.
- **Fauna / boids and particle integration:** they need the same, and still run
  in `simulate` / `animate` at `ctx.dt`.
- **Seasons and weather:** they still hash wall-clock time.

### Determinism rules for `fixed` code

- **Randomness** comes from `ctx.rng` (or `simRng` from `utils/sim-rng.ts`
  where there is no `ctx`; same instance). It is seeded from the world seed on
  the first frame. Draw from it only inside `fixed`: the number of fixed steps
  depends on game time alone, but a draw from a per-frame phase would make the
  stream depend on the frame rate.
- **Time** is `ctx.fixedTick` / `ctx.fixedDt`, or `physicsClock.ms` (the sum of
  physics step deltas) inside the physics helpers. Never use `performance.now()`
  or `Date.now()`. The vine re-attach and pine-launch cooldowns use
  `physicsClock`.
- **World generation** uses `getSeededRandom()` (`utils/seeded-random.ts`), the
  world-seed stream. ESLint's `no-restricted-properties` bans `Math.random`
  under `src/systems/physics/`, `src/systems/fauna/` and `src/world/`.

`npm run test:fixed-step` (`tests/fixed-step-determinism.test.ts`) runs the
real `updatePhysics` for 10,000 ticks from a seeded input log, each run in a
fresh process. It checks that the player and the sim camera end up
bit-identical across two runs, and across 60 Hz, 144 Hz, 30 Hz and jittery
frame pacing. The production camera blend runs between the steps in every
pacing.

## Errors, budgets and the debug panel

The scheduler catches every throw from `enabled` or `update`, and the rest of
the frame still runs.

- **Circuit breaker.** The first throw of a streak logs a `console.warn` with
  the error. After `maxConsecutiveErrors` throwing frames in a row (default
  30), the system is disabled and logged once with `console.error`. A frame
  that doesn't throw resets the streak. `render` and `player-physics` set
  `maxConsecutiveErrors: Infinity`: they are never disabled, but still warn only
  once per streak.
- **Frame source.** A throwing frame source keeps the last audio analysis, and
  time runs on.
- **Timing.** Every system's cost is reported each frame as a `system.<id>`
  profiler mark. A system with `budgetMs` is checked against its average after
  `BUDGET_WARMUP_FRAMES` (120). Going over sets `overBudget` and warns once.
  `rigid-bodies`, `fauna` and `particles` take their budgets from
  `SYSTEM_BUDGETS` (`docs/PERF_BUDGETS.md`).
- **Debug panel.** In the `?debug=1` panel, the _Frame Systems_ section lists
  every system with its phase, average ms against its budget, and
  gated / paused / tripped state. It also shows total CPU, the GPU frame time
  from timestamp queries (#1824), and the fixed tick. The checkbox on each row
  pauses the system live. Re-checking a tripped system re-arms it.
- **Console.** `window.__frameScheduler` exposes `getStats()`, `getOrder()` and
  `setEnabled(id, on)`.

`safeUpdateBatcher` and `safeSystemUpdate` (`game-loop-core.ts`) still guard
individual calls inside the phase modules. They go away as those calls become
systems of their own.

## Entities

Entity ownership hasn't moved yet: that is slice 3 of #1973. Today:

- Live map entities are tracked in module-level arrays in `src/world/state.ts`:
  `animatedFoliage`, `obstacles`, the per-kind `foliage*` lists, `vineSwings`,
  and the pre-filtered `computeFoliageObjects` / `interactiveObjects`. About
  40 modules import it.
- `src/world/entity-despawn.ts` is the single teardown path. It frees the
  batcher slot, splices the tracking arrays and removes the scene node.
  ChunkStreamer eviction and edit-history undo share it.
- Fauna, and the foliage bridge, also live in the Emscripten ECS behind
  `src/systems/ecs/world.ts`.

The planned registry replaces the arrays with `entities.spawn(kind, record)` /
`despawn(id)` / `query(kind)`. Each kind owns its spawn and despawn hooks, and
the arrays stay as read-only views while importers migrate.

## Still to do (#1973)

- **Slice 3:** the entity registry above, with `entity-despawn.ts` reduced to
  `entities.despawn(id)`, and one ECS.
- **Slice 4:** the `InstancedBatcher<TRecord>` base for the 25 batchers. Each
  batcher becomes a scheduler system.
- **Fixed step:** rigid bodies, fauna and particles move into `fixed` once they
  have render interpolation.
