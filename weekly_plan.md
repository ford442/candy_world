# candy_world — Weekly Plan

## Today's focus
**2026-04-28 — Fix First: close the Testing Debt loop.**
Last week's Testing Debt focus produced two documented runtime bugs that were never resolved: (1) `Cannot read properties of undefined (reading 'mul')` crash during smoke-test initialisation — likely a TSL/Three.js import order problem; (2) Playwright headless Jukebox test times out waiting for `#addSongsBtn` to become visible. Both blockers are in the test infrastructure (files under `tests/`, `src/ui/`). Neither involves rebuilding WASM or changing game logic. Goal: both `npm test` and `npm run test:wasm` pass cleanly from a fresh `npm install`.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] [in progress — 2026-04-28] **Testing Debt** — `npm test` (smoke-runner.mjs → Playwright) and `npm run test:wasm` must pass cleanly. Two specific bugs block this: (a) `Cannot read properties of undefined (reading 'mul')` during smoke init; (b) Playwright headless timeout on `locator('#addSongsBtn')`.
- [ ] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum.
- [ ] **Planning Debt — archive completed plan files** — Review and prune `plan.md`, `IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md`, and the 30+ other `*.md` planning/summary docs at repo root. Practically all listed features/migrations are currently marked 'Implemented' — keep what's still live, archive the rest under `docs/archive/`.
- [ ] **Music-Channel-to-Biome Shader Binding: Arpeggio Grove & Crystalline Nebula** — PR #699 landed both new biomes but neither has XM-channel-to-visual-parameter wiring. Wire arpeggio/melody tracker channels to TSL shader uniforms (amplitude, shimmer, hue-shift) in both biomes.

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.
- [ ] **[test bug]** Smoke init crash: `Cannot read properties of undefined (reading 'mul')` — surfaces during WebGPU/TSL renderer bootstrap in headless Playwright. Likely a node-environment import that triggers TSL shader compilation before Three.js is fully initialised.
- [ ] **[test bug]** Playwright headless Jukebox: `locator('#addSongsBtn') to be visible` TimeoutError — element either not rendered or hidden behind a loading gate in headless Chrome with WebGPU disabled.

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
<!-- No items archived by the routine yet. First run — historical completions live in git log. -->

## Last run
<!-- Routine writes summary here each run. Overwrites previous. -->
Date: 2026-04-28
Mode: Fix First
Focus: Resolve the two inherited test-infrastructure bugs (TSL `mul` crash + Jukebox headless timeout) so `npm test` passes from a clean install.
Outcome: TBD
