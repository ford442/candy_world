/**
 * @file src/audio/garden/index.ts
 * @brief Entry of the lazy `garden` chunk: the garden sequencer, wired to the real world and audio
 * system (Music Garden slice B, docs/MUSIC_GARDEN.md).
 *
 * Loaded by `audio/garden-lazy.ts` once a chime tulip or drum puffball exists; the frame system
 * `garden-sequencer` (`core/game-loop-systems.ts`) calls `updateGarden` every frame through that
 * stub. The musical core is `sequencer.ts`, timing is `clock.ts` / `player.ts`, the modes are
 * `conductor.ts`; this file only reads the world (live flora, the camera, the biome and season)
 * and animates the plants when their note is heard.
 */

import type * as THREE from 'three';
import { CONFIG } from '../../core/config.ts';
import { audioSystemRef, beatSyncRef, cameraRef } from '../../core/game-loop-core.ts';
import { getSeasonState } from '../../systems/environment/season-controller.ts';
import {
    blendSeasonMusicModifier,
    createSeasonMusicModifier,
} from '../../systems/environment/season-core.ts';
import { getBiomeAtPosition } from '../../systems/net/biome-at-position.ts';
import { CHIME_TULIP_TYPE, DRUM_PUFFBALL_TYPE } from '../../world/document/garden-flora.ts';
import { animatedFoliage } from '../../world/state.ts';
import { getBiomeProfile } from '../generative/biome-profiles.ts';
import { GardenConductor, type GardenFrame, type GardenPlantView } from './conductor.ts';
import { GardenPulses } from './pulses.ts';

const _season = createSeasonMusicModifier();
const _pulses = new GardenPulses();
const _right = { x: 1, z: 0 };

function isLiveGardenPlant(obj: THREE.Object3D): boolean {
    return obj.userData.isGardenFlora === true && obj.parent !== null;
}

export function* livePlants(): Iterable<GardenPlantView> {
    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i] as THREE.Object3D;
        if (!isLiveGardenPlant(obj)) continue;
        const ud = obj.userData as Record<string, unknown>;
        const id = ud.mapEntityId;
        const type = ud.gardenKind;
        if (typeof id !== 'string') continue;
        if (type !== CHIME_TULIP_TYPE && type !== DRUM_PUFFBALL_TYPE) continue;
        yield {
            id,
            type,
            x: obj.position.x,
            z: obj.position.z,
            params: ud.gardenParams,
            object: obj,
        };
    }
}

export const conductor = new GardenConductor({
    audio: () => audioSystemRef,
    beats: () => beatSyncRef,
    plants: livePlants,
    biomeKey: (x, z) => getBiomeProfile(getBiomeAtPosition(x, z)),
    seasonTempoScale: () =>
        blendSeasonMusicModifier(getSeasonState(), CONFIG.season.music, _season).tempoScale,
    onHeard: (plants) => {
        for (const p of plants) _pulses.hit(p.object as THREE.Object3D, p.velocity);
    },
});

/** The camera's right-hand direction on the ground, unit length (east if there is no camera). */
function cameraRight(): { x: number; z: number } {
    const cam = cameraRef;
    if (!cam) return _right;
    const e = cam.matrixWorld.elements;
    const len = Math.hypot(e[0], e[2]);
    if (len < 1e-4) return _right;
    _right.x = e[0] / len;
    _right.z = e[2] / len;
    return _right;
}

const _frame: GardenFrame = { dt: 0, x: 0, z: 0, rightX: 1, rightZ: 0 };

/** One frame of the `garden-sequencer` system. */
export function updateGarden(dt: number, playerX: number, playerZ: number): void {
    const right = cameraRight();
    _frame.dt = dt;
    _frame.x = playerX;
    _frame.z = playerZ;
    _frame.rightX = right.x;
    _frame.rightZ = right.z;
    conductor.update(_frame);
    _pulses.settle(dt);
}

if (typeof window !== 'undefined') {
    (window as unknown as { __gardenStats?: () => unknown }).__gardenStats = () =>
        conductor.stats();
}

export function disposeGarden(): void {
    conductor.dispose();
    _pulses.clear();
}
