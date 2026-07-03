# candy_world — Weekly Plan

## Today's focus
**2026-06-30 — USER IDEA (GitHub issue #1265): Player ground level, eye height & object alignment.**
Foundational locomotion/collision hygiene — unify ground sampling so eye height is consistent across terrain +
all static objects, and so batcher-placed instances (mushroom stems, rocks, tree roots) sit flush on the ground
instead of clipping/floating. This is the freshest in-context user idea (Noah filed #1265 + #1266 on 2026-06-28),
it carries a `bug` label (eye view drifts/snaps, players sink or hover near clusters), AND it is the hard
prerequisite #1266 (walkable cloud platforms) explicitly blocks on. Picking the foundation before the feature.
**Why now:** Gem Canopy (#1170) landed clean last week with all tests green — foundation is stable, so this is
the moment to fix the locomotion quality issue that's been nagging and to unblock the next vertical-exploration
feature. **Scope of the swarm:** audit where ground height is currently computed (scattered across
game-loop / player / `physics.core.ts` `getUnifiedGroundHeightTyped` / `wasm-loader.js`), centralize/strengthen a
unified ground query with terrain→object→platform priority, drive player foot + `eyeHeight` off it with smooth
lerp, add a `?debugPlayer`/`?debugHeights` viz, and ensure batchers sample base-Y at spawn. Keep it kinematic
raycast + capsule — NO physics engine, NO jumping/climbing, NO music/material changes. Audit-centralize-tune;
the debug viz is the acceptance lever.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [x] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum. Opportunistic — activate when upgrading Three.js version, not a standalone sprint.

<!-- Completed ideas archived to Done below (2026-05-19 sky→foliage propagation, 2026-05-26 channel-to-biome completeness, 2026-05-30 sky-wave→plant-pose, TSL/VRAM audit). -->
- [ ] **Day/night plant behaviour** *(promoted to Copilot issue 2026-06-02)* — Plants physically open/glow by day, close/dim at night driven by the day/night cycle, not just music-channel intensity. Builds on `plant-pose-machine.ts`. Landed for `SimpleFlowerBatcher` (commit 99fcbad, #1208) — verify coverage across remaining batchers, then close.

**User idea pool — GitHub issues filed 2026-06-28 (Noah's freshest in-context backlog — vertical-exploration arc):**
- [x] **#1265 Player ground level, eye height & object alignment** — unify ground sampling; consistent eye height across terrain+objects; batcher base-Y at spawn; `?debugPlayer` viz. `bug`+`enhancement`. Hard prerequisite for #1266. `[landed — 2026-06-30]` ← today's focus
- [ ] **#1266 Walkable cloud blocks / platforms** — placeable solid candy-cloud surfaces the player can stand on; instanced, music-reactive glow, map.json persistence. **Blocked on #1265** — do not start cloud integration until ground system is merged & stable. Next in the arc.

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

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [x] **#1134 — Stable release / pinned-build process** — annotated tags + GitHub Releases for known-good states; feature flags to disable heavy subsystems. **Partially landed**: `scripts/make-release.mjs` + `npm run release:tag` / `npm run release` now exist. Remaining: cut the first known-good tag now that loading is stable; confirm feature-flag fallbacks. Now actionable.
- [x] **#1136 — Consolidate duplicated `LoadingScreen` class** (`loading-screen.ts` vs `loading-screen-ui.ts`) — leftover from loading cluster; .swarm-state noted a duplicate-declaration build blocker was patched, not consolidated. Small decoupled refactor — good future Copilot candidate.
- [x] **Open draft PR #1214 (Jules)** — Palette: keyboard active state on loading-screen skip/reload buttons. Decoupled (CSS + loading-screen buttons). Review/merge independently.
- [x] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [x] **[ui bug — #702]** Auto-scroll forces page to bottom on load, blocking top-row links — *likely resolved* by `preventScroll: true` on all `.focus()` calls (commit 88f2bf3, PR #1125). Verify on live site, then close.
- [ ] **#1134 — Stable release / pinned-build process** — annotated tags + GitHub Releases for known-good states; feature flags to disable heavy subsystems. **Partially landed**: `scripts/make-release.mjs` + `npm run release:tag` / `npm run release` now exist. Remaining: cut the first known-good tag now that loading is stable; confirm feature-flag fallbacks. Now actionable.
- [ ] **#1136 — Consolidate duplicated `LoadingScreen` class** (`loading-screen.ts` vs `loading-screen-ui.ts`) — leftover from loading cluster; .swarm-state noted a duplicate-declaration build blocker was patched, not consolidated. Small decoupled refactor — good future Copilot candidate.
- [ ] **Open draft PR #1245 (Jules)** — Stabilize headless boot + background processing in CI: replaces non-deterministic `requestIdleCallback` in `BackgroundProcessor` with a sync wait loop under `isCIorHeadless()`, bypasses `createComputeBerries()` / gates `initExtended()` VRAM spikes on headless, and claims to fix an `isNight is not defined` ReferenceError in `music-reactivity.ts`. **NOTE:** that ReferenceError is NOT live on main (`isNight` is defined at `music-reactivity.ts:506`) — this PR likely branched pre-fix. Review carefully so it doesn't re-introduce churn; the CI-stability parts are valuable. Decoupled from #1170.
- [ ] **Open draft PR #1246 (Jules)** — Palette: move loading-screen base HTML into `index.html` for faster FCP, fetch via `getElementById` with fallback generation. Decoupled cosmetic/loading. Review/merge independently. (Touches `loading-screen-ui.ts` — coordinate with #1136 consolidation.)
- [ ] **Open draft PR #1214 (Jules)** — Palette: keyboard active state on loading-screen skip/reload buttons. Decoupled (CSS + loading-screen buttons). Review/merge independently — possibly superseded by #1246's loading-screen rework; check for overlap.
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [ ] **[ui bug — #702]** Auto-scroll forces page to bottom on load, blocking top-row links — *likely resolved* by `preventScroll: true` on all `.focus()` calls (commit 88f2bf3, PR #1125). Verify on live site, then close.
- [ ] Three.js ColorSpace enum — opportunistic, activate when upgrading Three.js version (not a standalone sprint).
- [ ] **#1266 — Walkable cloud blocks / platforms** — next in the vertical-exploration arc; **blocked on #1265** (today's focus). Pick this up once the unified ground system lands & is stable.
- [ ] **#1249 — Candy Material Cookbook v2 (docs de-drift + enrich)** — docs-only, fully decoupled from runtime/foliage work; fixes verified broken `uTwilight` import path, reconciles 3 contradictory position-node orderings, documents all 7 `CandyPresets`, adds LUT/r32float/circadian gotchas, + one preset-coverage guard script. **Today's Copilot prep target** (collision-free with #1265). Open since 2026-06-24.
- [ ] **Issue-hygiene: close landed-but-OPEN issues** — #1170 (Gem Canopy, landed 2026-06-24), #1173 (god rays, #1241), #1182 + #1176 (awakened flora v1, #1232) all still show OPEN on GitHub despite landing. Verify on live site, then close to stop them re-surfacing as "unfinished."
- [ ] **Open draft PRs (Jules, decoupled — review/merge independently):** #1275 Bolt LOD matrix-array bypass (perf, `O(N)` decompose elimination); #1274 Aria Jukebox upload screen-reader announcements + `announce` import fix; #1273 Palette Jukebox a11y focus-trap polish (overlaps #1274 — check before merging both); #1255 Palette HUD ability-button interaction/glow/ARIA polish.

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
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
Date: 2026-06-30
Mode: USER IDEA — no Fix First trigger (last week's #1170 Gem Canopy LANDED clean, all tests green, 24 trees spawning). Picked the freshest in-context user idea: GitHub issue #1265 (filed 2026-06-28 alongside #1266). #1265 is `bug`-tagged (eye-height drift, player sink/hover near clusters) and is the hard prerequisite #1266 (walkable cloud platforms) blocks on — foundation before feature.
Focus: #1265 Player ground level / eye height / object alignment. kimi-cli: audit scattered ground-height computation (game-loop / player / `physics.core.ts getUnifiedGroundHeightTyped` / `wasm-loader.js`), centralize a unified ground query (terrain→object→platform priority), drive player foot + eyeHeight off it with smooth lerp, add `?debugPlayer`/`?debugHeights` viz, ensure batchers sample base-Y at spawn. Kinematic raycast + capsule only — NO physics engine / jumping / music / material changes. Copilot prep (decoupled from player/ground files): NEW issue — audio-reactive ambient sparkle/mote field for the Gem Canopy corridor (new particle module + music binding, builds on last week's landing). Claude Code: full-stack build → deploy dry-run → cut first known-good release tag (#1134 tooling exists).
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
