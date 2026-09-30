# App Chunk Split (#1361 / #1450 / #1495)

## Problem

Production builds emitted a single `chunks/app-*.js` that bundled core, foliage,
systems, world, and UI into one Rollup chunk to avoid circular _chunk_ graphs.
First paint downloaded the full game brain even when optional features (presence,
photo mode, generative audio, debug overlays) were off.

Vite warns when any chunk exceeds 500 KB raw. The `app` chunk can sit near that
soft limit because foliage batchers + music-reactivity + physics stay co-located.

## State after #1827 (2026-09-30)

- **Runtime import cycles are at zero** from `src/main.ts` and gated by
  `npm run test:cycles` and ESLint `import/no-cycle`. Every `is not a function`
  TDZ failure recorded below came from evaluating a module inside a cycle, so a
  peel can no longer TDZ at boot for that reason.
- **One constraint is left: the top-level `await runBootstrap()` in
  `src/core/main.ts`.** Until bootstrap resolves, the `app` chunk is still
  evaluating. A lazy chunk that statically imports `app` and is awaited *inside*
  `runBootstrap()` (scene, audio/world, input and WASM pipelines) waits for
  `app`, which waits for it: boot deadlocks. Chunks loaded after bootstrap
  (debug, save-ui, map-loader, world-content, ...) only wait, which is why they
  work. This is what keeps `weather` a static dependency of `app`.
- `app` is **737 KB** raw (was 760). Moved out: the `generation-decorators-*`
  populators (to `world-content`), the `map-loader-*` helpers (to `map-loader`),
  `weather-utils.ts` (to `weather`), systems telemetry and the hero rig loader
  (to `debug`). Each was reachable only through the chunk it moved to, so its
  load trigger and that chunk's imports did not change. `playlist-manager.ts`
  moved back into `app` (it was a 6 KB circular chunk). `profiler` no longer
  imports `app`: the GPU context source is injected from `loading-bootstrap.ts`.
- **Remaining warning:** `Circular chunk: weather -> app -> weather`. Removing it
  needs the top-level await gone (`void runBootstrap()` with an explicit error
  path) and the particle/compute systems loaded lazily from the game loop. That
  change needs a browser boot to verify, so it is left for a follow-up.

## Targets

| Metric                  | Hard ceiling                               | Stretch | Notes                                                                                     |
| ----------------------- | ------------------------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| `app` raw (`build:ci`)  | **620 KB**                                 | 500 KB  | 600 KB peels (`world-gen`, `loading-ui` DOM, `discovery-persistence`→save-ui) TDZ at boot |
| Vite warning            | 500 KB                                     | —       | Informational until a cycle-safe foliage peel                                             |
| Critical-path flags off | presence / photo / generative not in `app` | —       | Verify: `rg createClient dist/chunks/app-*.js` should miss                                |

Confirm flags-off: `pnpm run analyze:bundle` or grep `dist/chunks/app-*.js` for
`createClient` / `GenerativeEngine` / `initPhotoMode`.

## Baseline (pre-#1495 peel, ~778–808 KB `app`)

| Chunk    | Raw         | Gzip    |
| -------- | ----------- | ------- |
| `app`    | ~778–808 KB | ~239 KB |
| `vendor` | ~1069 KB    | ~282 KB |

## After this peel (`build:ci`)

| Chunk              | Raw (approx.) | Gzip    | Critical path when                                    |
| ------------------ | ------------- | ------- | ----------------------------------------------------- |
| `app`              | **~617 KB**   | ~195 KB | Always (foliage + physics + music-reactivity + audio) |
| `vendor`           | ~955 KB       | ~260 KB | Always                                                |
| `weather`          | ~111 KB       | ~31 KB  | Boot (orchestrator + particles + compute + berries)   |
| `save-ui`          | ~64 KB        | ~16 KB  | `openSaveMenu`                                        |
| `accessibility-ui` | ~37 KB        | ~10 KB  | Accessibility menu                                    |
| `analytics-debug`  | ~36 KB        | ~9 KB   | `?debug=1` / `/stats`                                 |
| `debug`            | ~30 KB        | ~10 KB  | `?debug=*`                                            |
| `presence`         | ~20 KB        | ~7 KB   | `FEATURE_FLAGS.presence`                              |
| `gameplay`         | ~16 KB        | ~5 KB   | After `__sceneReady` / first ability                  |
| `map-loader`       | ~16 KB        | ~5 KB   | Enter / map fetch                                     |
| `world-content`    | ~14 KB        | ~5 KB   | Procedural extras                                     |
| `profiler`         | ~14 KB        | ~5 KB   | Boot (circular with `app`)                            |
| `photo-mode`       | ~13 KB        | ~4 KB   | `FEATURE_FLAGS.photoMode` or **P**                    |
| `generative-music` | ~11 KB        | ~4 KB   | `?generative=1` / `enableGenerativeMode()`            |
| `playlist-ui`      | ~10 KB        | ~3 KB   | Boot (circular with `app`)                            |
| `awakened`         | ~9 KB         | ~3 KB   | `?awakened`                                           |

**Accepted Rollup circular-chunk warnings:** `weather ↔ app` only (since #1827;
`playlist-ui` and `profiler` were fixed). Do **not** reintroduce `Circular chunk: compute ↔ app`,
`loading-ui ↔ app` (loading-screen DOM peel), `save-ui ↔ app` (discovery-persistence),
or `world-gen ↔ app` — those TDZ at boot (`is not a function`).

**Do not** split foliage batchers that import `music-reactivity` / `foliage/index`
into async chunks (TSL live bindings).

## Cycle map

Rollup **chunk** cycles are limited to the accepted pairs above. TypeScript
**module** cycles still exist inside `app` (foliage ↔ systems).

```mermaid
flowchart LR
  subgraph app_chunk["app hot path"]
    core["core / game-loop"]
    foliage["foliage batchers"]
    systems["physics / music-reactivity"]
    utils["wasm-loader"]
  end
  subgraph async_chunks["Flag / stage dynamic import"]
    presence["presence"]
    photo["photo-mode"]
    gen["generative-music"]
    mapLoader["map-loader"]
    debug["debug"]
  end
  weather["weather"]
  vendor["vendor"]

  core --> foliage
  foliage --> systems
  systems --> foliage
  core -.->|dynamic import| async_chunks
  foliage <-->|static| weather
  app_chunk --> vendor
```

Representative madge module cycle (stays inside `app`):

```
foliage/index → animation → batcher → ecs/world → wasm-loader → loading-screen
  → luminous-plant-batcher → … → foliage/index
```

## Contributor table (must stay in `app`)

| Area                                       | Why co-located                  |
| ------------------------------------------ | ------------------------------- |
| `src/foliage/*` batchers + `foliage/index` | TSL uniform live bindings       |
| `src/systems/music-reactivity*.ts`         | Shared uniforms with batchers   |
| `src/systems/physics/*`                    | Per-frame player + discovery    |
| `src/utils/wasm-loader*`                   | Ground height + boot pipeline   |
| `src/core/game-loop*.ts`                   | Frame coordinator               |
| `src/rendering/gpu-context.ts`             | WebGPU device (boot)            |
| `src/audio/*` except generative engine     | Boot audio + beat sync          |
| `src/core/hud.ts`, `camera-modes.ts`       | Boot UI; chunk cycles with core |

| Area                                                       | Separate chunk                     |
| ---------------------------------------------------------- | ---------------------------------- |
| weather / particles / compute                              | `weather` (do not fold into `app`) |
| `src/systems/net/*` except `lazy.ts` + `biome-at-position` | `presence`                         |
| `src/systems/photo-mode/*` except `lazy.ts`                | `photo-mode`                       |
| `src/world/map-loader.ts`                                  | `map-loader`                       |

Presence reverse edges were cut: `spawnImpact` is injected from `net/lazy.ts`;
avatars parent to the scene instead of `foliageGroup`. Photo-mode receives
post-FX uniforms and explore-camera APIs via `PhotoModeInitOptions`.

## Safe extractions (implemented)

| Chunk              | Trigger                                                                          | Entry stub                                           |
| ------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `debug`            | `?debugHeights` / `?debugPlace` / `?debugCircadian` / `?debugFauna` / `?debug=1` | `src/debug/tools-stub.ts`, `src/debug/lazy.ts`       |
| `presence`         | `FEATURE_FLAGS.presence`                                                         | `src/systems/net/lazy.ts`, `src/ui/presence-lazy.ts` |
| `photo-mode`       | `FEATURE_FLAGS.photoMode` or **P**                                               | `src/systems/photo-mode/lazy.ts`                     |
| `generative-music` | `enableGenerativeMode()` / `?generative=1`                                       | `audio-system-playback.ts`                           |
| `awakened`         | `FEATURE_FLAGS.awakenedPersistence`                                              | `src/systems/awakened-persistence-api.ts`            |
| `gameplay`         | `preloadGameplay()` / abilities                                                  | `src/gameplay/lazy.ts`                               |
| `save-ui`          | `openSaveMenu`                                                                   | `src/ui/save-menu/lazy.ts`                           |
| `map-loader`       | map fetch                                                                        | dynamic `import()` from `generation-core.ts`         |
| `shader-warmup`    | Loading warmup phase                                                             | `deferred-init.ts`                                   |
| `accessibility-ui` | First accessibility menu open                                                    | `accessibility-menu-lazy.ts`                         |

## Power-tier loading

`getLoadMemoryTier()` / `getLoadMemoryScale()` in `src/core/config/runtime.ts`
scale spawn counts and batcher caps. `shouldPreferLightWorldLoad()` is true for:

- RAM tier `critical` / `low`
- `?lite=1` / `?webglLite=1`
- GPU hints from `gpu-context` after arm: fallback adapter, integrated-looking
  vendor strings, or `maxStorageBufferBindingSize` at the spec 128 MiB floor

When that is true **and** the user has not set a boot path via URL/storage,
`resolveDefaultProfile()` uses graphics `low` and path `core`.

`GPU_POWER_PREFERENCE` remains `high-performance` on the single shared device.

## Budget

`pnpm run budget:check` enforces `budgets.json` → `app: 740kb` (raw `app-*.js`; 737 KB
after #1827). The 620 KB target stands.
A 600 KB ceiling was attempted; `world-gen`, loading-screen DOM, and
`discovery-persistence` in `save-ui` each failed boot with TDZ (`is not a function`).

## Non-goals

- Not splitting `vendor` / Three.js.
- No visual redesign.
- No deletion of WASM fallbacks.
- Foliage batchers with live music bindings stay in `app`.

## Follow-ups

- Break `weather ↔ app`: drop the top-level await in `core/main.ts`, then load
  particles/compute lazily from the game loop (see "State after #1827").
- Stretch 500 KB: make more of the boot graph lazy (world generation, map loading).
- Config hygiene in parallel.

## Refs

- `vite.config.js` `manualChunks` (`clustered-bin.ts` → `clustered-lights` chunk so Forward+ packing stays under the 630 KB `app` ceiling)
- Prior: #1361, #1450, #1495
- `FEATURE_FLAGS` in `src/core/config/url-flags.ts`
