/**
 * Main-thread side of the garden DSP engine: loads candy_dsp.wasm and the
 * 'candy-garden' AudioWorklet, connects its output, and queues note events
 * with AudioContext timestamps (docs/MUSIC_GARDEN.md).
 *
 *   const engine = await GardenAudioEngine.create(ctx, masterGain, { patches });
 *   if (engine) engine.noteOn(ctx.currentTime + 0.05, patch, 60, 0.8, 0.5);
 *
 * create() resolves null when the engine cannot run here (no AudioWorklet, no
 * candy_dsp.wasm because build:emcc did not run, a load error or a timeout);
 * the caller keeps its Web Audio node fallback (SynthVoice).
 *
 * Events travel through a SharedArrayBuffer ring when the page is cross-origin
 * isolated, and as one posted batch per task otherwise (event-ring.ts).
 *
 * Only the generative engine's dynamic import() reaches this module: the
 * `?worker&url` import below is Vite-only, so Node tests never load it (they
 * drive garden-dsp-host.ts directly).
 */
import { log } from '../../utils/log.ts';
import { GLOBAL_PARAMS, PATCH_PARAMS, type GlobalParamName, type PatchSpec } from './dsp-abi.ts';
import { EventBatch, EventKind, EventRing, type EventWriter } from './event-ring.ts';
import gardenProcessorUrl from './garden-processor.ts?worker&url';
import {
    GARDEN_PROCESSOR_NAME,
    type FromGardenProcessor,
    type GardenInitMessage,
    type GardenStatsMessage,
    type ToGardenProcessor,
} from './garden-protocol.ts';

export type GardenTransport = 'shared' | 'message';

export interface GardenEngineStats {
    transport: GardenTransport;
    /** Voices sounding at the last rendered quantum. */
    activeVoices: number;
    /** Quanta rendered so far (a stalled worklet stops counting). */
    quanta: number;
    /** Events dropped: ring full on this side, or the module's queue full. */
    droppedEvents: number;
    /** Note events that arrived after their time (they played at once). */
    lateEvents: number;
}

export interface GardenEngineOptions {
    /** Patch slots written before the first note. */
    patches?: ReadonlyArray<readonly [number, PatchSpec]>;
    /** Where candy_dsp.wasm is (default: next to the page). */
    wasmUrl?: string;
    /** The processor module (default: the bundled garden-processor.ts). */
    workletUrl?: string;
    /** Give up if the worklet has not answered by then (ms). */
    readyTimeoutMs?: number;
    /** Set false to force the posted-batch transport even when isolated. */
    sharedMemory?: boolean;
}

/** Records the shared ring holds; a 60 Hz producer queues a few dozen per frame at most. */
const RING_CAPACITY = 2048;
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

/** True when a SharedArrayBuffer can be posted to the worklet (cross-origin isolated). */
export function canShareMemory(): boolean {
    return (
        typeof SharedArrayBuffer !== 'undefined' &&
        (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
    );
}

/** candy_dsp.wasm, or null if it is missing (a dev server without build:emcc answers with index.html). */
export async function fetchDspWasm(url?: string): Promise<ArrayBuffer | null> {
    const href = url ?? new URL('candy_dsp.wasm', document.baseURI).href;
    try {
        const res = await fetch(href);
        if (!res.ok) return null;
        const bytes = await res.arrayBuffer();
        const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
        return WASM_MAGIC.every((b, i) => head[i] === b) ? bytes : null;
    } catch {
        return null;
    }
}

function waitForReady(port: MessagePort, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            port.removeEventListener('message', onMessage);
            reject(new Error(`garden worklet did not answer within ${timeoutMs} ms`));
        }, timeoutMs);
        const onMessage = (e: MessageEvent<FromGardenProcessor>) => {
            if (e.data.type !== 'ready' && e.data.type !== 'error') return;
            clearTimeout(timer);
            port.removeEventListener('message', onMessage);
            if (e.data.type === 'ready') resolve();
            else reject(new Error(e.data.message));
        };
        port.addEventListener('message', onMessage);
        port.start();
    });
}

export class GardenAudioEngine {
    readonly node: AudioWorkletNode;
    readonly transport: GardenTransport;
    private readonly writer: EventWriter;
    private readonly ring: EventRing | null;
    private readonly messageStats: GardenStatsMessage = {
        type: 'stats',
        activeVoices: 0,
        quanta: 0,
        dspDropped: 0,
        lateEvents: 0,
    };
    private failure: string | null = null;
    private disposed = false;

    /** Load and start the engine; null when it cannot run (see the file comment). */
    static async create(
        ctx: BaseAudioContext,
        destination: AudioNode,
        options: GardenEngineOptions = {}
    ): Promise<GardenAudioEngine | null> {
        if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return null;
        let node: AudioWorkletNode | null = null;
        try {
            const wasm = await fetchDspWasm(options.wasmUrl);
            if (!wasm) {
                log.info('GardenAudio', 'candy_dsp.wasm not available; using Web Audio voices');
                return null;
            }
            await ctx.audioWorklet.addModule(options.workletUrl ?? gardenProcessorUrl);
            node = new AudioWorkletNode(ctx, GARDEN_PROCESSOR_NAME, {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });
            const ring =
                options.sharedMemory !== false && canShareMemory()
                    ? EventRing.create(RING_CAPACITY, true)
                    : null;
            const ready = waitForReady(node.port, options.readyTimeoutMs ?? 4000);
            const init: GardenInitMessage = {
                type: 'init',
                wasm,
                ring: ring ? (ring.buffer as SharedArrayBuffer) : null,
                patches: options.patches ?? [],
            };
            node.port.postMessage(init, [wasm]);
            await ready;
            node.connect(destination);
            return new GardenAudioEngine(node, ring);
        } catch (err) {
            console.warn('[GardenAudio] DSP worklet unavailable; using Web Audio voices:', err);
            try {
                node?.disconnect();
                node?.port.postMessage({ type: 'stop' } satisfies ToGardenProcessor);
            } catch {
                /* already gone */
            }
            return null;
        }
    }

    private constructor(node: AudioWorkletNode, ring: EventRing | null) {
        this.node = node;
        this.ring = ring;
        this.transport = ring ? 'shared' : 'message';
        this.writer =
            ring ??
            new EventBatch((data, count) => {
                if (this.disposed) return;
                const msg: ToGardenProcessor = { type: 'events', data, count };
                node.port.postMessage(msg, [data.buffer]);
            });
        node.port.addEventListener('message', (e: MessageEvent<FromGardenProcessor>) => {
            const msg = e.data;
            if (msg.type === 'stats') Object.assign(this.messageStats, msg);
            else if (msg.type === 'error') this.fail(msg.message);
        });
        node.onprocessorerror = () => this.fail('processorerror');
    }

    private fail(reason: string): void {
        if (this.failure) return;
        this.failure = reason;
        console.warn('[GardenAudio] DSP worklet failed:', reason);
    }

    /** False once the worklet reported an error (callers switch to their fallback). */
    get healthy(): boolean {
        return this.failure === null && !this.disposed;
    }

    /**
     * Play `note` (MIDI, fractional for detune) on `patch` at AudioContext
     * time `time`. durationSec <= 0 holds it until noteOff(tag).
     */
    noteOn(
        time: number,
        patch: number,
        note: number,
        velocity: number,
        durationSec: number,
        pan = 0,
        tag = 0
    ): boolean {
        return this.writer.push(
            EventKind.NoteOn,
            time,
            patch,
            note,
            velocity,
            durationSec,
            pan,
            tag
        );
    }

    /** Release every voice started with `tag`, at `time`. */
    noteOff(time: number, tag: number): boolean {
        return this.writer.push(EventKind.NoteOff, time, tag);
    }

    /** Dip the ducked bus by `amount` (0..1, scaled by duckDepth) at `time`. */
    duck(time: number, amount = 1): boolean {
        return this.writer.push(EventKind.Duck, time, amount);
    }

    setGlobal(name: GlobalParamName, value: number): void {
        this.writer.push(EventKind.Global, 0, GLOBAL_PARAMS.indexOf(name), value);
    }

    /** Rewrite parameters of a patch slot; notes already sounding keep theirs. */
    setPatch(patch: number, spec: PatchSpec): void {
        for (let i = 0; i < PATCH_PARAMS.length; i++) {
            const value = spec[PATCH_PARAMS[i]];
            if (value !== undefined) this.writer.push(EventKind.Patch, 0, patch, i, value);
        }
    }

    /** Release everything and drop queued notes. */
    allOff(): void {
        this.writer.push(EventKind.AllOff, 0);
    }

    stats(): GardenEngineStats {
        const ring = this.ring;
        if (ring) {
            return {
                transport: 'shared',
                activeVoices: ring.readStat('activeVoices'),
                quanta: ring.readStat('quanta'),
                droppedEvents: ring.dropped + ring.readStat('dspDropped'),
                lateEvents: ring.readStat('lateEvents'),
            };
        }
        const s = this.messageStats;
        return {
            transport: 'message',
            activeVoices: s.activeVoices,
            quanta: s.quanta,
            droppedEvents: s.dspDropped,
            lateEvents: s.lateEvents,
        };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        try {
            this.node.port.postMessage({ type: 'stop' } satisfies ToGardenProcessor);
            this.node.disconnect();
        } catch {
            /* context already closed */
        }
    }
}
