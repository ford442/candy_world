# candy_world — Weekly Plan

## Today's focus
**2026-07-21 — Migration safety net: #1351 Cross-tier parity harness (JS↔AS↔C++ golden vectors),
retroactively covering the two migration slices that just landed WITHOUT it — #1358 native batcher
matrix/color compose (`_batchComposeMatrices_c`, #1411) and #1364 arpeggio_grove channel accumulator (#1415).**

Rationale: Last week's Foundation cluster landed clean — `tsc --noEmit` ratchet baseline is now **3 errors**
(down from 587), `typecheck.yml` + `emscripten-ci.yml` are wired, `game-loop.ts` split into 8 tick-phase
modules (#1360/#1405), release tag `2026-07-14-stable-v2` cut. The self-sequenced roadmap (Foundation →
Migration → Content) has therefore advanced into **Migration** — and the frontier ran ahead of its safety
net. `MIGRATION_TRACKER.md` explicitly recommends **#1351 parity harness "before widening batcher ports,"**
yet #1358 and #1364 both shipped native hot paths (with silent JS/AS fallbacks) and **no golden-vector test
guards cross-tier drift**. Building #1351 now is the highest-leverage Migration move: it hardens what already
shipped and unblocks safely widening the matrix-compose port to mushroom/portamento/wisteria batchers.

**Not Fix First:** main is green (ratchet at 3, tree clean, branch in sync with origin/main). The missing
parity harness is a planned-but-unbuilt safety net, not a last-week regression. This is **User Idea mode** —
#1351 is an unfinished item from Noah's 2026-07-12 in-context batch, now more urgent than when filed.

**Scope of the swarm:** golden-vector fixtures + a `test:parity` runner that drives the same inputs through the
TS reference path and the native (AS + C++) path and asserts bit-tolerant equality for (a) instance
matrix/color compose (#1358) and (b) arpeggio_grove channel accumulation (#1364). Touch `tests/`, `assembly/`,
`emscripten/`, and the `wasm-batch-math.ts` / `wasm-music-reactivity.ts` wrappers only.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [x] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum. Opportunistic — activate when upgrading Three.js version, not a standalone sprint.

<!-- Completed ideas archived to Done below (2026-05-19 sky→foliage propagation, 2026-05-26 channel-to-biome completeness, 2026-05-30 sky-wave→plant-pose, TSL/VRAM audit). -->
- [x] **Day/night plant behaviour** *(promoted to Copilot issue 2026-06-02)* — Plants physically open/glow by day, close/dim at night driven by the day/night cycle, not just music-channel intensity. Builds on `plant-pose-machine.ts`. Landed for `SimpleFlowerBatcher` (commit 99fcbad, #1208) — verify coverage across remaining batchers, then close.

**User idea pool — GitHub issues filed 2026-06-28 (Noah's freshest in-context backlog — vertical-exploration arc):**
- [x] **#1265 Player ground level, eye height & object alignment** — unify ground sampling; consistent eye height across terrain+objects; batcher base-Y at spawn; `?debugPlayer` viz. `bug`+`enhancement`. Hard prerequisite for #1266. `[landed — 2026-06-30]` ← today's focus
- [x] **#1266 Walkable cloud blocks / platforms** — placeable solid candy-cloud surfaces the player can stand on; instanced, music-reactive glow, map.json persistence. **Blocked on #1265** — do not start cloud integration until ground system is merged & stable. Next in the arc. `[landed — 2026-07-05]`

**User idea pool — GitHub issues filed 2026-06-09 (Noah's in-context backlog, primary source this phase):**
- [x] **#1169 Music-Reactive Atmosphere Bridge** — audio → bloom/fog/light-shafts. `[in progress — 2026-06-16]` ← today's focus
- [x] **#1169 Music-Reactive Atmosphere Bridge** — audio → bloom/fog/light-shafts. LANDED 2026-06-23 (#1221).
- [x] **#1168 WebGL2 fallback renderer** — toggleable WebGLRenderer alongside WebGPU for debugging/CI/agent porting; unblocks visual inspection. Foundational for several others.
- [x] **#1170 Gem Canopy** — hanging faceted crystal fruits on trees (`GemFruitBatcher`), music-channel shimmer. Signature scenic biome. LANDED 2026-06-23.
- [x] **#1171 Luminous Mycelium Realm** — glass mushrooms + ambient spore particle field; companion biome to luminous plants. Verified #1237.
- [x] **#1172 Cinematic Explore Mode** — promote dev orbit prototype to player-facing hybrid FP+orbit camera.
- [x] **#1173 TSL Volumetric God Rays + selective DoF** — performant revival of golden-hour shafts. LANDED 2026-06-23 (#1241; DoF math optimized #1244).
- [x] **#1174 Distance LOD Tiers for instanced batchers** — three-tier (hero/mid/far) for trees/mushrooms/flowers/luminous. Performance lever.
- [ ] **#1175 Candy Material Cookbook + grok.md onboarding upgrade** — docs-only; canonical material/music-binding quick-start. Fully decoupled from code work. ← Copilot prep target today (decoupled from #1170 foliage/map work).
- [x] **#1176 / #1182 Awakened Flora Persistence** — world that "remembers" you; #1182 narrow v1 slice. LANDED 2026-06-23 (#1232).
- [x] **#1170 Gem Canopy** — hanging faceted crystal fruits on trees (`GemFruitBatcher`), music-channel shimmer. Signature scenic biome. `[landed — 2026-06-24]`.
- [x] **#1171 Luminous Mycelium Realm** — glass mushrooms + ambient spore particle field; companion biome to luminous plants.
- [x] **#1172 Cinematic Explore Mode** — promote dev orbit prototype to player-facing hybrid FP+orbit camera.
- [x] **#1173 TSL Volumetric God Rays + selective DoF** — performant revival of golden-hour shafts; overlaps #1169 on shaft work (sequence after).
- [x] **#1173 TSL Volumetric God Rays + selective DoF** — performant revival of golden-hour shafts. LANDED 2026-06-23 (#1241; DoF math optimized #1244).
- [x] **#1174 Distance LOD Tiers for instanced batchers** — three-tier (hero/mid/far) for trees/mushrooms/flowers/luminous. Performance lever.
- [ ] **#1175 Candy Material Cookbook + grok.md onboarding upgrade** — docs-only; canonical material/music-binding quick-start. Fully decoupled from code work.
- [x] **#1176 / #1182 Awakened Flora Persistence** — world that "remembers" you; #1182 is the narrow v1 slice (scope-guarded away from atmosphere/render files). LANDED 2026-06-23 (#1232).

**User idea pool — GitHub issues filed 2026-07-12 (Noah's FRESHEST in-context batch, 19 issues — primary source this phase). The issues self-sequence: land Foundation before Migration before Content.**

*Foundation / tech-debt (prerequisites — land first):* — **CLUSTER LANDED 2026-07-14 (#1388/#1397/#1393/#1405)**
- [x] **#1347 Enforce TS typecheck in CI + error-count ratchet** — LANDED (#1388). `typecheck` script + `scripts/tsc-ratchet.mjs` + `typecheck.yml`; baseline now **3 errors** (from 587).
- [x] **#1350 Fix music-reactivity.ts barrel** — LANDED (#1388/#1397). Barrel re-declaration conflicts + missing `-core` exports resolved.
- [x] **#1357 Remove stale `createSubwooferLotus` import** — LANDED (#1388).
- [ ] **#1348 ESLint + build-stripped logger** — no lint tooling; ~658 raw `console.*`, ~623 `any`. Warn-heavy config + `src/utils/log.ts`. Next foundation item after chunk split.
- [x] **#1349 Untrack build artifacts** (`math.o`, `*.cpp.bak`) + gitignore; `libomp.a` relocated to `emscripten/vendor/` (still tracked).
- [x] **#1360 Split `game-loop.ts`** (1,028 lines) into tick-phase modules. LANDED 8-module split (#1405); follow-up extracted `game-loop-input.ts` + `game-loop-foliage.ts`, zero-alloc day/night palette, sun/moon null-safety. *Close on merge of follow-up PR.*
- [x] **#1361 Break up 796 KB `app` chunk** — lazy-load gameplay/save-UI/world-content; break foliage↔music-reactivity circular imports. See `docs/APP_CHUNK_SPLIT.md`.

*Migration slices (15%-rule, after foundation):*
- [ ] **#1351 Cross-tier parity harness** (JS↔AS↔C++ golden vectors) — recommended before widening batcher ports. `[in progress — 2026-07-21]` ← today's focus. **NOW OVERDUE:** #1358 + #1364 shipped native paths without it.
- [x] **#1358 Batcher instance matrix/color → C++ batch** (arpeggio + tree) — LANDED (#1411, `_batchComposeMatrices_c`) per MIGRATION_TRACKER slice 1 = ✅. Shipped ahead of the #1351 harness — now guarded retroactively. *GitHub issue still OPEN — close.*
- [x] **#1359 / #1383 Emscripten export verification CI** — Tier-1 lexical `verify:emcc:manifest` (`emscripten-ci.yml`) + Tier-2 full emsdk build (`emscripten-verify.yml` on tags/nightly/dispatch).
- [x] **#1364 Per-biome music channel accumulator → WASM** (arpeggio_grove slice) — LANDED (#1415, AS batch). *GitHub issue still OPEN — close.*

*Content / world-building (capstones, after foundation):*
- [x] **#1362 Circadian day/night across all instanced batchers** — extend `SimpleFlowerBatcher` pose path.
- [ ] **#1363 Vertical Sky Islands biome** — layered exploration arc after #1265/#1266.
- [ ] **#1365 In-world `?debugPlace` map placement editor** — content-authoring gizmo.
- [ ] **#1352 Living candy fauna** (WASM boids + ECS). **#1353 Real-time co-presence** (Supabase Realtime). **#1354 Tier-4 WebGPU compute consolidation. #1355 Generative biome audio. #1356 Cinematic Photo Mode.**

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [x] **#1134 — Stable release / pinned-build process** — annotated tags + GitHub Releases for known-good states; feature flags to disable heavy subsystems. **Partially landed**: `scripts/make-release.mjs` + `npm run release:tag` / `npm run release` now exist. Remaining: cut the first known-good tag now that loading is stable; confirm feature-flag fallbacks. Now actionable. `[landed — 2026-07-14]`
- [x] **TS-error baseline (feeds #1347)** — RESOLVED 2026-07-14. `scripts/tsc-ratchet.mjs` + `scripts/tsc-baseline.json` now committed; baseline crushed from 587 → **3 errors**, `typecheck.yml` enforces the ratchet in CI. Remaining 3 are the committed floor; keep ratcheting opportunistically.
- [ ] **Issue hygiene: close landed-but-open issues** — #1358, #1360, #1364 all LANDED on main but their GitHub issues are still OPEN. Verify + close with `state_reason: completed`. #1359 landed (emscripten CI) — decide whether #1383 (two-tier refinement) supersedes and close/relabel accordingly.
- [ ] **Circadian PR reconciliation (#1362)** — 3 open Jules draft PRs (#1413 mushroom/luminous global `uCircadianPhase`, #1414 `uCircadianPoseOffset` droop across all batchers, #1416 portamento standardized deformation) all layer on merged #1394/#1400. Review together; merging >1 risks double-applied night droop. Pick the canonical droop path, close/rebase the rest, then close #1362.
- [ ] **Workflows present** — CI now has `budget-check.yml`, `emscripten-ci.yml`, `typecheck.yml`, `visual-regression.yml`. Still no unit/lint CI beyond the ratchet; #1348 (ESLint) is the next foundation gap.
- [x] **#1134 — Stable release / pinned-build process** — annotated tags + GitHub Releases for known-good states; feature flags to disable heavy subsystems. **Partially landed**: `scripts/make-release.mjs` + `npm run release:tag` / `npm run release` now exist. Remaining: cut the first known-good tag now that loading is stable; confirm feature-flag fallbacks. Now actionable.
- [ ] **#1134 — Stable release / pinned-build process** — annotated tags + GitHub Releases for known-good states; feature flags to disable heavy subsystems. **Partially landed**: `scripts/make-release.mjs` + `npm run release:tag` / `npm run release` now exist. Remaining: cut the first known-good tag now that loading is stable; confirm feature-flag fallbacks.
- [ ] **#1136 — Consolidate duplicated `LoadingScreen` class** (`loading-screen.ts` vs `loading-screen-ui.ts`) — leftover from loading cluster; .swarm-state noted a duplicate-declaration build blocker was patched, not consolidated. Small decoupled refactor — good future Copilot candidate.
- [ ] **#1249 — Candy Material Cookbook v2 (docs de-drift + enrich)** — docs-only, fully decoupled from runtime/foliage work; fixes verified broken `uTwilight` import path, reconciles 3 contradictory position-node orderings, documents all 7 `CandyPresets`, adds LUT/r32float/circadian gotchas, + one preset-coverage guard script. Open since 2026-06-24.
- [x] **#1303 — Calibrate per-entity base offsets** — landed 2026-07-06. `ENTITY_BASE_OFFSETS` populated in `src/world/placement-utils.ts`; `plantOnSurface()` centralizes ground placement; `src/debug/ground-debug.ts` draws green base-contact rings when `?debugHeights=1`.
- [x] **#1311 — Spatial-coherence visual regression viewpoints** — landed 2026-07-06. Viewpoints added to `src/screenshot-capture.ts`; workflow updated to WebGL path; local baselines captured for all four viewpoints at medium/high desktop.
- [x] **Issue-hygiene: verify landed issues are closed** — #1170 (Gem Canopy), #1173 (god rays), #1182 + #1176 (awakened flora v1) all confirmed CLOSED on GitHub as of 2026-07-01. Nothing further to do.
- [x] **Open draft PRs hygiene** — #1170/#1173/#1182/#1176 confirmed already closed on GitHub. #1255 was the only remaining open PR; reviewed and closed as superseded because its diff largely reverted landed Gem Canopy work rather than delivering the titled HUD ability-button polish.

### Notes / not standalone tasks
- Accessibility: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions — future ARIA work should use the dynamic path, not add static tags.
- UI bug #702: auto-scroll likely resolved by `preventScroll: true` on `.focus()` calls; verify on live site, then close.
- Three.js ColorSpace enum regression: fixed 2026-07-06 by using string literals (`'display-p3'`, `'srgb'`) in `src/core/init.ts`; revert to enum when upgrading Three.js.

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] **2026-07-21** CIRCADIAN DAY/NIGHT FOR BATCHERS (#1362) — Wired mushroom-batcher and luminous-plant-batcher via global uCircadianPhase (emissive dim by day, bright by night). Ensured circadianController.setDayTarget() is properly called in game-loop-visuals.ts and delta is passed instead of gameTime.
- [x] **2026-07-14** 🧱 FOUNDATION CLUSTER LANDED — TS typecheck gate + ratchet (#1347, #1388): `scripts/tsc-ratchet.mjs` + `scripts/tsc-baseline.json` + `typecheck.yml`; baseline driven 587 → **3 errors**. music-reactivity.ts barrel fixed (#1350) + stale `createSubwooferLotus` import removed (#1357) + game-loop sun/moon null-safety (#1397). Copilot prep shipped: Emscripten build + export verification CI `emscripten-ci.yml` (#1359/#1393), folding in build-artifact untracking (#1349). Whole-stack: release tag `2026-07-14-stable-v2` cut (#1134 tooling, #1387). Downstream wave the same week: `game-loop.ts` split into 8 tick-phase modules (#1360/#1405), circadian day/night base (#1362/#1394), native batcher matrix compose `_batchComposeMatrices_c` (#1358/#1411), arpeggio_grove accumulator → AS (#1364/#1415).
- [x] **2026-07-07** ⛰️ GROUNDING CLUSTER — SLOPE ALIGNMENT + FOOTPRINT SAMPLING (#1302 / #1310) — per `.swarm-state.md` iteration 2: added `registerGroundNormalData` / `sampleGroundNormal` (baked-normal + finite-diff fallback) / `sampleGroundFootprint` to `ground-system.ts`; `SLOPE_ALIGN_TYPES`, `getGroundAlignedQuaternion`, footprint/slope-aware `plantOnSurface()` in `placement-utils.ts`; tree/arpeggio/luminous/portamento batchers compose the aligned quaternion; `?debugHeights=1` overlay now draws footprint ring + normal arrow. Slope capped at 45°; footprint uses lowest contact point. Build/WASM/smoke (WebGPU + WebGL) all green.
- [x] **2026-07-06** 📸 SPATIAL-COHERENCE VISUAL REGRESSION VIEWPOINTS (#1311) — Added `slope_foot`, `lake_edge`, `horizon_lod`, and `gem_corridor_scale` viewpoints to `tools/visual-regression`; updated workflow to WebGL path; fixed ESM `require('crypto')` in `baseline-manager.ts`; captured 8 local baselines. Build/test green: `npm run build:ci`, `npm run test:wasm`, visual-regression `--update` run succeeds.
- [x] **2026-07-06** 🌱 PER-ENTITY BASE OFFSETS (#1303) — Populated `ENTITY_BASE_OFFSETS` in `src/world/placement-utils.ts` with all major ground-placed entity types; refactored `src/world/generation-decorators.ts` standalone placement loops to use `plantOnSurface()`; extended `src/debug/ground-debug.ts` with `registerPlantedInstance()` and green base-contact rings for `?debugHeights=1`. Build/test green: `npm run build:ci`, `npm run test:wasm`, `npm run test`, `RENDERER=webgl npm run test`.
- [x] **2026-06-24** 📚 CANDY MATERIAL COOKBOOK + GROK.MD ONBOARDING (#1175) — Added Foliage-Specific Patterns, Common Gotchas, and Performance Notes to the material cookbook; updated grok.md references.
- [x] **2026-06-24** **#1170 Gem Canopy scenic biome landed** — procedural corridor of 24+ bubble-willow trees with hanging faceted crystal gem fruits (ruby/sapphire/amethyst). `GemFruitBatcher` creates one `InstancedMesh` per jewel type (3 draw calls), consumes `BiomeUniforms.gemCanopy` for shimmer/hueShift/noteColor reactivity, and receives the `sky_wave` moon-melody cascade. Capacity tuned to `getCIAdjustedCount(512, 0.1, 80)` to eliminate CI overflow warnings. Build/test green: `npm run build:ci`, `npm run test:wasm`, `npm run test`, `FULL_BOOT=fast npm run test`, and `RENDERER=webgl npm run test` all pass. Docs updated: `docs/GEM_CANOPY_SHIP.md` + `docs/MUSIC_MAP_BINDING.md`.
- [x] **2026-06-23** 🎵 MUSIC-REACTIVE ATMOSPHERE BRIDGE (#1169) LANDED — `src/systems/atmosphere-reactivity.ts` (new, zero-alloc) maps kick/bass→`uBloomStrength` (1.0→2.5), mix energy→`uCrescendoFogDensity` (cap 0.85), melody→`uShaftOpacity` + re-enabled frustum-gated golden-hour & night moonbeam shafts in `game-loop.ts`, BeatSync downbeats→bloom/shaft shimmer; `atmosphere` block added to music-bindings.json; WebGL opacity parity via `lightShaftGroup.userData.shaftMaterial`. Wired in #1221; build:ci + test:wasm + smoke `__sceneReady` green (per `.swarm-state.md`). Last week's focus — DONE.
- [x] **2026-06-23** ✨ AWAKENED FLORA PERSISTENCE v1 (#1182) LANDED (#1232) — feature-flagged (`FEATURE_FLAGS.awakenedPersistence`, default off) persistence of awakened glow across reloads via stable position-hash `persistentId`, separate `awakened-persistence.ts` store, bulk GPU upload + orphan reconciliation + schema version, `luminous-plant-batcher.ts` `aAwakened` attribute. The decoupled Copilot prep target from last run.
- [x] **2026-06-23** 🌅 TSL VOLUMETRIC GOD RAYS + SELECTIVE DoF (#1173) LANDED (#1241) — performant revival of golden-hour/moonlit shafts + proximity DoF, with DoF math subsequently optimized (Bolt #1244). Was sequenced after #1169 shaft work; both shipped same week.
- [x] **2026-06-23** Supporting landings — #1171 Luminous Mycelium verified + `getCIAdjustedCount` (#1237), CI WebGPU smoke stabilization (#1242), HUD ability hold/keyboard support (#1226/#1243), radiogroup/switch ARIA semantics (#1233/#1235/#1217), low-energy announcer (#1230), save-menu paint-yield + API fix (#1240), Kick-Drum-Geyser rim light/wind sway (#1218), TreeBatcher player interaction (#1223), and a run of Bolt GC/VRAM/typed-array/LOD optimizations (#1224/#1227/#1231/#1234/#1239).
- [x] **2026-06-16** 🔴 LOADING REGRESSION CLUSTER (#1133–#1142) RESOLVED — scene/world population now reliable. Root cause fixed via single-boot stable `worldGenerationToken` orchestration across async phases (340dfe0), `reliableBoot` guards, silent-entity-drop fix on map-load token invalidation (#1211 / 5bd3266), and background-processor empty-queue/failure-counter-reset fix (4db0404). SpawnTracker + `window.__worldHealth` telemetry + spawn-count smoke assertions landed (Copilot PR #1138 merged; `test:spawn-tracker` / `test:world-health` now in `test:integration`). Cluster issues closed; #1170 confirms "loading reliability restored." Follow-ups parked in Backlog: #1134 release tagging (tooling now exists), #1136 LoadingScreen consolidation.
- [x] **2026-06-16** 🔴 LOADING REGRESSION CLUSTER (#1133–#1142) RESOLVED — scene/world population now reliable. Root cause fixed via single-boot stable `worldGenerationToken` orchestration across async phases (340dfe0), `reliableBoot` guards, silent-entity-drop fix on map-load token invalidation (#1211 / 5bd3266), and background-processor empty-queue/failure-counter-reset fix (4db0404). SpawnTracker + `window.__worldHealth` telemetry + spawn-count smoke assertions landed (Copilot PR #1138 merged; `test:spawn-tracker` / `test:world-health` now in `test:integration`). Cluster issues closed. Follow-ups parked in Backlog: #1134 release tagging (tooling now exists), #1136 LoadingScreen consolidation.
- [x] **2026-06-14** Day/night plant behaviour for `SimpleFlowerBatcher` via `PlantPoseMachine` (#1208) — circadian open/glow by day, close/dim at night. Plus music-reactivity per-frame allocation + proxy-overhead elimination (#1207), batched-mushroom wind sway + caching (#1210), subwoofer-lotus TSL rim light + wind sway (#1204/#1206), Harpoon Math.sqrt removal (#1212), ARIA aria-busy/momentary-state fixes (#1161/#1206/#1213).
- [x] **2026-05-30** Sky Wave → Plant Pose transitions — ADSR pose-state-machine (`plant-pose-machine.ts`) transitions driven by wave arrival timestamp; plants physically respond to the beat wave sweeping the terrain.
- [x] **2026-05-30** TSL batcher geometry + VRAM audit — surveyed remaining batchers; added missing `dispose()` calls across rendering & batchers; KickDrumGeyserBatcher converted to InstancedMesh (PRs #1131, #1132; commits b9d73d3, 4bf8ff7, f22b152).
- [x] **2026-05-26** Channel-to-Biome Visual Mapping Completeness — Wired orphaned batchers (aurora, arpeggio, chromatic, panning-pads, silence-spirits, waterfall, musical_flora, lake_features) to the music-reactivity pipeline via BiomeUniforms + music-bindings.json.
- [x] **2026-05-26** Sky Wave Propagation — beat-driven color wave from `BiomeUniforms.skyMoon.moonNoteColor` down to foliage emissive uniforms; fully data-driven via `music-bindings.json sky_wave`; zero-allocation hot path; build green; WASM tests green.
- [x] **2026-05-21** Portamento-batcher uTwilight fix (PR #853, Copilot) — `uTwilight` now properly multiplied into `twilightGlowTint` at line 155; emissive node includes `twilightGlowTint`; pattern matches `simple-flower-batcher.ts`.
- [x] **2026-05-26** Full Game mode optimization (PR #1084) — reduced procedural count, narrowed criticality, `requestIdleCallback` for background tasks, timing marks.
- [x] **2026-05-19** Twilight Glow Completion — `glowColorMap` expanded to 9 species (mushroom, tree, flower, dandelion, wisteria, lotus, lantern, portamento, global). `uTwilight` wired into all major foliage batchers.
- [x] **2026-05-19** Startup error fixes — dev.sh emsdk guard, game-loop weather state bug, import corrections, flower-batcher/lantern-batcher fixes (PR #833).
- [x] **2026-05-13** Portamento-batcher + wisteria-cluster audio reactivity wiring — `BiomeUniforms.arpeggioGrove.noteColor` and `BiomeUniforms.crystallineNebula.noteColor` multiplied into emissive nodes for tree-batcher, mushroom-batcher, portamento-batcher, wisteria-cluster (PR #825).
- [x] **2026-05-30** Zero-allocation WASM boundary + audio reactivity (PR #830). Cloud-batcher `updateMatrixWorld` bypass (PR #829). UI: Save Menu focus trap, active toggle styling, upload tactile feedback (PRs #828, #824, #822, #831).
- [x] **2026-05-13** Loading Architecture Fixes — Batched WASM heightmap calls, deferred world content via initWorldCritical/initWorldContent split, recalibrated progress bar, and fixed enterWorld race condition.
- [x] **2026-05-12** Planning Debt — archive completed plan files — 34 root `.md` docs archived to `docs/archive/` (commits 4e375df, c1d93cb). Root down to 8 live docs.
- [x] **2026-05-12** Moon Dance sky reactivity — note-colour-driven hue reactivity for sky and moon glow (PR #764).
- [x] **2026-05-12** TSL squish deformation for mushrooms (Palette PR).
- [x] **2026-05-12** previewMushroom memory leak fix (PR #766).
- [x] **2026-05-12** WASM -O3 export preservation fix — `EXPORTED_FUNCTIONS` guard during minification (PR #757).
- [x] **2026-05-12** ARIA/UX: energy bar aria attributes, empty Jukebox state, async UI transition pattern, accessibility menu focus trap, pointer-lock menu close, active-state visual feedback for Upload Music + Jukebox remove buttons (PRs #758–#767).
- [x] **2026-05-13** Luminous Plant Scenic System — Added TSL luminous plant batcher with fake SSS and note-color reactivity, generated around Melody Lake (Jules).
- [x] **2026-05-05** Testing Debt — `npm test` + `npm run test:wasm` both pass cleanly. TSL `mul` crash and Jukebox headless timeout resolved (Jules, PR #705).
- [x] **2026-05-05** Music-Channel-to-Biome Shader Binding (Arpeggio Grove + Crystalline Nebula) — `BiomeUniforms` TSL nodes live, `music-bindings.json` wired to shimmer/hueShift/amplitudeScale per-channel (Copilot, PRs #704 + follow-up fix).
- [x] **2026-05-05** Arrow key navigation for Accessibility Menu Tabs (PR #720).
- [x] **2026-05-05** Plant Pose ADSR State Machine — day/night channel-intensity driven (PR #712).
- [x] **2026-05-05** Rain-driven foliage spreading for batched mushrooms and flowers (PR #721).
- [x] **2026-05-05** Bolt: GC hot-path eliminations — zero-allocation filtering, scratchMatrix hoist, foliage O(N) pre-filter, VRAM leak in CullingDebugVisualizer, Math.sqrt → squared-distance in culling + asset streaming (PRs #711, #722, #715, #708, #727, #728).
- [x] **2026-05-05** Particle WGSL fix — `uv` → `pointUV`, buffer alignment (PR #726).
- [x] **2026-05-05** D-pad direction control buttons (touch/click) (PR #710).
- [x] **2026-05-05** ARIA: focus restoration, Jukebox keyboard nav, Save Menu focus trap, ability-slot keyboard support, aria-busy states (PRs #719, #725, #717, #716, #709, #729).

## Last run
<!-- Routine writes summary here each run. Overwrites previous. -->
Date: 2026-07-21
Mode: USER IDEA — no Fix First trigger. Last week's Foundation cluster landed clean and GREEN: ratchet baseline crushed 587 → **3 errors**, `typecheck.yml` + `emscripten-ci.yml` wired, game-loop split (#1405), `2026-07-14-stable-v2` tag cut. Main is in sync with the working branch, tree clean. The self-sequenced roadmap has advanced into Migration — and the frontier (#1358 native matrix compose #1411, #1364 arpeggio accumulator #1415) shipped **without** its recommended #1351 parity harness. Picked #1351 as the freshest still-unfinished in-context idea, now more urgent than when filed.
Focus: **#1351 Cross-tier parity harness (JS↔AS↔C++ golden vectors)** — retroactively guard the two just-landed native paths (#1358 matrix/color compose, #1364 channel accumulation) with `test:parity` golden-vector equality, then unblock widening the port. kimi-cli main event = build fixtures + runner + wire both slices. Copilot prep (decoupled, zero file overlap): **#1365 in-world `?debugPlace` map placement editor** (content-authoring gizmo, unblocks #1363 Sky Islands). Claude Code whole-stack: full `npm run build` → `verify:emcc` → `deploy.py` dry-run → cut a fresh `2026-07-21-stable` release tag over the post-foundation wave.
Outcome: <!-- fill in at end of day after kimi-cli loop -->
Context gap: No `recent_chats` / `conversation_search` in this headless run (confirmed — ToolSearch surfaces neither). Prior-session reconstruction from git history, 9 open GitHub issues, 3 open Jules draft PRs, `weekly_plan.md`, `.swarm-state.md` (stale — still shows the 2026-07-06 grounding cluster, not last week's foundation work), `MIGRATION_TRACKER.md`, and `scripts/tsc-baseline.json`. Could not run `tsc`/build locally (no `node_modules`) or verify live-site behaviour. Flagged: #1358/#1360/#1364 landed but issues still OPEN; #1362 fragmented across 3 competing draft PRs.

Date: 2026-07-14
Mode: USER IDEA — no Fix First trigger (last week's grounding cluster landed green per `.swarm-state.md`; the ~587 tsc errors are pre-existing debt, not a last-week regression). Noah filed a 19-issue in-context batch on 2026-07-12 that reorganizes the roadmap and self-sequences Foundation → Migration → Content. Picked the freshest, highest-leverage foundation item that unblocks everything else.
Focus: **#1347 TS typecheck gate + error-count ratchet**, bundling the two concrete bug clusters it names — **#1350** (half-migrated `music-reactivity.ts` barrel, ~31 errors) and **#1357** (stale `createSubwooferLotus` import) — plus `game-loop.ts` sun/moon null-safety. kimi-cli main event = build the gate/ratchet infra + burn down the baseline. Copilot prep (decoupled from all TS-typecheck/music-reactivity/game-loop files): **#1359 Emscripten build + export-manifest verification CI**, folding in **#1349** artifact untracking. Claude Code whole-stack: full `npm run build` → `deploy.py` dry-run → cut the first known-good release tag (#1134 tooling exists).
Outcome: <!-- fill in at end of day after kimi-cli loop -->
Context gap: No access to `recent_chats` / `conversation_search` in this environment (confirmed — ToolSearch surfaces no such tools). Prior-session reconstruction is from git history, the 19 open GitHub issues, `weekly_plan.md`, and `.swarm-state.md` only. Could not confirm live-site behaviour or the exact current `tsc --noEmit` count (using #1347's stated ~587 baseline). Branch `claude/amazing-ptolemy-klmx5n` is 16 commits ahead of a stale `origin/main`; no open PRs.

Date: 2026-07-06
Mode: USER IDEA continuation — all four approved phases complete.
Focus:
- Phase 1: Verified #1170/#1173/#1182/#1176 closed; reviewed/closed stale draft PR #1255 as superseded.
- Phase 2: Split remaining >700-line files (`generation-core.ts`, `generation-decorators.ts`, `loading-screen-ui.ts`) via coder subagent.
- Phase 3: Hardened walkable cloud platforms — added `registerCloudPlatform`/`unregisterCloudPlatform` debug visualization to `src/debug/ground-debug.ts` (enabled via `?debugClouds=1` or `?debugHeights=1`), wired registration from `src/foliage/clouds.ts` and explicit registration in `src/world/cloud-placer.ts`, fixed dev-placed cloud collision extents to match ground-system bounds, and set `cloudScale` before registration.
- Phase 4: Made visual-regression CI-ready — added root `.gitattributes` to track baselines under Git LFS, activated the `update-baselines` job on `main` to capture and commit baselines, added `--seed` deterministic random-seed support via `src/utils/seeded-random.ts` and the visual-regression CLI, cleaned up TypeScript errors so `cd tools/visual-regression && pnpm run typecheck` passes, added `test:visual` / `test:visual:typecheck` root scripts, and fixed `validate.ts` root-path bug.
Outcome: `pnpm run build:ci`, `pnpm run test:wasm`, `RENDERER=webgl pnpm run test`, and `cd tools/visual-regression && pnpm run typecheck && pnpm run validate` all pass.
Context gap: Root `npx tsc --noEmit` still has many pre-existing TypeScript errors unrelated to this work. No live-site verification performed.

Date: 2026-06-30
Mode: USER IDEA — no Fix First trigger (last week's #1170 Gem Canopy LANDED clean, all tests green, 24 trees spawning). Picked the freshest in-context user idea: GitHub issue #1265 (filed 2026-06-28 alongside #1266). #1265 is `bug`-tagged (eye-height drift, player sink/hover near clusters) and is the hard prerequisite #1266 (walkable cloud platforms) blocks on — foundation before feature.
Focus: #1265 Player ground level / eye height / object alignment. kimi-cli: audit scattered ground-height computation (game-loop / player / `physics.core.ts getUnifiedGroundHeightTyped` / `wasm-loader.ts`), centralize a unified ground query (terrain→object→platform priority), drive player foot + eyeHeight off it with smooth lerp, add `?debugPlayer`/`?debugHeights` viz, ensure batchers sample base-Y at spawn. Kinematic raycast + capsule only — NO physics engine / jumping / music / material changes. Copilot prep (decoupled from player/ground files): NEW issue — audio-reactive ambient sparkle/mote field for the Gem Canopy corridor (new particle module + music binding, builds on last week's landing). Claude Code: full-stack build → deploy dry-run → cut first known-good release tag (#1134 tooling exists).
Outcome: Phase 1 (GC Spike elimination in workers and spawn tracker) completed. Proceeding to #1265 player alignment.
Context gap: No access to recent_chats / conversation_search in this environment — prior-session reconstruction from git history, open/closed issues, weekly_plan.md only. Could not confirm live-site behaviour (#702 auto-scroll, deploy state, actual severity of #1265 eye-height drift in-world). #1170/#1173/#1182/#1176 GitHub issues still show OPEN despite landing — close after verification.

Date: 2026-06-23
Mode: USER IDEA — no Fix First trigger (last week's #1169 atmosphere bridge, #1182 awakened flora, #1173 god rays all LANDED; `isNight` ReferenceError flagged by draft PR #1245 is NOT live on main — defined at music-reactivity.ts:506). Remaining unfinished items in the 2026-06-09 idea batch: #1170 Gem Canopy and #1175 docs cookbook. Picked #1170 — last unfinished signature scenic biome, and its atmospheric framing (#1169 + #1173) just landed.
Focus: #1170 Gem Canopy. Batcher/tree/registry already built (`gem-fruit-batcher.ts`, `gem-canopy-tree.ts`, `gem_canopy_tree` registered). kimi-cli finishes it: place a 20+ tree canopy corridor (procedural decorator or map.json region — currently 0 gem refs in map.json), complete/verify the `gem_canopy` music-binding block (shimmer + noteColor), verify beat-pulse/single-draw-call/dispose/map-export. Copilot prep (decoupled, docs-only): #1175 Candy Material Cookbook + grok.md onboarding. Claude Code: full-stack build→deploy-dry-run→first known-good release tag (#1134 tooling now exists).
Outcome: <!-- fill in at end of day after kimi-cli loop -->
Context gap: No access to recent_chats / conversation_search in this environment — prior-session reconstruction from git history, open/closed issues, weekly_plan.md, and `.swarm-state.md` only. Could not confirm live-site behaviour (#702 auto-scroll, deploy state, live bloom/shaft visual regression). #1169/#1173/#1182/#1171 GitHub issues still show OPEN despite landing — close them after verification.
Date: 2026-06-24
Mode: USER IDEA — #1170 Gem Canopy finish & ship.
Focus: Finalize the Gem Canopy biome: verify existing `GemFruitBatcher`/`createGemCanopyTree`/decorator wiring, fix pre-existing duplicate-export build blockers, tune `MAX_GEMS_PER_TYPE` to eliminate CI overflow warnings, run build + WASM + smoke (CORE and FAST_FULL) + WebGL fallback, and update `.swarm-state.md`, `weekly_plan.md`, and `docs/MUSIC_MAP_BINDING.md`.
Outcome: #1170 LANDED. `npm run build:ci`, `npm run test:wasm`, `npm run test`, `FULL_BOOT=fast npm run test`, and `RENDERER=webgl npm run test` all pass. FAST_FULL reports 24 gem_canopy_trees spawned, 2322/2322 objects, no GemFruitBatcher capacity warnings. Docs updated with Gem Canopy binding reference.
# Refactoring Plan

1. **Understand the Goal**: As Palette 🎨, I need to pick ONE high-impact visual or UX tweak and implement it. Checking the recent accomplishments, they did:
   - Added TSL Rim Light and Wind Sway to Subwoofer Lotus.
   - Fixed accessibility and keyboard issues in Jukebox empty state.
   - Refactored menus and added `trapFocusInside` to Save Menu and Accessibility Menu.
   - Fixed auto-scroll issues by using `{ preventScroll: true }`.
   - Used `<style>` to inject tactile "Game Feel" active pressed states.

2. **Select Target**:
   Added visual polish (TSL juice) to `src/foliage/gem-fruit-batcher.ts`. Included `createJuicyRimLight` and `applyPlayerInteraction` combined with `calculateWindSway` to make the gem fruits interactive and visually cohesive with the twilight candy theme.

3. **Pre-commit**: Executed all pre commit instructions properly.

4. **Submit**: Submitting with "🎨 Palette: Add TSL Rim Light and Wind Sway to Gem Fruit Batcher".

Status: Implemented ✅
* Implementation Details: Applied "Juice" to the `gem-fruit-batcher.ts` component by standardizing the deformation with `calculateWindSway` and `applyPlayerInteraction` TSL logic into the position graph so that it responds dynamically to weather and player forces. We also ensured the existing TSL Rim Light and glowing audio pulses continue to function optimally.
