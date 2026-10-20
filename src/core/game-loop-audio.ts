import type * as THREE from 'three';
import type { VisualState } from '../audio/audio-system-core.ts';
import { getBiomeAtPosition } from '../systems/net/biome-at-position.ts';
import { getSeasonState } from '../systems/season-controller.ts';
import { blendSeasonMusicModifier, createSeasonMusicModifier } from '../systems/season-core.ts';
import { profiler } from '../utils/profiler.ts';
import { CONFIG } from './config.ts';
import {
    audioSystemRef,
    baseFOV,
    beatFlashIntensity,
    beatSyncRef,
    cameraShake,
    cameraZoomPulse,
    lastBeatPhase,
    setAudioState,
    setBeatFlashIntensity,
    setCameraShakeCore,
    setCameraZoomPulse,
    setLastBeatPhase,
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

/** Kick-on-downbeat flash + FOV zoom pulse, and their per-frame decay. */
export function updateBeatPulse(
    audioState: VisualState | null,
    camera: THREE.PerspectiveCamera
): void {
    const currentBeatPhase = audioState?.beatPhase || 0;
    if (currentBeatPhase < lastBeatPhase && lastBeatPhase > 0.8) {
        const kickTrigger = audioState?.kickTrigger || 0;
        if (kickTrigger > 0.3) {
            setBeatFlashIntensity(0.5 + kickTrigger * 0.5);
            setCameraZoomPulse(2 + kickTrigger * 3);
        }
    }
    setLastBeatPhase(currentBeatPhase);

    let bfi = beatFlashIntensity;
    if (bfi > 0) {
        bfi *= 0.9;
        if (bfi < 0.01) bfi = 0;
        setBeatFlashIntensity(bfi);
    }

    let czp = cameraZoomPulse;
    if (czp > 0) {
        camera.fov = baseFOV - czp;
        camera.updateProjectionMatrix();
        czp *= 0.85;
        if (czp < 0.1) {
            czp = 0;
            camera.fov = baseFOV;
            camera.updateProjectionMatrix();
        }
        setCameraZoomPulse(czp);
    }

    let cs = cameraShake;
    if (cs > 0) {
        cs *= 0.9;
        if (cs < 0.001) cs = 0;
        setCameraShakeCore(cs);
    }
}
