/**
 * The garden AudioWorkletProcessor ('candy-garden'). Loaded by
 * GardenAudioEngine through audioWorklet.addModule; it is bundled on its own
 * (Vite `?worker&url` in garden-engine.ts), so it must not import anything
 * that touches the DOM or the app.
 *
 * Lifecycle: an `init` message brings the candy_dsp.wasm bytes, the event
 * ring (or null) and the patch table; the processor answers `ready` or
 * `error`. Until then it outputs silence. Each process() call drains the ring
 * into the module, renders the quantum, and publishes stats.
 */
import { DSP_MAX_VOICES } from './dsp-abi.ts';
import { EventRing } from './event-ring.ts';
import { GardenDspHost } from './garden-dsp-host.ts';
import {
    GARDEN_PROCESSOR_NAME,
    type FromGardenProcessor,
    type ToGardenProcessor,
} from './garden-protocol.ts';

/** The AudioWorkletGlobalScope surface this file uses (TS's DOM lib has none of it). */
interface AudioWorkletScope {
    readonly sampleRate: number;
    readonly currentFrame: number;
    readonly AudioWorkletProcessor: new () => { readonly port: MessagePort };
    registerProcessor(name: string, ctor: new () => object): void;
}

const scope = globalThis as unknown as AudioWorkletScope;

/** Without a ring, stats go out as messages this often (quanta, ~0.25 s at 48 kHz). */
const STATS_EVERY_QUANTA = 96;

class GardenProcessor extends scope.AudioWorkletProcessor {
    private host: GardenDspHost | null = null;
    private ring: EventRing | null = null;
    private stopped = false;
    private quanta = 0;

    constructor() {
        super();
        this.port.onmessage = (e: MessageEvent<ToGardenProcessor>) => this.onMessage(e.data);
    }

    private reply(msg: FromGardenProcessor): void {
        this.port.postMessage(msg);
    }

    private onMessage(msg: ToGardenProcessor): void {
        switch (msg.type) {
            case 'init':
                try {
                    const host = GardenDspHost.fromBytes(msg.wasm, scope.sampleRate);
                    for (const [id, spec] of msg.patches) host.setPatch(id, spec);
                    this.ring = msg.ring ? new EventRing(msg.ring) : null;
                    this.host = host;
                    this.reply({
                        type: 'ready',
                        quantum: host.quantum,
                        maxVoices: DSP_MAX_VOICES,
                        sampleRate: scope.sampleRate,
                    });
                } catch (err) {
                    this.reply({ type: 'error', message: String(err) });
                }
                break;
            case 'events':
                this.host?.applyBatch(msg.data, msg.count, scope.currentFrame);
                break;
            case 'stop':
                this.stopped = true;
                this.host = null;
                this.ring = null;
                break;
            default:
                break;
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (this.stopped) return false;
        const host = this.host;
        const out = outputs[0];
        if (!host || !out || out.length === 0) return true; // outputs start zeroed: silence
        const left = out[0];
        const right = out.length > 1 ? out[1] : null;
        const frame = scope.currentFrame;
        let active = 0;
        try {
            if (this.ring) host.drain(this.ring, frame);
            // The quantum is 128 today; a larger render size is a whole number of DSP quanta.
            for (let off = 0; off + host.quantum <= left.length; off += host.quantum) {
                active = host.render(frame + off, left, right, off);
            }
        } catch (err) {
            this.host = null;
            this.reply({ type: 'error', message: String(err) });
            return true;
        }
        this.quanta++;
        const ring = this.ring;
        if (ring) {
            ring.writeStat('activeVoices', active);
            ring.writeStat('quanta', this.quanta);
            ring.writeStat('dspDropped', host.droppedEvents);
            ring.writeStat('lateEvents', host.lateEvents);
        } else if (this.quanta % STATS_EVERY_QUANTA === 0) {
            this.reply({
                type: 'stats',
                activeVoices: active,
                quanta: this.quanta,
                dspDropped: host.droppedEvents,
                lateEvents: host.lateEvents,
            });
        }
        return true;
    }
}

scope.registerProcessor(GARDEN_PROCESSOR_NAME, GardenProcessor);
