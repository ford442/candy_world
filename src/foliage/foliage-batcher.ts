// src/foliage/foliage-batcher.ts
// DEPRECATED: This file has been refactored into the batcher/ directory
// Please import from './batcher/index.ts' instead
// This file is kept for backward compatibility

export {
    FoliageBatcher,
    foliageBatcher,
    // Types
    BatchState,
    ExtendedBatchState,
    FoliageObject,
    // Constants
    BATCH_SIZE,
    BATCH_MEMORY_START,
    EXTENDED_BATCH_START,
    ENTRY_STRIDE,
    RESULT_STRIDE,
    // Audio helpers
    getVibratoAmount,
    getTremoloAmount,
    getHighFreqAmount,
    getAverageVolume,
    getPanActivity,
    // Effect functions
    applySnareSnap,
    applyAccordion,
    applyFiberWhip,
    applySpiralWave,
    applyVibratoShake,
    applyTremoloPulse,
    applyCymbalShake,
    applyPanningBob,
    applySpiritFade
} from './batcher/index.ts';
