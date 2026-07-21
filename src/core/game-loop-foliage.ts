// src/core/game-loop-foliage.ts
// Tick phase: foliage materials, batcher LOD, aerial perspective, contact AO.
// Zero-alloc: no new Vector3/Color inside updateFoliagePhase.

import * as THREE from 'three';
import { updateFoliageMaterials } from '../foliage/animation.ts';
import { updateAerialPerspectiveUniforms } from '../foliage/aerial-perspective.ts';
import { updateBaseContactAOUniforms } from '../foliage/material-core.ts';
import { updateFoliageBatcherLOD } from '../systems/batcher-lod.ts';
import { cameraRef, sceneRef } from './game-loop-core.ts';

/**
 * Foliage / batcher LOD phase — runs after visuals uniforms settle, before particles.
 * Preserves prior frame order (was previously inlined at the end of updateVisualsPhase).
 */
export function updateFoliagePhase(
    delta: number,
    audioState: any,
    isNightNow: boolean,
    weatherStateStr: string,
    weatherIntensity: number,
    dayNightBias: number,
): void {
    updateFoliageMaterials(audioState, isNightNow, weatherStateStr, weatherIntensity);

    if (cameraRef) {
        updateFoliageBatcherLOD(cameraRef, delta);
        if (sceneRef && sceneRef.fog && 'color' in sceneRef.fog) {
            updateAerialPerspectiveUniforms(
                (sceneRef.fog as THREE.Fog | THREE.FogExp2).color as THREE.Color,
                dayNightBias,
                (sceneRef.fog as THREE.Fog).near || 0,
                (sceneRef.fog as THREE.Fog).far || 1000,
            );
        }
    }
    updateBaseContactAOUniforms(dayNightBias);
}
