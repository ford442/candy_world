const fs = require('fs');

const content = fs.readFileSync('plan.md', 'utf8');

const updatedContent = content.replace(
    "Next Step: Review and continue clearing remaining items from `weekly_plan.md` or `REFACTORING_PLAN_REMAINING.md`.",
    "Status: Implemented ✅\n* Implementation Details: **#1362 Circadian day/night across all instanced batchers**. Extended the PlantPoseMachine usage in simple-flower-batcher, flower-batcher, arpeggio-batcher and verified portamento-batcher already acts upon dayNightBias. For static batchers like mushroom-batcher, tree-batcher, luminous-plant-batcher, gem-fruit-batcher, subwoofer-lotus-batcher, and kick-drum-geyser-batcher, utilized the uCircadianPoseOffset to compose a negative Y-axis droop inside the standard TSL deformation graph to properly simulate a night rest pose uniformly governed by the core game loop's circadian controller.\nNext Step: Propose moving to #1361 (Chunk optimization) or #1351 (Cross-tier parity harness)."
);

fs.writeFileSync('plan.md', updatedContent, 'utf8');
