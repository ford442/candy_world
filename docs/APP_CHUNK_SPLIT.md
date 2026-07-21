# App Chunk Split (#1361)

## Problem

Production builds emitted a single `chunks/app-*.js` ≈ **808 KB** (240 KB gzip) because
`vite.config.js` `manualChunks` merged `core`, `foliage`, `systems`, `world`, `ui`,
`gameplay`, and `utils` into one chunk to avoid Rollup circular chunk dependencies.

Vite warned: *"Some chunks are larger than 500 kB"*. First paint downloaded the entire
game brain even when the loading screen only needed core + vendor.

## Baseline (before)

| Chunk | Raw | Gzip |
|-------|-----|------|
| `app` | 807.87 KB | 239.52 KB |
| `vendor` | 1068.90 KB | 281.96 KB |
| `audio` | 18.17 KB | 5.48 KB |
| `compute` | 10.87 KB | 3.51 KB |

### Top source contributors (approx. by directory, TypeScript)

| Directory | Source bytes | Notes |
|-----------|--------------|-------|
| `src/foliage/` | ~857 KB | Batchers, materials, sky — stays in `app` (hot path) |
| `src/systems/` | ~737 KB | Music reactivity, weather, physics — stays in `app` |
| `src/utils/` | ~315 KB | WASM loader, profilers — stays in `app` |
| `src/core/` | ~269 KB | Boot + game loop — stays in `app` |
| `src/ui/` | ~210 KB | Save menu + analytics were in boot via barrel |
| `src/world/` | ~200 KB | Decorators eagerly imported |
| `src/gameplay/` + glitch | ~52 KB | Statically imported from main / game-loop / HUD |

## Changes

### 1. Break foliage ↔ music-reactivity cycles

- New leaf: `src/systems/music-wave.ts` (`ActiveWave`, `computeWaveDistSq`,
  `computeWaveTimeSinceArrival`, `getActiveWave` / `setActiveWave`).
- Foliage batchers / plant-pose import the leaf only — no import of
  `musicReactivitySystem`.
- Removed dead batcher / sky imports from `music-reactivity-core.ts`.

### 2. Lazy-load heavy subsystems

| Chunk | Trigger | Entry |
|-------|---------|-------|
| `gameplay` | After `__sceneReady` preload, or first ability use | `src/gameplay/lazy.ts` → `import('./index.ts')` |
| `save-ui` | `window.openSaveMenu` / menu open | `src/ui/save-menu/lazy.ts` |
| `analytics-debug` | `?debug=1` or `toggleAnalyticsDebug()` | `src/ui/analytics-debug-lazy.ts` |
| `world-content` | During `populateWorld` procedural extras | dynamic `import('./generation-decorators.ts')` |

`src/ui/index.ts` no longer re-exports save-menu / analytics (loading screen only).

### 3. `manualChunks`

Named lazy chunks above; remaining intertwined modules still land in `app`.
Thin `*lazy.ts` stubs stay in `app` so the initial graph does not sync-depend on
the heavy chunks.

## Budget

`budget:check` matches chunk filenames containing `main` / `index` / `vendor` / `wasm`
(see `tools/build-optimizer/src/performance-budget.ts`). The large `app` chunk is
**not** the `main` budget line item.

### After this change

| Chunk | Raw | Gzip |
|-------|-----|------|
| `app` | ~724 KB | ~220 KB |
| `save-ui` | ~45 KB | ~10 KB |
| `analytics-debug` | ~21 KB | ~5 KB |
| `gameplay` | ~16 KB | ~5 KB |
| `world-content` | ~8 KB | ~3 KB |

**Exception:** `app` remains **above Vite’s 500 KB warning** because the foliage batchers +
music-reactivity + physics hot path must stay co-located to avoid circular chunk deps.
This PR removes ~84 KB from the critical path (gameplay / save-ui / analytics / world
decorators). Further cuts need a follow-up that peels weather / particles without
reintroducing circular chunk edges.

## Non-goals

- Not splitting `vendor` / Three.js.
- Not changing runtime behaviour beyond load order (abilities no-op until gameplay
  chunk resolves; HUD mine cooldown reads `0` until then).
