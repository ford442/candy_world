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

    constructor(ctx: AudioContext, masterGain: GainNode, filterCutoffBase = 2400) {
        this.ctx = ctx;
        this.masterGain = masterGain;
        this.filterCutoffBase = filterCutoffBase;
    }

    setBrightness(brightness: number): void {
        this.filterCutoffBase = 800 + brightness * 7200;
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
