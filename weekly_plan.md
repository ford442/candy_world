# candy_world — Weekly Plan

## Today's focus
**2026-05-05 — User Idea (continuation): Planning Debt — complete archival of root `.md` docs.**
Previous run set this focus but kimi-cli did not complete the archival (no `docs/archive/` created, all 44 files still at root). Today's run re-launches the swarm with a concrete per-file categorisation spec. Outcome goal: ≤10 live docs at root, ~30 archived under `docs/archive/`, `docs/archive/INDEX.md` written.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum.
- [x] **2026-05-05** **Planning Debt — archive completed plan files** — Review and prune `plan.md`, `IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md`, and the 30+ other `*.md` planning/summary docs at repo root. Practically all listed features/migrations are currently marked 'Implemented' — keep what's still live, archive the rest under `docs/archive/`.

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
Date: 2026-05-05 (re-run / continuation)
Mode: User Idea — Planning Debt (continuation; previous run produced no archive)
Focus: Complete archival of 44 root `.md` files → docs/archive/. kimi-cli re-launched with per-file categorisation spec. GitHub issue drafted for Moon Dance note-colour sky reactivity (next feature, decoupled).
Outcome: TBD
