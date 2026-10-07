import { noteToFreq } from '../audio-system-core.ts';
import { CHANNEL_VOICES } from './sequencer.ts';

/**
 * Lightweight Web Audio voice: oscillator + optional noise + AD envelope.
 * Scheduled via AudioContext — no per-frame allocations.
 */
export class SynthVoice {
    private ctx: AudioContext;
    private masterGain: GainNode;
    private filterCutoffBase: number;
    /** Send into a shared convolver; built the first time a season asks for reverb. */
    private reverbSend: GainNode | null = null;
    private reverbWet = 0;

    constructor(ctx: AudioContext, masterGain: GainNode, filterCutoffBase = 2400) {
        this.ctx = ctx;
        this.masterGain = masterGain;
        this.filterCutoffBase = filterCutoffBase;
    }

    setBrightness(brightness: number): void {
        this.filterCutoffBase = 800 + brightness * 7200;
    }

    /** Reverb send level 0..1 (winter adds space). 0 costs nothing: no convolver is built. */
    setReverbWet(wet: number): void {
        const w = Math.max(0, Math.min(1, wet));
        if (w > 0.001 && !this.reverbSend) this.buildReverb();
        if (this.reverbSend && w !== this.reverbWet) {
            this.reverbSend.gain.setTargetAtTime(w, this.ctx.currentTime, 0.5);
        }
        this.reverbWet = w;
    }

    /** One stereo convolver with a seeded noise-burst impulse response, built once. */
    private buildReverb(): void {
        const seconds = 2.4;
        const length = Math.floor(this.ctx.sampleRate * seconds);
        const ir = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
        let seed = 0x5eed;
        for (let c = 0; c < 2; c++) {
            const data = ir.getChannelData(c);
            for (let i = 0; i < length; i++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                const decay = 1 - i / length;
                data[i] = (seed / 2147483648 - 1) * decay * decay * decay;
            }
        }
        const convolver = this.ctx.createConvolver();
        convolver.buffer = ir;
        const send = this.ctx.createGain();
        send.gain.value = 0;
        send.connect(convolver);
        convolver.connect(this.masterGain);
        this.reverbSend = send;
    }

    playNote(
        note: string,
        channel: number,
        velocity: number,
        when: number,
        durationSec: number,
        pan = 0
    ): void {
        const voice = CHANNEL_VOICES[channel] ?? CHANNEL_VOICES[0];
        const t = when;
        const vol = (velocity / 127) * 0.35;

        if (voice.pattern === 'kick') {
            this.playKick(t, vol * 1.2, durationSec);
            return;
        }
        if (voice.pattern === 'hat') {
            this.playHat(t, vol * 0.5, durationSec);
            return;
        }

        const freq = noteToFreq(note);
        if (freq <= 0) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(this.filterCutoffBase, t);
        filter.Q.value = 0.7;

        osc.type = voice.wave;
        osc.frequency.setValueAtTime(freq, t);

        const attack = 0.008;
        const release = Math.max(0.04, durationSec * 0.6);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(vol, t + attack);
        gain.gain.setValueAtTime(vol * 0.7, t + durationSec * 0.4);
        gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec + release);

        osc.connect(filter);
        filter.connect(gain);

        if (Math.abs(pan) > 0.01) {
            const panner = this.ctx.createStereoPanner();
            panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t);
            gain.connect(panner);
            panner.connect(this.masterGain);
        } else {
            gain.connect(this.masterGain);
        }
        if (this.reverbSend && this.reverbWet > 0.001) gain.connect(this.reverbSend);

        osc.start(t);
        osc.stop(t + durationSec + release + 0.05);
    }

    private playKick(t: number, vol: number, _dur: number): void {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(vol, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.3);
    }

    private playHat(t: number, vol: number, dur: number): void {
        const bufferSize = this.ctx.sampleRate * 0.05;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 6000;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol * 0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        src.start(t);
        src.stop(t + dur + 0.02);
    }
}
