# Progressive Boot Pipeline

## Evaluation of the Previous Setup

The project had **two parallel startup systems** that were not unified:

| System | Trigger | Purpose |
|--------|---------|---------|
| **Debug staging** (`StageLoader`, `?debug=1`) | URL + panel checkboxes | Skip individual subsystems to isolate failures |
| **World modes** (CORE / FULL / FAST_FULL) | Start-screen buttons | Control map population depth on Enter |

### What worked well

- Colored per-stage console logs (`✓` / `✗` / `⏭️`) made it easy to see which subsystem finished
- The sandbox `DEBUG_STAGES` default correctly disabled heavy stages (shader warmup, world gen, WASM)
- CORE vs FULL buttons gave users a fast path without touching debug URLs
- Error boundary + loading-screen race guard prevented silent hangs

### Gaps

1. **No halt on failure** — failed stages logged red but boot continued, masking the root cause
2. **No dependency graph** — disabling `weather` did not auto-skip `worldCritical` with a clear reason
3. **Debug-only stage skipping** — `?debug=1` required; `?halt=1` did not exist for CI/headless
4. **Two mental models** — debug stages vs world modes were unrelated; no `sandbox → full` progression
5. **Duplicated deferred visuals** — `deferredVisuals` ran via both `DeferredLoader` and background processor
6. **Panel toggles need reload** — checkbox changes don't apply until refresh

## New Progressive Boot

### URL parameters

```
?debug=1                  # Debug panel + limited sandbox preset + halt on critical failure
?halt=1                   # Halt on critical failure without full debug UI
?boot=sandbox|limited|standard|full   # Apply a stage preset
```

### Presets

| Preset | Stages enabled | Use case |
|--------|----------------|----------|
| `sandbox` / `limited` | Core scene + minimal systems, no world gen | First boot sanity check |
| `standard` | Through game loop + shader warmup, Enter triggers world | Normal dev |
| `full` | All stages including deferred | Full progressive load |

### Recommended progression

1. `?debug=1&boot=sandbox` — verify renderer, terrain, Enter button
2. Enable `shaderWarmup` in panel → reload
3. Enable `worldGeneration` → Enter world
4. Enable `postProcessing`, `wasm`, `deferredVisuals`, `deferredWorld` one at a time
5. Or jump to `?boot=full` once stable

### Console helpers

```js
window.__bootPipeline.summary()   // Print stage table
window.__bootPipeline.state()     // { completed, failed, skipped, halted }
window.__bootPipeline.preset('standard')  // Apply preset (reload required)
```

## Architecture

```
src/debug/boot-registry.ts       — Stage order, dependencies, presets
src/debug/progressive-bootstrap.ts — runBootStage(), halt, dependency skip
src/core/progressive-startup.ts  — Pre-loop pipeline (core → wasm)
src/core/main.ts                 — Shader warmup, Enter world, deferred queues
```

## Files

- `src/debug/stages.ts` — Stage flags + `StageLoader` (unchanged API)
- `src/debug/progressive-bootstrap.ts` — Orchestrator
- `tests/progressive-boot.test.mjs` — Dependency + halt unit tests
