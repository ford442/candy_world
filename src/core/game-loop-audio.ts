import { audioSystemRef, beatSyncRef, setAudioState, setBeatFlashIntensity, setCameraZoomPulse } from './game-loop-core.ts';
import { profiler } from '../utils/profiler.ts';

export function updateAudioPhase(rawDelta: number) {
    let audioState = null;
    if (audioSystemRef) {
        audioState = profiler.measure('Audio', () => audioSystemRef!.update());
    }

    if (beatSyncRef) {
        profiler.measure('BeatSync', () => beatSyncRef!.update());
    }

    setAudioState(audioState);
    return audioState;
}
