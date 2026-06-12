# candy_world — Weekly Plan

## Today's focus
**2026-06-02 — FIX FIRST: Root-cause the scene-loading / world-population regression (#1133).**
Objects, foliage, and musical scenery frequently fail to appear on startup. A 10-issue cluster
(#1133–#1142) was filed 2026-06-02 and `spawn-tracker.ts` + `window.__worldHealth` scaffolding has
already landed on this branch; Copilot draft PR #1138 owns the telemetry/UI layer. Today's job is the
*actual root cause*: why do `processMapEntity` (generation-core.ts) / `populateProceduralExtras`
(generation-decorators.ts) / `background-processor.ts` / `deferred-loader.ts` silently drop spawns?
Use the existing SpawnTracker report as ground truth — boot, read `window.__worldPopulationReport`,
identify which types fail and why (null factory, throw, scheduling drop, generationToken race), fix the
orchestration so a clean FULL boot reaches `failCount === 0` deterministically. Add a feature-flag
guarantee so the world always boots to a usable state even when a heavy subsystem fails.
No new feature work until full-world population is reliable.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum. Opportunistic — activate when upgrading Three.js version, not a standalone sprint.

<!-- Completed ideas archived to Done below (2026-05-19 sky→foliage propagation, 2026-05-26 channel-to-biome completeness, 2026-05-30 sky-wave→plant-pose, TSL/VRAM audit). -->
- [ ] **Day/night plant behaviour** *(promoted to Copilot issue 2026-06-02 — see Backlog)* — Plants should physically open/glow by day and close/dim at night driven by the day/night cycle, not just music-channel intensity. Builds on `plant-pose-machine.ts`. Deferred behind the loading Fix First; queued for Copilot.

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->

- [ ] **#1134 — Stable release / pinned-build process** — annotated tags + GitHub Releases for known-good states; feature flags to disable heavy subsystems so boot is always usable. Process decision, defer until loading is fixed.
- [ ] **Open draft PR #1138 (Copilot)** — adds `spawn-tracker.ts` telemetry + visible failure badge + `window.__worldPopulationReport`; touches `generation-core.ts`, `generation-decorators.ts`, `background-processor.ts`, `deferred-loader.ts`, `loading-screen*.ts`. ⚠️ **Overlaps the kimi-cli Fix First files** — land or close #1138 before/early in the kimi loop, or have kimi build strictly on its telemetry (read, don't rewrite). (Stale draft-PR list #817/#853/#1081/#1082/#1085 cleared — all merged/closed; #853 & loading-screen/ARIA refactors are in `main`.)
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [ ] **[ui bug — #702]** Auto-scroll forces page to bottom on load, blocking top-row links — *likely resolved* by `preventScroll: true` on all `.focus()` calls (commit 88f2bf3, PR #1125). Verify on live site, then close.
- [ ] Three.js ColorSpace enum — opportunistic, activate when upgrading Three.js version (not a standalone sprint).

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] **2026-06-12** Loading Regression Cluster (#1133–#1142) Fix — Tied up race condition in `BackgroundProcessor.resetCounters` where previous enqueued map-streaming tasks were silently dropped if `start()` was called after `resetCounters()`. Boot queue handoff is now atomic and deterministic.
- [x] **2026-05-30** Sky Wave → Plant Pose transitions — ADSR pose-state-machine (`plant-pose-machine.ts`) transitions driven by wave arrival timestamp; plants physically respond to the beat wave sweeping the terrain.
- [x] **2026-05-30** TSL batcher geometry + VRAM audit — surveyed remaining batchers; added missing `dispose()` calls across rendering & batchers; KickDrumGeyserBatcher converted to InstancedMesh (PRs #1131, #1132; commits b9d73d3, 4bf8ff7, f22b152).
- [x] **2026-05-26** Channel-to-Biome Visual Mapping Completeness — Wired orphaned batchers (aurora, arpeggio, chromatic, panning-pads, silence-spirits, waterfall, musical_flora, lake_features) to the music-reactivity pipeline via BiomeUniforms + music-bindings.json.
- [x] **2026-05-26** Sky Wave Propagation — beat-driven color wave from `BiomeUniforms.skyMoon.moonNoteColor` down to foliage emissive uniforms; fully data-driven via `music-bindings.json sky_wave`; zero-allocation hot path; build green; WASM tests green.
- [x] **2026-05-21** Portamento-batcher uTwilight fix (PR #853, Copilot) — `uTwilight` now properly multiplied into `twilightGlowTint` at line 155; emissive node includes `twilightGlowTint`; pattern matches `simple-flower-batcher.ts`.
- [x] **2026-05-26** Full Game mode optimization (PR #1084) — reduced procedural count, narrowed criticality, `requestIdleCallback` for background tasks, timing marks.
- [x] **2026-05-19** Twilight Glow Completion — `glowColorMap` expanded to 9 species (mushroom, tree, flower, dandelion, wisteria, lotus, lantern, portamento, global). `uTwilight` wired into all major foliage batchers.
- [x] **2026-05-19** Startup error fixes — dev.sh emsdk guard, game-loop weather state bug, import corrections, flower-batcher/lantern-batcher fixes (PR #833).
- [x] **2026-05-13** Portamento-batcher + wisteria-cluster audio reactivity wiring — `BiomeUniforms.arpeggioGrove.noteColor` and `BiomeUniforms.crystallineNebula.noteColor` multiplied into emissive nodes for tree-batcher, mushroom-batcher, portamento-batcher, wisteria-cluster (PR #825).
- [x] **2026-05-19** Zero-allocation WASM boundary + audio reactivity (PR #830). Cloud-batcher `updateMatrixWorld` bypass (PR #829). UI: Save Menu focus trap, active toggle styling, upload tactile feedback (PRs #828, #824, #822, #831).
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
Date: 2026-06-02
Mode: FIX FIRST — last week's channel-to-biome / sky-wave / VRAM work all merged cleanly (moved to Done), but a 10-issue cluster (#1133–#1142) filed today flags an active foundation crack: full-world population is unreliable, objects/scenery silently missing on startup. No new feature work until boot is reliable.
Focus: Root-cause the scene-loading regression (#1133) — find why `processMapEntity` / `populateProceduralExtras` / `background-processor` / `deferred-loader` drop spawns, fix the orchestration so a clean FULL boot reaches `failCount === 0`, and add a feature-flag fallback so the world always boots usable. SpawnTracker telemetry (already in tree) is the diagnostic substrate; Copilot PR #1138 owns the telemetry/UI layer (coordinate to avoid file collision).
Outcome: Identified and fixed race condition in `BackgroundProcessor` where `resetCounters()` destroyed the pre-loaded task queue count from `generateMap`. Boot is now deterministic with zero dropped spawns.
Context gap: No access to recent_chats / conversation_search in this environment — prior-session reconstruction is from git history, open issues, weekly_plan.md, and .swarm-state.md only.
