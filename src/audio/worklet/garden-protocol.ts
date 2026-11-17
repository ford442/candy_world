/**
 * Messages between GardenAudioEngine (main thread) and the garden
 * AudioWorkletProcessor. Note events do not travel as messages when a
 * SharedArrayBuffer ring is available (event-ring.ts); only setup, the
 * no-isolation event batches, stats and errors do.
 */
import type { PatchSpec } from './dsp-abi.ts';

/** registerProcessor() name. */
export const GARDEN_PROCESSOR_NAME = 'candy-garden';

export interface GardenInitMessage {
    type: 'init';
    /** candy_dsp.wasm bytes (transferred); the worklet compiles them itself. */
    wasm: ArrayBuffer;
    /** The event ring's buffer, or null to receive `events` batches instead. */
    ring: SharedArrayBuffer | null;
    /** Patch slots to write before the first note. */
    patches: ReadonlyArray<readonly [number, PatchSpec]>;
}

export type ToGardenProcessor =
    GardenInitMessage | { type: 'events'; data: Float64Array; count: number } | { type: 'stop' };

export interface GardenStatsMessage {
    type: 'stats';
    activeVoices: number;
    quanta: number;
    dspDropped: number;
    lateEvents: number;
}

export type FromGardenProcessor =
    | { type: 'ready'; quantum: number; maxVoices: number; sampleRate: number }
    | { type: 'error'; message: string }
    | GardenStatsMessage;
