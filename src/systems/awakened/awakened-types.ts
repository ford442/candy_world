/**
 * Shared awakened-flora types — safe to import from hot-path batchers without
 * pulling the full persistence module into the `app` chunk.
 */

export const AWAKENED_SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'candy_world_awakened_v1';
export const SAVE_DEBOUNCE_MS = 500;

export type AwakenedBatcherKind = 'luminous' | 'gem_fruit';

export interface BatcherInstanceRef {
    batcher: AwakenedBatcherKind;
    instanceIndex: number;
    gemType?: number;
}

export interface AwakenedMeta {
    type: string;
    biome?: string;
    awakenedAt: number;
    lastNoteColor?: number;
    emissiveScale: number;
}

/** Default emissive scale — mirrors CONFIG.glow.awakenedGlowMultiplier at runtime in full module. */
export const DEFAULT_AWAKENED_EMISSIVE_SCALE = 1.35;

export const AWAKENABLE_TYPES = new Set(['luminous_plant', 'gem_canopy_tree']);
