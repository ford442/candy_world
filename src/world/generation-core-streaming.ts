/** Shared streaming constants — extracted to avoid chunk-streamer ↔ generation-core cycle. */

export const STREAMING_PRIORITY_TYPES = [
    'cave',
    'subwoofer_lotus',
    'instrument_shrine',
    'retrigger_mushroom',
    'portamento_pine',
    'bubble_willow',
    'mushroom',
    'cloud',
    'flower',
] as const;

export const VISIBLE_BUBBLE_RADIUS = 80;
export const VISIBLE_BUBBLE_LIMIT = 300;
