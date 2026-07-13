const fs = require('fs');

let p = 'plan.md';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
    'Next Step: #1175 Candy Material Cookbook + grok.md onboarding upgrade.',
    '* Implementation Details: Standardized the TSL deformation chain across the codebase. Created `applyStandardDeformation` and `applyStandardDeformationWithLod` to ensure wind sway and player push are cleanly composed, eliminating double-applications in LOD batchers.\nNext Step: #1175 Candy Material Cookbook + grok.md onboarding upgrade or Graphic Rewire / Partial ECS.\n\nStatus: Implemented ✅\n'
);

fs.writeFileSync(p, c);
