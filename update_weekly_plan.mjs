import fs from 'node:fs';
let code = fs.readFileSync('weekly_plan.md', 'utf-8');
code = code.replace(
  "Outcome: <!-- fill in at end of day after the swarm loop -->",
  "Outcome: ✅ LANDED 2026-10-20 - Fixed `test:native-memory` failure where `initCandyPhysics is not a function`. The issue was `tsx` intercepting the `.wasm?init` module. Added programmatic `register` calls to the test files to hook in before tsx, and modified the hook to emit a `data:` URL to avoid the asset being swallowed by `tsx`."
);
fs.writeFileSync('weekly_plan.md', code);
