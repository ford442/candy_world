const fs = require('fs');

// Update plan.md
let planCode = fs.readFileSync('plan.md', 'utf8');
planCode += `

Status: Implemented ✅
* Implementation Details: Replaced legacy \`getUnifiedGroundHeight\` and \`getUnifiedGroundHeightTyped\` with the centralized \`getAuthoritativeGroundHeight\` across generators, batchers, and physics loops. Migrated all hardcoded decorator placement offsets to use \`computePlacementY\` and \`plantOnSurface\` to ensure batcher-placed instances are perfectly grounded according to their \`ENTITY_BASE_OFFSETS\`. Wired \`reconcileGroundedEyeY\` in the player fallback loop so the first-person camera smoothly tracks terrain height and platform limits without snapping or drift.

Next Step: Ask the user for the next task.
`;
fs.writeFileSync('plan.md', planCode);

// Update weekly_plan.md
let weeklyCode = fs.readFileSync('weekly_plan.md', 'utf8');
weeklyCode = weeklyCode.replace(
    /- \[ \] \*\*#1265 Player ground level, eye height & object alignment\*\* — unify ground sampling; consistent eye height across terrain\+objects; batcher base-Y at spawn; \`\?debugPlayer\` viz\. \`bug\`\+\`enhancement\`\. Hard prerequisite for #1266\. `\[in progress — 2026-06-30\]` ← today's focus/,
    '- [x] **#1265 Player ground level, eye height & object alignment** — unify ground sampling; consistent eye height across terrain+objects; batcher base-Y at spawn; `?debugPlayer` viz. `bug`+`enhancement`. Hard prerequisite for #1266. `[landed — 2026-06-30]` ← today\'s focus'
);
fs.writeFileSync('weekly_plan.md', weeklyCode);
