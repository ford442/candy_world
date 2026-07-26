const fs = require('fs');

// Update MIGRATION_TRACKER.md
let migrationContent = fs.readFileSync('MIGRATION_TRACKER.md', 'utf-8');
migrationContent = migrationContent.replace(
    '**Status:** ✅ Completed for arpeggio (#1358) — dedicated `emscripten/batcher_instance.cpp` (`batchWriteInstancePose_c`) + `src/utils/wasm-batcher-instance.ts` with TS fallback; `arpeggio-batcher` wired. Tree still uses `batchComposeMatrices_c`. Widen to mushroom/portamento/wisteria only after parity stays green.',
    '**Status:** ✅ Completed for arpeggio (#1358), mushroom, and portamento batchers — dedicated `emscripten/batcher_instance.cpp` (`batchWriteInstancePose_c`) + `src/utils/wasm-batcher-instance.ts` with TS fallback. Tree still uses `batchComposeMatrices_c`.'
);
fs.writeFileSync('MIGRATION_TRACKER.md', migrationContent);

// Update weekly_plan.md
let weeklyContent = fs.readFileSync('weekly_plan.md', 'utf-8');
weeklyContent = weeklyContent.replace(
    'Building #1351 now is the highest-leverage Migration move: it hardens what already\nshipped and unblocks safely widening the matrix-compose port to mushroom/portamento/wisteria batchers.',
    'Building #1351 now is the highest-leverage Migration move: it hardens what already\nshipped and unblocks safely widening the matrix-compose port to mushroom/portamento/wisteria batchers. ✅ **Status: Implemented. widened to mushroom and portamento batchers.**'
);
fs.writeFileSync('weekly_plan.md', weeklyContent);
