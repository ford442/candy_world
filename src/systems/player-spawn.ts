/**
 * First-person spawn placement.
 *
 * World origin sits inside Melody Lake's carved basin (and the Sugar Caves
 * descent AABB). Spawning at (0,0) puts the camera over water / lake floor
 * so the player appears to fall through the terrain. Place on the configured
 * shore coordinates and snap Y to the authoritative ground query.
 */

import type * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { getEyeTargetY, isInLakeBasin } from './ground-system.ts';
import { player } from './physics/physics-types.ts';

export function getConfiguredSpawnXZ(): { x: number; z: number } {
    return { x: CONFIG.player.spawnX, z: CONFIG.player.spawnZ };
}

/** True when (x, z) would drop the player into the Melody Lake basin. */
export function isUnsafeSpawnXZ(x: number, z: number): boolean {
    return isInLakeBasin(x, z);
}

/**
 * Place the player and camera on solid ground at (x, z).
 * Clears vertical velocity and marks grounded so the first physics tick
 * does not apply a spawn-fall.
 */
export function placePlayerOnGround(
    camera: THREE.Camera,
    x: number = CONFIG.player.spawnX,
    z: number = CONFIG.player.spawnZ
): number {
    const spawnX = Number.isFinite(x) ? x : CONFIG.player.spawnX;
    const spawnZ = Number.isFinite(z) ? z : CONFIG.player.spawnZ;
    const eyeY = getEyeTargetY(spawnX, spawnZ);
    const y = Number.isFinite(eyeY) ? eyeY : CONFIG.player.spawnEyeHeightY;

    player.position.set(spawnX, y, spawnZ);
    player.velocity.set(0, 0, 0);
    player.isGrounded = true;
    camera.position.set(spawnX, y, spawnZ);

    return y;
}

export function placePlayerAtConfiguredSpawn(camera: THREE.Camera): number {
    const { x, z } = getConfiguredSpawnXZ();
    if (isUnsafeSpawnXZ(x, z)) {
        console.warn(
            `[Spawn] Configured spawn (${x}, ${z}) is inside Melody Lake — using shore fallback (0, -36)`
        );
        return placePlayerOnGround(camera, 0, -36);
    }
    return placePlayerOnGround(camera, x, z);
}
