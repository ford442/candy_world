# Ground System Unification — Issue #1265

## Goal

Unify and harden ground-height computation for Candy World so the first-person
camera stays smooth and batched foliage (trees, mushrooms, rocks) sits flush on
the ground. This also provides the foundation for #1266 (walkable cloud
platforms).

## What Changed

### 1. New authoritative module: `src/systems/ground-system.ts`

- Single source of truth for lake/island constants:
  `LAKE_BOUNDS`, `LAKE_BOTTOM`, `LAKE_ISLAND`, `isInLakeBasin`,
  `isOnLakeIsland`.
- Authoritative query `getGroundHeight(x, z)` applies, in order:
  1. Registered walkable platform overrides (foundation for #1266).
  2. Raw WASM terrain height.
  3. Lake Melody carving + Lake Island rise.
- Fixed-size exact-position cache (256 slots) avoids redundant WASM calls when
  multiple systems ask for the same point.
- `registerPlatform` / `unregisterPlatform` / `getPlatforms` hooks.
- `getGroundHeightBatch(positions)` for batched queries.

### 2. Centralized consumers

All main-thread systems now read from `GroundSystem` instead of duplicating
lake/island math or calling the raw WASM terrain function directly:

- `src/systems/physics.core.ts` — `getUnifiedGroundHeightTyped()` delegates to
  GroundSystem; lake helpers re-exported for compatibility.
- `src/systems/physics/physics-core.ts` — uses `isInLakeBasin` from GroundSystem.
- `src/systems/physics/physics-states.ts` — local unified helper delegates to
  GroundSystem.
- `src/systems/physics/physics-updates.ts` — JS fallback uses authoritative
  height.
- `src/core/camera-modes.ts` — `snapCameraToGround()` uses authoritative height.
- `src/core/game-loop.ts` — falling clouds receive authoritative height.
- `src/systems/glitch-grenade.ts` — grenade ground collision uses authoritative
  height.
- `src/gameplay/rainbow-blaster.ts` — water-basin check uses GroundSystem lake
  helper.
- `src/world/generation-utils.ts` — `getUnifiedGroundHeight()` delegates to
  GroundSystem; lake constants re-exported.
- `src/world/ground-heightmap.ts` and `src/core/main.ts` — use authoritative
  height.

Workers (`src/workers/physics-worker.ts`, `src/workers/worldgen-worker.ts`)
still contain duplicate lake constants. They run in threads that cannot easily
import `GroundSystem` (it depends on DOM/window via `wasm-loader` and
`CONFIG`), so they are left as a known follow-up.

### 3. Data-driven eye height and ground-follow tuning

Added to `src/core/config.ts`:

```ts
player: {
    eyeHeight: 1.8,        // camera height above ground
    spawnEyeHeightY: 5.0,  // transient camera Y before first ground snap
},
ground: {
    followLerpSpeed: 12.0, // vertical smoothing speed (units/sec)
    followMaxStep: 2.5,    // max vertical change per frame
    cacheCellSize: 2.0,    // GroundSystem cache cell size
    cacheTTL: 1.0,         // cache entry lifetime in seconds
}
```

- `PLAYER_HEIGHT_OFFSET` in `src/systems/physics/physics-types.ts` is now an
  alias to `CONFIG.player.eyeHeight`, preserving all legacy call sites.
- Camera startup `y = 5` replaced with `CONFIG.player.spawnEyeHeightY`.
- Startup ground snap uses `CONFIG.player.eyeHeight`.
- `src/systems/physics/physics-core.ts` camera sync now uses
  `CONFIG.ground.followLerpSpeed` + `followMaxStep` instead of a hard-coded
  `15.0` lerp.

### 4. C++ physics Y reconciliation

After the AssemblyScript `updatePhysicsCPP` returns, the player Y is reconciled
against the authoritative GroundSystem height. This prevents the player from
floating or sinking where the physics module's raw terrain sampling disagrees
with the visually carved lake/island surface.

### 5. Debug visualizer

`src/debug/ground-debug.ts` adds optional overlays:

- `?debugPlayer=1` — yellow sphere at player eye, green sphere at ground, white
  line from target eye height to actual camera Y.
- `?debugHeights=1` — 9×9 grid of vertical posts and ground-surface boxes
  sampled around the player each frame.

Hooked into `src/core/game-loop.ts`; helpers are only created when a flag is
present, so release builds pay zero cost.

### 6. incidental bug fixes

While routing imports, several pre-existing syntax errors were fixed that
blocked TypeScript parsing and could throw at runtime:

- `src/foliage/lod.ts` — `this.if (billboardMesh)` → `this.billboardMesh.visible`.
- `src/rendering/culling/culling-system.ts` — repaired botched `obj.if`
  / `return obj ? if (...)` statements.
- `src/core/camera-modes.ts` — added missing `TRANSITION_DURATION` constant.
- `src/particles/compute-particles.ts` — removed duplicate `isCIorHeadless`
  import.

## Verification

| Command | Result |
|---------|--------|
| `npm run build:ci` | ✅ green |
| `npm run test:wasm` | ✅ green |
| `npm run test` | ⚠️ fails in this headless VM (SwiftShader WebGPU device loss) |
| `FULL_BOOT=fast npm run test` | ⚠️ fails (runner exits 0 because FULL_BOOT ignores flakey WebGPU) |
| `RENDERER=webgl npm run test` | ⚠️ fails in this headless VM (scene-ready timeout) |

The build and WASM bounds tests pass. The browser smoke tests fail because the
Cursor Cloud VM has no real GPU and SwiftShader WebGPU is unstable; this is a
known environment limitation documented in `AGENTS.md`. The changes should be
smoke-tested on hardware with stable WebGPU before merge.

## Tuning Notes

- If the camera still feels jittery, raise `CONFIG.ground.followLerpSpeed`
  (snappier) or lower it (smoother). `followMaxStep` prevents large jumps on
  teleports/falls.
- If the cache is too small for dense foliage queries, increase
  `CONFIG.ground.cacheTTL` or reduce `cacheCellSize`.
- To add walkable cloud platforms (#1266), call
  `registerPlatform({ id, minX, minY, minZ, maxX, maxY, maxZ, priority })` and
  the authoritative query will lift the player/camera to `maxY` inside the
  bounds.
