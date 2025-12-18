import { AudioSystem } from './audio-system.js';

export class BeatSync {
    constructor(audioSystem) {
        this.audio = audioSystem;
        this.lastBeatPhase = 0;
        this.beatCallbacks = [];
    }

    onBeat(cb) {
        if (typeof cb !== 'function') return;
        this.beatCallbacks.push(cb);
    }

    offBeat(cb) {
        const i = this.beatCallbacks.indexOf(cb);
        if (i >= 0) this.beatCallbacks.splice(i, 1);
    }

    update() {
        const state = this.audio.visualState || (this.audio.update && this.audio.update()) || { beatPhase: 0 };
        const beatPhase = state && state.beatPhase ? state.beatPhase : 0;

        if (beatPhase < this.lastBeatPhase && this.lastBeatPhase > 0.8) {
            for (const cb of this.beatCallbacks) {
                try { cb(state); } catch (e) { console.warn('BeatSync callback error', e); }
            }
        }

        this.lastBeatPhase = beatPhase;
    }

    getState() {
        return this.audio.visualState;
    }
}
