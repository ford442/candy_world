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
import { getEyeTargetY, getGroundHeight, isInLakeBasin } from './ground-system.ts';
import { player, resetCharacterControllerState } from './physics/physics-types.ts';

/** Number of physics frames gravity is frozen after a spawn/teleport. */
const SPAWN_PROTECT_FRAMES = 8;

/** Probe offsets (metres) used for multi-point terrain sampling at spawn. */
const SPAWN_PROBES: readonly [number, number][] = [
    [0, 0],
    [0.5, 0], [-0.5, 0],
    [0, 0.5], [0, -0.5],
];

export function getConfiguredSpawnXZ(): { x: number; z: number } {
    return { x: CONFIG.player.spawnX, z: CONFIG.player.spawnZ };
}

/** True when (x, z) would drop the player into the Melody Lake basin. */
export function isUnsafeSpawnXZ(x: number, z: number): boolean {
    return isInLakeBasin(x, z);
}

/**
 * Sample terrain height at (x, z) using multiple nearby probe points and
 * return the maximum eye-level Y.  This guards against the single-sample
 * race between WASM readiness and the first physics frame.
 */
function sampleSpawnEyeY(x: number, z: number): number {
    let maxGroundY = -Infinity;
    for (const [dx, dz] of SPAWN_PROBES) {
        const h = getGroundHeight(x + dx, z + dz);
        if (Number.isFinite(h) && h > maxGroundY) maxGroundY = h;
    }
    if (!Number.isFinite(maxGroundY)) maxGroundY = 0;
    return maxGroundY + CONFIG.player.eyeHeight;
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

    // Multi-point probe height — take the maximum to avoid sub-terrain placement.
    const probedEyeY = sampleSpawnEyeY(spawnX, spawnZ);
    // Also use the single authoritative query as a cross-check.
    const authEyeY = getEyeTargetY(spawnX, spawnZ);
    // Prefer the larger of the two; never go below the safe fallback height.
    const safeMinY = CONFIG.player.spawnEyeHeightY;
    const y = Math.max(
        Number.isFinite(probedEyeY) ? probedEyeY : safeMinY,
        Number.isFinite(authEyeY) ? authEyeY : safeMinY,
        safeMinY
    );

    player.position.set(spawnX, y, spawnZ);
    player.velocity.set(0, 0, 0);
    player.isGrounded = true;
    resetCharacterControllerState();
    // Freeze gravity so WASM terrain queries settle before physics pulls the
    // player down. The last protected frame issues a re-snap.
    player.spawnProtectFrames = SPAWN_PROTECT_FRAMES;
    camera.position.set(spawnX, y, spawnZ);

    return y;
}

export function placePlayerAtConfiguredSpawn(camera: THREE.Camera): number {
    const { x, z } = getConfiguredSpawnXZ();
    if (isUnsafeSpawnXZ(x, z)) {
        console.warn(
            `[Spawn] Configured spawn (${x}, ${z}) is inside Melody Lake — using shore fallback (8, -36)`
        );
        return placePlayerOnGround(camera, 8, -36);
    }
    return placePlayerOnGround(camera, x, z);
}
