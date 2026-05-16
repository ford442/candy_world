# candy_world — Weekly Plan

## Today's focus
**2026-05-12 — New Idea: Twilight Glow Completion & Expansion.**
`uTwilight` is live in trees and mushrooms but missing from 5+ foliage types (flowers, dandelions, wisteria, lotus, lanterns). `CONFIG.glow.glowColorMap` has 2 entries; PLAN_PLANTS_TWILIGHT_GLOW specifies the full map. kimi-cli completes species coverage. Outcome goal: all major foliage batchers react to uTwilight, glowColorMap has entries for every species, glow is visually consistent across the world at dusk.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum. Opportunistic — activate when upgrading Three.js version, not a standalone sprint.
- [ ] **Per-channel MOD note-color propagation from sky to foliage** — Extend the music-bindings system so each biome's note-color hue (established by Moon Dance, PR #764) propagates downward to nearby foliage emissive uniforms, creating a visible color wave from sky to ground per beat. Touches `foliage-reactivity.ts`, `music-reactivity.ts`, `music-bindings.json`. Full day.
- [ ] **Portamento-batcher + wisteria-cluster audio reactivity wiring** — `portamento-batcher.ts` imports `uTwilight` but is not wired to music-reactivity or music-bindings.json. Same for `wisteria-cluster.ts`. Add ADSR-driven scale/emission and per-channel hue mapping, matching the pattern established in tree-batcher and mushroom-batcher. Full day.

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Plants Twilight Glow — Implement configurable twilight glowing for existing foliage types based on docs/archive/PLAN_PLANTS_TWILIGHT_GLOW.md.
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [ ] **[ui bug — #702]** Auto-scroll on live site forces page to bottom on load, blocking top-row links. Separate: no links to external apps are clickable. Labeled "jules" on GitHub. Likely a `scroll-behavior` or `focus` side-effect from loading-screen dismissal.
- [ ] Three.js ColorSpace enum — opportunistic, activate when upgrading Three.js version (not a standalone sprint).

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
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
Date: 2026-05-12
Mode: New Idea — Twilight Glow Completion & Expansion
Focus: Wire `uTwilight` and `CONFIG.glow.glowColorMap` into all remaining foliage batchers (flowers, dandelions, wisteria, lotus, lanterns). Trees and mushrooms already done; 5+ types still missing species-specific glow. kimi-cli runs per-type sweep. Two new Ideas appended (note-color propagation, portamento/wisteria music wiring).
Outcome: TBD
