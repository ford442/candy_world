// src/core/game-loop-streaming.ts
// Per-frame hook for ChunkStreamer (#1546 / #1548). Thin wrapper so game-loop.ts
// doesn't need to know whether a streamer is active (it's null on the "explore"
// boot path, and in CORE mode).
import type * as THREE from 'three';
import { getActiveChunkStreamer } from '../world/chunk-streamer.ts';

/** Zero-allocation when no streamer is active or the player hasn't crossed a chunk boundary. */
export function updateStreamingPhase(playerPosition: THREE.Vector3): void {
    const streamer = getActiveChunkStreamer();
    if (!streamer) return;
    streamer.update(playerPosition);
}
