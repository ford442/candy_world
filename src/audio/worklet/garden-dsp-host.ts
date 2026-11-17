/**
 * One instance of the garden DSP module (candy_dsp.wasm) and the code that
 * feeds it: event records in, rendered quanta out. The AudioWorklet
 * (garden-processor.ts) wraps it; tests/dsp-render.test.mjs drives it directly
 * in Node with the same bytes.
 *
 * Nothing here allocates per quantum: the output views and the scratch record
 * are made once (the module's memory cannot grow, scripts/check-dsp-wasm.mjs).
 */
import type { DspExports } from '../../utils/native-exports.generated.ts';
import {
    DSP_MAX_PATCHES,
    DSP_QUANTUM,
    GLOBAL_PARAMS,
    PATCH_PARAMS,
    type GlobalParamName,
    type PatchSpec,
} from './dsp-abi.ts';
import { EVENT_WORDS, EventKind, type EventRing } from './event-ring.ts';

/** What instantiating candy_dsp.wasm gives: the ABI plus the reactor runtime. */
export type DspInstanceExports = DspExports & {
    memory: WebAssembly.Memory;
    /** WASI reactor initializer (static constructors); call once, first. */
    _initialize?: () => void;
};

/** Records applied per quantum at most, so a burst cannot overrun one render. */
export const MAX_EVENTS_PER_QUANTUM = 256;

export class GardenDspHost {
    readonly dsp: DspInstanceExports;
    readonly sampleRate: number;
    readonly quantum: number;
    /** Note events whose time had already passed when they arrived (they play at once). */
    lateEvents = 0;
    private outL: Float32Array;
    private outR: Float32Array;
    private readonly record = new Float64Array(EVENT_WORDS);

    /**
     * Compile and instantiate synchronously (AudioWorkletGlobalScope has no
     * fetch; the module is ~32KB, far below any synchronous-compile limit).
     * Throws if the bytes are not the DSP module or the rate is unusable.
     */
    static fromBytes(bytes: BufferSource | WebAssembly.Module, sampleRate: number): GardenDspHost {
        const module = bytes instanceof WebAssembly.Module ? bytes : new WebAssembly.Module(bytes);
        return new GardenDspHost(new WebAssembly.Instance(module, {}), sampleRate);
    }

    constructor(instance: WebAssembly.Instance, sampleRate: number) {
        const dsp = instance.exports as unknown as DspInstanceExports;
        if (typeof dsp.dsp_render !== 'function' || !(dsp.memory instanceof WebAssembly.Memory)) {
            throw new Error('garden DSP: the instance does not export the dsp_* ABI');
        }
        dsp._initialize?.();
        const quantum = dsp.dsp_init(sampleRate);
        if (quantum !== DSP_QUANTUM) {
            throw new Error(`garden DSP: dsp_init(${sampleRate}) returned ${quantum}`);
        }
        this.dsp = dsp;
        this.sampleRate = sampleRate;
        this.quantum = quantum;
        this.outL = new Float32Array(dsp.memory.buffer, dsp.dsp_output(0), quantum);
        this.outR = new Float32Array(dsp.memory.buffer, dsp.dsp_output(1), quantum);
    }

    /** Write a patch slot: every parameter the spec names (others keep their value). */
    setPatch(patch: number, spec: PatchSpec): void {
        if (!(patch >= 0 && patch < DSP_MAX_PATCHES)) return;
        for (let i = 0; i < PATCH_PARAMS.length; i++) {
            const value = spec[PATCH_PARAMS[i]];
            if (value !== undefined) this.dsp.dsp_set_patch(patch, i, value);
        }
    }

    setGlobal(name: GlobalParamName, value: number): void {
        this.dsp.dsp_set_global(GLOBAL_PARAMS.indexOf(name), value);
    }

    /**
     * Apply one record (event-ring.ts layout) at `offset` in `data`.
     * `nowFrame` is the frame about to render, for late-event accounting.
     */
    apply(data: ArrayLike<number>, offset: number, nowFrame: number): void {
        const kind = data[offset];
        const frame = data[offset + 1] * this.sampleRate;
        const dsp = this.dsp;
        switch (kind) {
            case EventKind.NoteOn:
                if (frame < nowFrame) this.lateEvents++;
                dsp.dsp_note_on(
                    frame,
                    data[offset + 2],
                    data[offset + 3],
                    data[offset + 4],
                    data[offset + 5],
                    data[offset + 6],
                    data[offset + 7]
                );
                break;
            case EventKind.NoteOff:
                dsp.dsp_note_off(frame, data[offset + 2]);
                break;
            case EventKind.Duck:
                dsp.dsp_duck(frame, data[offset + 2]);
                break;
            case EventKind.Patch:
                dsp.dsp_set_patch(data[offset + 2], data[offset + 3], data[offset + 4]);
                break;
            case EventKind.Global:
                dsp.dsp_set_global(data[offset + 2], data[offset + 3]);
                break;
            case EventKind.AllOff:
                dsp.dsp_all_off();
                break;
            default:
                break;
        }
    }

    /** Apply `count` records from a posted batch. */
    applyBatch(data: Float64Array, count: number, nowFrame: number): void {
        const n = Math.min(count, Math.floor(data.length / EVENT_WORDS));
        for (let i = 0; i < n; i++) this.apply(data, i * EVENT_WORDS, nowFrame);
    }

    /** Move up to `max` records from the ring into the module. Returns how many. */
    drain(ring: EventRing, nowFrame: number, max = MAX_EVENTS_PER_QUANTUM): number {
        let n = 0;
        while (n < max && ring.pop(this.record)) {
            this.apply(this.record, 0, nowFrame);
            n++;
        }
        return n;
    }

    /**
     * Render one quantum starting at `frame` into `left` / `right` at `offset`.
     * Returns the voices still sounding.
     */
    render(frame: number, left: Float32Array, right: Float32Array | null, offset = 0): number {
        const active = this.dsp.dsp_render(frame);
        // A view over a detached buffer reads as empty; the memory never grows, but be sure.
        if (this.outL.length === 0) {
            this.outL = new Float32Array(
                this.dsp.memory.buffer,
                this.dsp.dsp_output(0),
                this.quantum
            );
            this.outR = new Float32Array(
                this.dsp.memory.buffer,
                this.dsp.dsp_output(1),
                this.quantum
            );
        }
        left.set(this.outL, offset);
        if (right) right.set(this.outR, offset);
        return active;
    }

    get droppedEvents(): number {
        return this.dsp.dsp_dropped_events();
    }

    get pendingEvents(): number {
        return this.dsp.dsp_pending_events();
    }
}
