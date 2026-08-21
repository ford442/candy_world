// src/core/game-loop-streaming.ts
// Per-frame hook for ChunkStreamer (#1546 / #1548). Thin wrapper so game-loop.ts
// doesn't need to know whether a streamer is active (it's null on the "explore"
// boot path, and in CORE mode).
import type * as THREE from 'three';
import { getActiveChunkStreamer } from '../world/chunk-streamer.ts';
import { clampToHalfExtent } from '../world/world-extent.ts';
import { sceneRef } from './game-loop-core.ts';

type TerrainMod = typeof import('../world/terrain-mesh.ts');
type DecorMod = typeof import('../world/decorator-streamer.ts');

let terrainMod: TerrainMod | null = null;
let decorMod: DecorMod | null = null;

function ensureStreamingMods(): void {
    if (terrainMod && decorMod) return;
    void import('../world/terrain-mesh.ts').then((m) => {
        terrainMod = m;
    });
    void import('../world/decorator-streamer.ts').then((m) => {
        decorMod = m;
    });
}

/** Zero-allocation when no streamer is active or the player hasn't crossed a chunk boundary. */
export function updateStreamingPhase(playerPosition: THREE.Vector3): void {
    ensureStreamingMods();
    const streamer = getActiveChunkStreamer();
    if (streamer) streamer.update(playerPosition);

    decorMod?.updateDecoratorStreamer(playerPosition.x, playerPosition.z);

    const scene = sceneRef;
    if (terrainMod && scene) {
        terrainMod.maybeExpandTerrain(playerPosition.x, playerPosition.z, scene);
        const half = terrainMod.getActiveTerrainHalf();
        if (half > 0) {
            const next = clampToHalfExtent(playerPosition.x, playerPosition.z, half);
            if (next.clamped) {
                playerPosition.x = next.x;
                playerPosition.z = next.z;
            }
        }
    }
}
