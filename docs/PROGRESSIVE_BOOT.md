# Progressive Boot Pipeline

Boot is a fixed sequence of named **stages** (`core` → `postProcessing` → `audio`
→ `weather` → `worldCritical` → … → `shaderWarmup`, then `worldGeneration` and the
deferred stages after the player presses Enter). Every stage runs through
`runBootStage()`. With no URL switches that is a thin wrapper over
`StageLoader.loadStage()`: failures are logged and returned, nothing is skipped,
and boot behaves as it always has.

The switches below turn the wrapper into a debugging tool. A failed critical stage
**halts** boot and names the stage; stages that depend on a failed stage are
**skipped** with the reason, instead of crashing later on an `undefined`.

This replaces the "boot hangs silently at a percentage" failure mode. It is debug
tooling, not part of the player path.

## URL switches

```
?halt=1                          # halt on critical failure, skip dependents of failures
?boot=scene|sandbox|limited|standard|full   # apply a stage preset (implies stage gating)
?debug=1                         # debug panel + limited preset + halt (existing switch)
?bootfail=<stage>                # force that stage to throw; needs halt, debug or boot
```

- `?halt` and `?halt=1` are on; `?halt=0`, `false` and `off` are off.
- `?boot=` switches stage gating on by itself: stages the preset disables are
  skipped. Without `?boot=` or `?debug=1` the `DEBUG_STAGES` flags are ignored and
  every stage runs.
- `?boot=` alone does not halt. Add `?halt=1` for that.

### Presets

| Preset               | Stages enabled                                                                                              | Use                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `scene`              | `core`, `postProcessing`                                                                                    | Is the renderer / scene setup the problem?     |
| `sandbox`, `limited` | Core scene + audio, weather, critical world, input, game loop; no world generation, warmup, WASM or post-FX | First sanity boot; the `DEBUG_STAGES` defaults |
| `standard`           | Everything through the game loop plus post-FX, warmup and WASM; world generation still off                  | Normal development                             |
| `full`               | All stages including `worldGeneration` and the deferred stages                                              | Full load                                      |

Recommended progression: `?boot=scene` → `?debug=1&boot=sandbox` → enable stages
one at a time in the debug panel → `?boot=full`.

`worldGeneration` is off in every preset except `full`, so pressing Enter under
`sandbox` / `limited` / `standard` skips it. Use `full`, or enable the stage in
the debug panel.

## Halting and dependencies

Each stage is described in `src/debug/boot-registry.ts` (`STAGE_REGISTRY`): its
order, whether it is **critical**, and the stages it depends on.

- **Critical stages** are `core`, `worldCritical` and `gameLoop`. If one fails
  while halting is on, `runBootStage()` prints the stage table and throws
  `BootHaltError`. `runBootstrap()` shows an overlay that names the stage and
  rethrows, so boot stops.
- A **non-critical failure** is logged as a warning and boot continues.
- A stage is **skipped, not run** when a dependency failed, or when a critical
  dependency was skipped or is disabled. The reason is logged
  (`[worldCritical] ⏭️ SKIPPED (dependency "weather" failed)`) and the result is
  `{ success: false, skipped: true, error: <reason> }`.
- A stage skipped because a preset disabled it is `{ success: true, skipped: true }`
  and counts as skipped, not completed.
- Once halted, every later stage is skipped with `pipeline already halted`.

If the WebGPU probe fails, `scene-pipeline.ts` shows the WebGPU diagnostics screen
and the halt overlay stays out of its way.

## Console helpers

```js
window.__bootPipeline.summary(); // print the stage table
window.__bootPipeline.state(); // { halted, haltStage, completed, failed, skipped }
window.__bootPipeline.stages(); // current DEBUG_STAGES flags
window.__bootPipeline.preset('full'); // apply a preset to stages that have not run yet
```

Verbose output (per-stage trace and the summary printed after shader warmup) is on
whenever `?halt`, `?debug` or `?boot` is present.

## Where the code is

```
src/debug/boot-registry.ts         stage order, dependencies, critical flags, presets
src/debug/progressive-bootstrap.ts runBootStage(), BootHaltError, URL parsing, summary, window hooks
src/debug/stages.ts                StageLoader, DEBUG_STAGES flags, isStageGatingActive()
src/core/main/bootstrap.ts         initProgressiveBoot(), halt overlay
src/core/main/*-pipeline.ts        the stage call sites (scene, audio-world, input, wasm)
src/core/main/shader-warmup.ts     shaderWarmup stage, end-of-boot summary
src/core/main/start-screen.ts      worldGeneration and deferredVisuals stages
src/core/main/deferred-loading.ts  deferredWorld stage
```

`progressive-bootstrap.ts` and `boot-registry.ts` are used during
`runBootstrap()`, so `vite.config.js` keeps them out of the lazy `debug` chunk. A
lazy chunk that boot waits on, while `app` is still held open by its top-level
await, deadlocks boot; the comments in `vite.config.js` mention the same trap for
`weather` and `postfx`.

## Adding a stage

1. Add its key to `DebugStages` and `DEBUG_STAGES` in `src/debug/stages.ts`.
2. Add a `STAGE_REGISTRY` entry (order, critical, `dependsOn`) and a value in every
   preset in `src/debug/boot-registry.ts`.
3. Wrap the work in `runBootStage('<id>', ...)`. Do not call `StageLoader.loadStage`
   directly, or halt and dependency-skip will not apply.

`tests/progressive-boot.test.mjs` fails if the registry, the presets and the call
sites disagree.

## Tests

```
npm run test:progressive-boot
```

Covers the default (no-switch) behaviour, halt and dependency-skip, the URL
switches, the registry invariants, and a scan of `src/` that every registry stage
still has a `runBootStage` call site. It is part of `npm run test:fast`.

## History

The pipeline first landed in PR #1191 (`b9ac3905`) and was deleted the same day by
the stale-branch merge of PR #1192 (`dad3e734`). It was ported back onto the split
`src/core/main/*` bootstrap rather than cherry-picked, because `main.ts` had been
broken up since. The wiring test above exists so a repeat is not silent.
