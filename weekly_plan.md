# candy_world — Weekly Plan

## Today's focus
**2026-06-09 — USER IDEA: Music-Reactive Atmosphere Bridge (Audio → Bloom, Fog & Light Shafts) (#1169).**
Loading foundation restored (#1133 cluster closed 2026-06-03; circadian #1144 landed) — back to feature work.
Foliage music-reactivity is mature (sky wave, circadian, batcher TSL); the *air itself* still ignores the
tracker. Build a zero-allocation Atmosphere Reactivity block inside `MusicReactivitySystem.update()` (or a
small `src/systems/atmosphere-reactivity.ts`) mapping audio channels → post-processing/sky uniforms:
kick/bass → `uBloomStrength` (1.0 → ~2.5 crescendo), mix energy → `uCrescendoFogDensity`, melody hits →
`uShaftOpacity` + re-enable night shaft visibility (fix `shaftVisible` hardcoded `false` in
`game-loop.ts` ~lines 444–467), BeatSync downbeats → brief bloom spike. Add an optional `atmosphere`
section to `assets/music-bindings.json` (parallel to `weatherReactivity`) for per-biome tuning. Follow the
`_arpeggioShimmerAccum` zero-alloc accumulator pattern; mutate only `.value` on existing TSL uniforms,
never reassign nodes. WebGL fallback branch in `post-processing.ts` must receive the same values.
Verify: `npm run build` green, smoke reaches `__sceneReady` with no new console errors, visible bloom
modulation on playback that decays smoothly to rest on silence (no pops, flat GC heap).

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum. Opportunistic — activate when upgrading Three.js version, not a standalone sprint.

<!-- Completed ideas archived to Done below (2026-05-19 sky→foliage propagation, 2026-05-26 channel-to-biome completeness, 2026-05-30 sky-wave→plant-pose, TSL/VRAM audit, 2026-06-03 day/night circadian #1144). -->

### Live idea stream — GitHub issues filed 2026-06-09 (Siphon Part I vision)
Noah filed 9 issues today; these ARE this week's accumulated ideas. Priority pool for upcoming runs:
- [ ] **#1169 Music-Reactive Atmosphere Bridge** `[in progress — 2026-06-09]` — audio → bloom/fog/light-shaft uniforms. *Today's kimi-cli focus.* Highest-impact remaining reactivity step; core active focus area.
- [ ] **#1168 WebGL2 fallback renderer** — toggleable WebGLRenderer alongside WebGPU; unblocks agent/Playwright visual debugging. Infrastructure multiplier for everything below.
- [ ] **#1170 Gem Canopy** — hanging faceted crystal fruits on trees (`GemFruitBatcher`). New signature scenic biome.
- [ ] **#1171 Luminous Mycelium Realm** — glass mushrooms + ambient spore particle field near Melody Lake.
- [ ] **#1172 Cinematic Explore Mode** — promote dev-orbit prototype to player-facing hybrid FP/orbit camera.
- [ ] **#1173 TSL Volumetric God Rays + selective DoF** — performant revival of golden-hour shafts + macro bokeh. (Overlaps #1169 shaft work — sequence after.)
- [ ] **#1174 Distance LOD tiers for instanced foliage** — 3-tier hero/mid/far for tree/mushroom/flower/luminous batchers.
- [ ] **#1175 Candy Material Cookbook + grok.md onboarding** — docs (`docs/CANDY_MATERIAL_COOKBOOK.md`).
- [ ] **#1176 Awakened Flora Persistence** — persist discovery glow states across sessions (save-system + discovery-persistence).

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] **🟡 PR REVIEW BACKLOG — stacking up unreviewed (2026-06-09)** — open draft PRs awaiting triage: **#1178** (Palette: unify foliage materials + juicy rim + UI micro-interactions), **#1167** (Aria: a11y menu `role="switch"`), **#1161** (Palette: a11y momentary-ARIA fix — *appears superseded by merged #1162/#1166 keyboard-active work; likely close as dup*), **#1150** (Bolt: rainbow-blaster spatial-hash queries). Plus **#1138** (Copilot spawn-tracker telemetry — non-draft, the loading-cluster telemetry layer; **verify it's still needed now the cluster is closed**, then land or close). Sweep + merge/close to stop drift.
- [ ] **#1134 — Stable release / pinned-build process** — annotated tags + GitHub Releases for known-good states; feature flags to disable heavy subsystems so boot is always usable. Process decision; now that loading is fixed this is a good candidate for a quiet day.
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [ ] **[ui bug — #702]** Auto-scroll forces page to bottom on load, blocking top-row links — *likely resolved* by `preventScroll: true` on all `.focus()` calls (commit 88f2bf3, PR #1125). Verify on live site, then close.
- [ ] Three.js ColorSpace enum — opportunistic, activate when upgrading Three.js version (not a standalone sprint).

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] **2026-06-03** 🟢 LOADING REGRESSION CLUSTER RESOLVED — #1133 (parent) + sub-tasks #1135–#1142 all closed/completed. Full-world population reliable again; SpawnTracker telemetry (`window.__worldPopulationReport`) + feature-flag boot fallback landed. Confirmed by #1170 ("Loading reliability is restored (#1133 cluster closed)"). *Last week's Fix First landed cleanly.*
- [x] **2026-06-03** Day/night plant behaviour (#1144) — circadian baseline via `uCircadianPhase` + `uCircadianPoseOffset` global uniforms (NOT overloading `uTwilight`), `circadian-controller.ts` owns the lerp, HUD toggle fires `setDayTarget`, opt-in luminous + mushroom batchers compose pose/emissive in TSL. Pose machine left untouched. (Was the deferred Ideas item — now done.)
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
Date: 2026-06-09
Mode: USER IDEA — last week's Fix First (loading regression #1133 cluster) closed/completed 2026-06-03, and the deferred day/night circadian idea (#1144) also landed; both moved to Done. Foundation solid, no crack → feature work resumes. Noah filed 9 fresh vision issues today (#1168–#1176) = this week's live idea stream; picked the highest-impact one in the core music-reactivity focus area.
Focus: Music-Reactive Atmosphere Bridge (#1169) — zero-alloc Atmosphere Reactivity block mapping audio channels → `uBloomStrength` / `uCrescendoFogDensity` / `uShaftOpacity` (+ re-enable night light shafts), optional `atmosphere` block in `music-bindings.json`, WebGL fallback parity. Decoupled Copilot track drafted in the save/discovery domain (Awakened Flora persistence) to avoid file collision with kimi.
Outcome: <!-- fill in at end of day after kimi-cli loop -->
Context gap: No access to recent_chats / conversation_search in this environment — prior-session reconstruction is from git history, open/closed issues, open PRs, weekly_plan.md, and .swarm-state.md only. Could not directly read live-site behaviour; reactivity "maturity" claims are from issue text + Done log, not runtime verification.
