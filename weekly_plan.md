# candy_world — Weekly Plan

## Today's focus
**2026-05-26 — New Idea: Channel-to-Biome Visual Mapping Completeness.**
Audit and wire every orphaned foliage/atmospheric batcher that currently has no channel-driven uniform:
`aurora.ts`, `arpeggio.ts` / `arpeggio-batcher.ts`, `chromatic.ts`, `panning-pads.ts`, `silence-spirits.ts`,
`waterfall-batcher.ts`, `musical_flora.ts`, `lake_features.ts`. Each batcher gets a `BiomeId` tag,
an entry in `assets/music-bindings.json`, and at least one TSL uniform (noteColor / shimmer / hueShift)
consumed from `getBiomeUniforms()`. Prefer reusing existing BiomeIds before adding new ones.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum. Opportunistic — activate when upgrading Three.js version, not a standalone sprint.
- [completed — 2026-05-19] **Per-channel MOD note-color propagation from sky to foliage** — All three tasks completed sequentially:
  - **A**: Sky Wave fully data-driven via target_biomes (luminous_plants added + visible effect).
  - **B**: BiomeId + getBiomeUniforms() helper + tagging on creation + usage in 2 batchers + debug hook.
  - **C**: ChannelData type completed (note + notes[]), portamento uTwilight explicitly wired + documented (backlog item closed), channel-range validation added in music-reactivity.
  Smoke test reached "✓ Scene is ready!" + "No console errors" (partial run due to env timeout). WASM tests green. All changes are non-breaking.
- [completed — 2026-05-26] **Channel-to-Biome visual mapping completeness** — Wire all orphaned batchers (aurora, arpeggio, chromatic, panning-pads, silence-spirits, waterfall, musical_flora, lake_features) to BiomeUniforms + music-bindings.json. Each batcher gets a BiomeId, at least one driven uniform, and a music-bindings.json entry.
- [completed — 2026-05-30] **Sky wave → plant pose transitions** — Drive ADSR pose-state-machine transitions (`plant-pose-machine.ts`) from wave arrival timestamp rather than channel intensity alone; plants physically respond to the beat wave sweeping across the terrain.
- [x] **TSL batcher geometry + VRAM audit** — Survey remaining batchers (wisteria-cluster, glowing-flower-batcher, dandelion-batcher, arpeggio-batcher, waterfall-batcher) for shared geometry patterns, missing `dispose()` calls, and VRAM leak potential matching the tree-batcher VRAM leak fix (PR #1075).

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] **Review open draft PRs** — 5 drafts need eyes before merge: #817 (advanced instancing, LuminousPlantBatcher), #853 (portamento uTwilight — Copilot, already verified correct), #1081 (loading-screen module refactor), #1082 (ARIA mode selection + D-Pad), #1085 (scaleX progress bar animation). #853 is safe to merge immediately.
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [ ] **[ui bug — #702]** Auto-scroll on live site forces page to bottom on load, blocking top-row links. Separate: no links to external apps are clickable. Labeled "jules" on GitHub. Likely a `scroll-behavior` or `focus` side-effect from loading-screen dismissal.
- [ ] Three.js ColorSpace enum — opportunistic, activate when upgrading Three.js version (not a standalone sprint).

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
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
Date: 2026-05-26
Mode: New Idea — Ideas list had no actionable items (Three.js ColorSpace was tagged opportunistic). Foundation stable: sky wave landed and verified, portamento fix confirmed in code (PR #853), main builds clean.
Focus: Channel-to-Biome visual mapping completeness — wire all orphaned atmospheric/foliage batchers (aurora, arpeggio, chromatic, panning-pads, silence-spirits, waterfall, musical_flora, lake_features) to the music-reactivity pipeline via BiomeUniforms + music-bindings.json.
Outcome: Successfully mapped all orphaned batchers to BiomeUniforms, added musical_flora and lake_features biomes to music-bindings.json and systems.
