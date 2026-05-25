# candy_world — Weekly Plan

## Today's focus
**2026-05-19 — User Idea: Per-channel MOD note-color propagation from sky to foliage.**
When a tracker note fires on the sky/moon channel, the note's hue (already in `BiomeUniforms.skyMoon.moonNoteColor`) cascades downward to nearby foliage emissive uniforms, creating a visible color wave from sky to ground synchronized to the beat. 
**Progress (Task A):** `target_biomes` in music-bindings.json is now respected (was parsed but ignored). Wave logic fully data-driven with index-based stagger. luminous_plants added to targets + small emissive tint in luminous-plant-batcher.ts so sky hue visibly reaches them. portamento/wisteria/trees/mushrooms already benefit because they consume the arpeggioGrove or crystalline noteColor hubs. Touches `music-reactivity.ts`, `luminous-plant-batcher.ts`, `music-bindings.json`. See also new guidance in AGENTS.md. Ready for more targets or visual tuning.

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

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] **[bug] portamento-batcher uTwilight stub** — `src/foliage/portamento-batcher.ts` imports `uTwilight` from `sky.ts` (line 16) but never uses it in a shader node. `CONFIG.glow.glowColorMap['portamento']` is read (line 149) but `uTwilight` multiplier is missing from the emissive graph. Fix by adding `.mul(uTwilight)` to the glow color node, matching the pattern in `simple-flower-batcher.ts:161`.
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [ ] **[ui bug — #702]** Auto-scroll on live site forces page to bottom on load, blocking top-row links. Separate: no links to external apps are clickable. Labeled "jules" on GitHub. Likely a `scroll-behavior` or `focus` side-effect from loading-screen dismissal.
- [ ] Three.js ColorSpace enum — opportunistic, activate when upgrading Three.js version (not a standalone sprint).

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
- [x] **2026-05-19** Twilight Glow Completion — `glowColorMap` expanded to 9 species (mushroom, tree, flower, dandelion, wisteria, lotus, lantern, portamento, global). `uTwilight` wired into all major foliage batchers. Portamento-batcher stub (import-only) flagged to backlog for follow-up.
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
Date: 2026-05-19
Mode: User Idea — Per-channel MOD note-color propagation from sky to foliage
Focus: Beat-driven color wave from `BiomeUniforms.skyMoon.moonNoteColor` down to per-species foliage emissive uniforms. Introduces wave state (timestamp + color at beat), per-frame propagation lerp, and `music-bindings.json` config for which biomes receive the cascade. Portamento-batcher uTwilight stub moved to backlog. Twilight Glow marked Done.
Outcome: TBD
