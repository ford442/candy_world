# Migration Tracker

> Lightweight backlog for incremental TS → WASM/C++ slices.  
> Strategy: [`docs/archive/PERFORMANCE_MIGRATION_STRATEGY.md`](docs/archive/PERFORMANCE_MIGRATION_STRATEGY.md)  
> Status dashboard: [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md)  
> Labels: `migration`, `performance`, `wasm`, `c++` on [ford442/candy_world](https://github.com/ford442/candy_world)

---

## Recently completed (2026-07 batch)

| Issue | Slice | Landing |
|-------|-------|---------|
| [#1326](https://github.com/ford442/candy_world/issues/1326) | `.ts` import hygiene | No local `.js` specifiers for TS modules |
| [#1327](https://github.com/ford442/candy_world/issues/1327) | Unified ground height | `assembly/ground.ts`, `emscripten/ground.cpp`, `wasm-ground.ts` |
| [#1328](https://github.com/ford442/candy_world/issues/1328) | Foliage physics batches | `emscripten/foliage_interact.cpp`, `wasm-foliage-interact.ts` |
| [#1329](https://github.com/ford442/candy_world/issues/1329) | CPU particle sim kernel | `cpu-particle-simulate.ts`, `updateCpuParticlesWASM` |
| [#1330](https://github.com/ford442/candy_world/issues/1330) | Migration docs refresh | `MIGRATION_STATUS.md` (this tracker) |
| [#1364](https://github.com/ford442/candy_world/issues/1364) | arpeggio_grove channel accum → AS | `assembly/music_reactivity.ts`, `wasm-music-reactivity.ts`, `applyArpeggioGroveChannelAccum` (wired + `?nativeMusicAccum`) |

---

## Prioritized next slices (3–5)

Ranked by likely frame-time impact × feasibility. **File a GitHub issue before starting** each slice; link it here.

### 1. Batcher instance matrix + color hot path → C++ batch

**Status:** ✅ Completed for arpeggio (#1358) — dedicated `emscripten/batcher_instance.cpp` (`batchWriteInstancePose_c`) + `src/utils/wasm-batcher-instance.ts` with TS fallback; `arpeggio-batcher` wired. Tree still uses `batchComposeMatrices_c`. Widen to mushroom/portamento/wisteria only after parity stays green.

**Why:** `arpeggio-batcher.ts`, `tree-batcher.ts`, `mushroom-batcher.ts`, etc. still write `instanceMatrix.array` / `instanceColor.array` per plant per frame in TS after `PlantPoseMachine.update`.

**15% scope:** Extract *only* the matrix/color write loop for one batcher species (suggest `arpeggio-batcher`) into `emscripten/lod_batch.cpp` or a new `batcher_instance.cpp` batch export.

**Files:** `src/foliage/*-batcher.ts`, `src/foliage/plant-pose-machine.ts`, `emscripten/batcher_instance.cpp`, `src/utils/wasm-batcher-instance.ts`

**Fallback:** Keep existing TS direct array writes.

---

### 2. Music reactivity `update()` channel → uniform block

**Status:** ✅ Completed for arpeggio_grove (#1364) — `assembly/music_reactivity.ts` (`accumulateArpeggioChannels`) + `src/utils/wasm-music-reactivity.ts` with TS fallback; hot path in `applyArpeggioGroveChannelAccum` (`music-reactivity-core.ts`). Feature flag `?nativeMusicAccum=0` forces TS for A/B; default ON when WASM export present. Widen to crystalline_nebula / global only after parity stays green.

**Why:** `MusicReactivitySystem.update()` runs every frame across all biomes; `.core.ts` already extracted helpers but the main accumulator + smooth/decay loop is still monolithic TS for non-arpeggio biomes.

**15% scope:** Move channel volume accumulation + `nightGate` smoothing for **one biome** (e.g. `arpeggio_grove`) to a small AS or C++ batch; leave beat/sky-wave orchestration in TS.

**Files:** `src/systems/music-reactivity.ts`, `src/systems/music-reactivity-core.ts`, `src/utils/wasm-music-reactivity.ts`, `assembly/music_reactivity.ts`, `assets/music-bindings.json`

**Fallback:** Current TS `accumulateArpeggioChannelsTS` path when native unavailable or `?nativeMusicAccum=0`.

---

### 3. Vine attach / detach state machine → native proximity + flags

**Why:** [#1328](https://github.com/ford442/candy_world/issues/1328) shipped `batchVineInteraction` for proximity, but attach/detach and force application for swinging still run in `physics-updates.ts`.

**15% scope:** Extend `foliage_interact.cpp` with a second pass that outputs attach flags + impulse vectors; TS only applies results to game objects.

**Files:** `src/systems/physics/physics-updates.ts`, `emscripten/foliage_interact.cpp`

---

### 4. Region manager distance pre-pass → existing cull exports

**Why:** `region-manager.ts` + `game-loop.ts` still do TS distance checks before batchers update; C++ already exports `batchDistanceCull_c`, `batchFrustumCullSIMD_c`, `batchDistanceCullLOD_c`.

**15% scope:** Wire region visibility bitmask update through one existing batch export for a single entity class (e.g. clouds or distant trees).

**Files:** `src/systems/region-manager.ts`, `src/utils/wasm-batch-animation.ts`, `emscripten/batch.cpp`

---

### 5. Rebuild + verify Emscripten export manifest

**Status:** ✅ Done — two-tier CI (#1359 / #1383) + artifact cleanup (#1349).

**Why:** `emscripten/exports.txt` was drifting from `build.sh` because most agents lack `em++`.

**Shipped:**
- Tier 1: `scripts/check-emcc-manifest.mjs` + `.github/workflows/emscripten-ci.yml` (path-filtered, no emsdk)
- Tier 2: `.github/workflows/emscripten-verify.yml` (`CANDY_DEBUG=0 build:emcc` + `verify:emcc --strict` on tags / nightly / dispatch)
- Untracked `math.o` / `*.cpp.bak`; relocated `libomp.a` → `emscripten/vendor/libomp.a`

**Files:** `emscripten/build.sh`, `emscripten/exports.txt`, `scripts/check-emcc-manifest.mjs`, `.github/workflows/emscripten-*.yml`

---

## Backlog (not yet prioritized)

| Topic | Hint |
|-------|------|
| GPU foliage animator maturity | `gpu-foliage-animator.ts` vs batcher TS path |
| Discovery batch on AS vs C++ dedup | Both `assembly/discovery.ts` and `emscripten/discovery.cpp` exist |
| World gen micro-opts | `generation-entities.ts` — profile first |
| Stub removal | Delete `shared-buffer-example.js` after confirming no external imports |
| Move `PERFORMANCE_MIGRATION_STRATEGY.md` to repo root | Docs currently under `docs/archive/` but linked from `AGENTS.md` |

---

## Issue filing template

```markdown
**Goal:** <one hot function or loop>

**15% scope:** <exact function / species / biome>

**Files:** ...

**Native target:** assembly/… or emscripten/…

**Fallback:** <TS file that must keep working>

**Tests:** test:wasm / smoke / microbench

Refs: MIGRATION_TRACKER.md slice N, PERFORMANCE_MIGRATION_STRATEGY.md
```

---

## Labels & milestones

| Label | Use |
|-------|-----|
| `migration` | Any tier migration work |
| `performance` | Profiled hotspot |
| `wasm` | AssemblyScript or loader boundary |
| `c++` | Emscripten work |
| `tech-debt` | Hygiene (imports, stubs, docs) |
| `documentation` | Status / tracker updates |

**Milestone suggestion:** `Migration Q3 2026` — batcher matrix path + music reactivity slice + emcc export CI.

---

*Update this file when closing or opening migration issues.*
