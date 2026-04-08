// src/foliage/batcher/index.ts
// Barrel file for foliage batcher module

// Main class and singleton
export { FoliageBatcher, foliageBatcher } from './foliage-batcher-core.ts';

// Types
export type { FoliageObject } from './foliage-batcher-types.ts';
export type { BatchState, ExtendedBatchState } from './foliage-batcher-types.ts';

// Constants
export {
    BATCH_SIZE,
    BATCH_MEMORY_START,
    EXTENDED_BATCH_START,
    ENTRY_STRIDE,
    RESULT_STRIDE
} from './foliage-batcher-types.ts';

// Audio analysis helpers (for advanced use cases)
export {
    getVibratoAmount,
    getTremoloAmount,
    getHighFreqAmount,
    getAverageVolume,
    getPanActivity
} from './foliage-batcher-audio.ts';

// Effect apply functions (for advanced use cases)
export {
    applySnareSnap,
    applyAccordion,
    applyFiberWhip,
    applySpiralWave,
    applyVibratoShake,
    applyTremoloPulse,
    applyCymbalShake,
    applyPanningBob,
    applySpiritFade
} from './foliage-batcher-effects.ts';
