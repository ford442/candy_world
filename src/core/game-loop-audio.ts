import type * as THREE from 'three';
import { getBiomeAtPosition } from '../systems/net/biome-at-position.ts';
import { getSeasonState } from '../systems/season-controller.ts';
import { blendSeasonMusicModifier, createSeasonMusicModifier } from '../systems/season-core.ts';
import { profiler } from '../utils/profiler.ts';
import { CONFIG } from './config.ts';
import {
    audioSystemRef,
    beatSyncRef,
    setAudioState,
    setBeatFlashIntensity,
    setCameraZoomPulse,
} from './game-loop-core.ts';

let _genAudioFrameCount = 0;
const _seasonMusic = createSeasonMusicModifier();

export function updateGenerativeAudioContext(playerPos: THREE.Vector3, dayNightBias: number): void {
    if (!audioSystemRef || !audioSystemRef.isGenerativeActive()) return;

    _genAudioFrameCount++;
    if (_genAudioFrameCount % 10 === 0) {
        const biomeId = getBiomeAtPosition(playerPos.x, playerPos.z);
        audioSystemRef.setGenerativeSeason(
            blendSeasonMusicModifier(getSeasonState(), CONFIG.season.music, _seasonMusic)
        );
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
