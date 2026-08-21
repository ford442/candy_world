// src/core/game-loop-streaming.ts
// Per-frame hook for ChunkStreamer (#1546 / #1548). Thin wrapper so game-loop.ts
// doesn't need to know whether a streamer is active (it's null on the "explore"
// boot path, and in CORE mode).
import type * as THREE from 'three';
import { getActiveChunkStreamer } from '../world/chunk-streamer.ts';
import { updateDecoratorStreamer } from '../world/decorator-streamer.ts';
import { getActiveTerrainHalf, maybeExpandTerrain } from '../world/terrain-mesh.ts';
import { clampToHalfExtent } from '../world/world-extent.ts';
import { sceneRef } from './game-loop-core.ts';

/** Zero-allocation when no streamer is active or the player hasn't crossed a chunk boundary. */
export function updateStreamingPhase(playerPosition: THREE.Vector3): void {
    const streamer = getActiveChunkStreamer();
    if (streamer) streamer.update(playerPosition);

    updateDecoratorStreamer(playerPosition.x, playerPosition.z);

    const scene = sceneRef;
    if (scene) {
        maybeExpandTerrain(playerPosition.x, playerPosition.z, scene);
    }

    // Soft-clamp to the loaded visual mesh so the player cannot walk into a
    // hole while Explore-sized terrain is still generating.
    const half = getActiveTerrainHalf();
    if (half > 0) {
        const next = clampToHalfExtent(playerPosition.x, playerPosition.z, half);
        if (next.clamped) {
            playerPosition.x = next.x;
            playerPosition.z = next.z;
        }
    }
}
