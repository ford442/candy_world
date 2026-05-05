# candy_world — Weekly Plan

## Today's focus
**2026-05-05 — User Idea: Planning Debt — audit and archive completed plan docs at repo root.**
44 `.md` files at the repository root, the majority with features marked "Implemented ✅". This clutter increases context cost for every AI agent session and slows Noah's own navigation. Today: categorise all root `.md` files (keep / archive / delete), move completed docs to `docs/archive/`, and leave only live, actively-referenced docs at root. No code changes — pure repo hygiene.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum.
- [in progress — 2026-05-05] **Planning Debt — archive completed plan files** — Review and prune `plan.md`, `IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md`, and the 30+ other `*.md` planning/summary docs at repo root. Practically all listed features/migrations are currently marked 'Implemented' — keep what's still live, archive the rest under `docs/archive/`.

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [ ] **[ui bug — #702]** Auto-scroll on live site forces page to bottom on load, blocking top-row links. Separate: no links to external apps are clickable. Labeled "jules" on GitHub. Likely a `scroll-behavior` or `focus` side-effect from loading-screen dismissal.
- [ ] Three.js ColorSpace enum — opportunistic, activate when upgrading Three.js version (not a standalone sprint).

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
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
Date: 2026-05-05
Mode: User Idea
Focus: Planning Debt — audit and archive 44 root-level `.md` docs (most marked "Implemented ✅").
Outcome: TBD — kimi-cli swarm running.
