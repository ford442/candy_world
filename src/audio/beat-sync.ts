// BeatSync - TypeScript wrapper to expose beat events from AudioSystem

import { AudioSystem } from './audio-system.ts';

export type BeatCallback = (state: any) => void;

export class BeatSync {
    audio: AudioSystem;
    lastBeatPhase: number;
    beatCallbacks: BeatCallback[];

    constructor(audioSystem: AudioSystem) {
        this.audio = audioSystem;
        this.lastBeatPhase = 0;
        this.beatCallbacks = [];
    }

    onBeat(cb: BeatCallback) {
        if (typeof cb !== 'function') return;
        this.beatCallbacks.push(cb);
    }

    offBeat(cb: BeatCallback) {
        const i = this.beatCallbacks.indexOf(cb);
        if (i >= 0) this.beatCallbacks.splice(i, 1);
    }

    update() {
        const state = this.audio.visualState || this.audio.update?.() || { beatPhase: 0 };
        const beatPhase = state?.beatPhase || 0;

        // Simple detection: detect wrap from near 1 to near 0
        if (beatPhase < this.lastBeatPhase && this.lastBeatPhase > 0.8) {
            // Callbacks
            for (const cb of this.beatCallbacks) {
                try {
                    cb(state);
                } catch (e) {
                    console.warn('BeatSync callback error', e);
                }
            }
        }

        this.lastBeatPhase = beatPhase;
    }

    getState() {
        return this.audio.visualState;
    }
}
