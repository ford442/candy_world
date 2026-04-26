# candy_world — Weekly Plan

## Today's focus
**2026-04-21 — Testing Debt: restore a real `npm test` path.**
`package.json` currently stubs `test` and `test:wasm` with `echo` statements pointing at missing files (`verify.py`, `verify_wasm_particle_bounds.js`). The stack has Playwright installed and tracker/physics work landing almost daily — shipping without any runnable test gate is the biggest foundational risk on the board. Goal today: either restore the missing verifiers or replace them with a minimal Playwright smoke + WASM bounds check that actually runs in `npm test` / `npm run test:integration`.

## Ideas
<!--
Write ideas here during the week as they come to you.
Routine prioritizes these over generated ideas.
Format: - [ ] Short description (optional: more context on next line indented)
Routine will mark picked items as "[in progress — YYYY-MM-DD]".
-->
- [ ] [in progress — 2026-04-21] **Testing Debt** — Restore `verify.py` and `verify_wasm_particle_bounds.js`, or rewrite/safely remove these broken commands from `package.json`. Both files are completely missing from the filesystem; `pnpm test` and `pnpm run test:integration` currently `echo` skip messages (see commit c8091ff).
- [ ] **Three.js ColorSpace enum regression** — In `src/core/init.js` we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` / `THREE.SRGBColorSpace` produced TS/build warnings with the current `three` version. When updating Three.js, revert to the proper enum.
- [ ] **Planning Debt — archive completed plan files** — Review and prune `plan.md`, `IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md`, and the 30+ other `*.md` planning/summary docs at repo root. Practically all listed features/migrations are currently marked 'Implemented' — keep what's still live, archive the rest under `docs/archive/`.

## Backlog
<!--
Unfinished items, known bugs, deferred ideas.
Routine maintains this automatically — you can add items too.
-->
- [ ] Accessibility note: `Announcer` in `src/ui/announcer.ts` dynamically injects `aria-live` regions rather than relying on static HTML — future ARIA work should use the dynamic path, not add static tags.

## Done
<!--
Completed items, routine archives here with date.
Prune occasionally when this gets long.
-->
<!-- No items archived by the routine yet. First run — historical completions live in git log. -->

## Last run
<!-- Routine writes summary here each run. Overwrites previous. -->
Date: 2026-04-21 (first routine run in template form)
Mode: User Idea
Focus: Testing Debt — restore a real `npm test` path
Outcome: TBD
- [ ] Investigate and fix runtime error: Cannot read properties of undefined (reading 'mul') during smoke test initialization.
- [ ] UI Testing: Headless Playwright test for Jukebox fails due to TimeoutError (`locator('#addSongsBtn') to be visible`). Investigate and fix the script so we can properly verify DOM interactions in headless environments.
