# candy_world — Weekly Plan

## Today's focus
**2026-06-16 — USER IDEA: Music-Reactive Atmosphere Bridge — Audio → Bloom, Fog & Light Shafts (#1169).**
The loading Fix First from 2026-06-02 landed (cluster #1133–#1142 closed; orchestration stabilized via
single-boot `worldGenerationToken`, `reliableBoot` guards, silent-entity-drop fix #1211, background-processor
empty-queue fix). Foundation is stable — back to feature work. Foliage reactivity is mature (sky wave,
circadian, batcher TSL), but the *air itself* still ignores the tracker. Wire a zero-allocation Atmosphere
Reactivity block (in `music-reactivity.ts` or a new `atmosphere-reactivity.ts`) mapping audio channels to
post-processing + sky uniforms: kick/bass → `uBloomStrength` (1.0→~2.5 crescendo), mix energy →
`uCrescendoFogDensity`, melody → `uShaftOpacity` + re-enable night shaft visibility (fix `shaftVisible`
hardcoded `false` in `game-loop.ts` ~444–467), BeatSync downbeats → brief bloom/shaft shimmer. Extend
`music-bindings.json` with an optional `atmosphere` section parallel to `weatherReactivity`. WebGL fallback
path must receive the same uniform values. This is the highest-impact remaining step to make the forest
feel like a single breathing instrument.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum. Opportunistic — activate when upgrading Three.js version, not a standalone sprint.

<!-- Completed ideas archived to Done below (2026-05-19 sky→foliage propagation, 2026-05-26 channel-to-biome completeness, 2026-05-30 sky-wave→plant-pose, TSL/VRAM audit). -->
- [ ] **Day/night plant behaviour** *(promoted to Copilot issue 2026-06-02)* — Plants physically open/glow by day, close/dim at night driven by the day/night cycle, not just music-channel intensity. Builds on `plant-pose-machine.ts`. Landed for `SimpleFlowerBatcher` (commit 99fcbad, #1208) — verify coverage across remaining batchers, then close.

**User idea pool — GitHub issues filed 2026-06-09 (Noah's in-context backlog, primary source this phase):**
- [ ] **#1169 Music-Reactive Atmosphere Bridge** — audio → bloom/fog/light-shafts. `[in progress — 2026-06-16]` ← today's focus
- [x] **#1168 WebGL2 fallback renderer** — toggleable WebGLRenderer alongside WebGPU for debugging/CI/agent porting; unblocks visual inspection. Foundational for several others.
- [ ] **#1170 Gem Canopy** — hanging faceted crystal fruits on trees (`GemFruitBatcher`), music-channel shimmer. Signature scenic biome.
- [ ] **#1171 Luminous Mycelium Realm** — glass mushrooms + ambient spore particle field; companion biome to luminous plants.
- [ ] **#1172 Cinematic Explore Mode** — promote dev orbit prototype to player-facing hybrid FP+orbit camera.
- [ ] **#1173 TSL Volumetric God Rays + selective DoF** — performant revival of golden-hour shafts; overlaps #1169 on shaft work (sequence after).
- [ ] **#1174 Distance LOD Tiers for instanced batchers** — three-tier (hero/mid/far) for trees/mushrooms/flowers/luminous. Performance lever.
- [ ] **#1175 Candy Material Cookbook + grok.md onboarding upgrade** — docs-only; canonical material/music-binding quick-start. Fully decoupled from code work.
- [x] **#1176 / #1182 Awakened Flora Persistence** — world that "remembers" you; #1182 is the narrow v1 slice (scope-guarded away from atmosphere/render files). ← Copilot prep target today (decoupled from #1169).

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] **#1134 — Stable release / pinned-build process** — annotated tags + GitHub Releases for known-good states; feature flags to disable heavy subsystems. **Partially landed**: `scripts/make-release.mjs` + `npm run release:tag` / `npm run release` now exist. Remaining: cut the first known-good tag now that loading is stable; confirm feature-flag fallbacks. Now actionable.
- [ ] **#1136 — Consolidate duplicated `LoadingScreen` class** (`loading-screen.ts` vs `loading-screen-ui.ts`) — leftover from loading cluster; .swarm-state noted a duplicate-declaration build blocker was patched, not consolidated. Small decoupled refactor — good future Copilot candidate.
- [ ] **Open draft PR #1214 (Jules)** — Palette: keyboard active state on loading-screen skip/reload buttons. Decoupled (CSS + loading-screen buttons). Review/merge independently.
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [ ] **[ui bug — #702]** Auto-scroll forces page to bottom on load, blocking top-row links — *likely resolved* by `preventScroll: true` on all `.focus()` calls (commit 88f2bf3, PR #1125). Verify on live site, then close.
- [ ] Three.js ColorSpace enum — opportunistic, activate when upgrading Three.js version (not a standalone sprint).

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] **2026-06-16** 🔴 LOADING REGRESSION CLUSTER (#1133–#1142) RESOLVED — scene/world population now reliable. Root cause fixed via single-boot stable `worldGenerationToken` orchestration across async phases (340dfe0), `reliableBoot` guards, silent-entity-drop fix on map-load token invalidation (#1211 / 5bd3266), and background-processor empty-queue/failure-counter-reset fix (4db0404). SpawnTracker + `window.__worldHealth` telemetry + spawn-count smoke assertions landed (Copilot PR #1138 merged; `test:spawn-tracker` / `test:world-health` now in `test:integration`). Cluster issues closed; #1170 confirms "loading reliability restored." Follow-ups parked in Backlog: #1134 release tagging (tooling now exists), #1136 LoadingScreen consolidation.
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
Date: 2026-06-16
Mode: USER IDEA — last run's loading Fix First (#1133 cluster) LANDED and is closed; foundation stable, so back to feature work. Noah filed a 10-issue in-context idea batch on 2026-06-09 (#1168–#1176, #1182); that is the primary idea pool. Picked #1169 (Atmosphere Bridge) as highest-leverage music-reactivity work.
Focus: #1169 Music-Reactive Atmosphere Bridge — zero-alloc audio→`uBloomStrength`/`uCrescendoFogDensity`/`uShaftOpacity` mapping + re-enable night light shafts (fix `shaftVisible` in game-loop.ts ~444–467) + optional `atmosphere` block in music-bindings.json + WebGL parity. kimi-cli owns it. Copilot prep (decoupled): #1182 Awakened Flora Persistence v1 (scope-guarded away from atmosphere/render files). Claude Code: full-stack build→deploy-dry-run→first release tag hygiene.
Outcome: <!-- fill in at end of day after kimi-cli loop -->
Context gap: No access to recent_chats / conversation_search in this environment — prior-session reconstruction is from git history, open/closed issues, weekly_plan.md, and .swarm-state.md only. Could not confirm live-site behaviour (#702 auto-scroll, deploy state).
