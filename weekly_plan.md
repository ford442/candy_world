- Investigate and restore missing test scripts: verify.py and verify_wasm_particle_bounds.js.
- [Testing Debt] When attempting to run `pnpm test` and `pnpm run test:integration`, tests failed because `verify.py` and `verify_wasm_particle_bounds.js` are completely missing from the filesystem. Action Item: Restore, rewrite, or safely remove these broken commands from package.json.
- [Tech Debt] In `src/core/init.js`, we fall back to string literals (`'display-p3'`, `'srgb'`) for `outputColorSpace` because `THREE.DisplayP3ColorSpace` and `THREE.SRGBColorSpace` resulted in TS/build warnings with the current `three` version. When updating Three.js, ensure these are reverted to the proper enum.
- [Planning Debt] Review and fix all plan files (e.g., plan.md, IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md). Goal is to archive or delete completed tasks since practically all listed features and migrations are currently marked as 'Implemented'.

Note on Accessibility (ARIA): The `Announcer` system in `src/ui/announcer.ts` dynamically injects `aria-live` regions into the DOM instead of relying solely on statically written HTML tags. This was discussed during the audio controls ARIA implementation.
