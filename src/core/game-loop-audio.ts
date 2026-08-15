import { profiler } from '../utils/profiler.ts';
import type * as THREE from 'three';
import { getBiomeAtPosition } from '../systems/net/biome-at-position.ts';
import { audioSystemRef, beatSyncRef, setAudioState, setBeatFlashIntensity, setCameraZoomPulse } from './game-loop-core.ts';

let _genAudioFrameCount = 0;

export function updateGenerativeAudioContext(playerPos: THREE.Vector3, dayNightBias: number): void {
    if (!audioSystemRef || !audioSystemRef.isGenerativeActive()) return;

    _genAudioFrameCount++;
    if (_genAudioFrameCount % 10 === 0) {
        const biomeId = getBiomeAtPosition(playerPos.x, playerPos.z);
        audioSystemRef.setGenerativeBiome(biomeId);
    }

    audioSystemRef.setGenerativeDayNight(dayNightBias);
}

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
