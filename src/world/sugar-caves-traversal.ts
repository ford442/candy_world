/**
 * Sugar Caves traversal — lake descent trigger + walkable underground floor (#1492).
 */

import * as THREE from 'three';
import { FEATURE_FLAGS } from '../core/config.ts';
import { awakenedPersistence } from '../systems/awakened-persistence-api.ts';
import { registerPlatform } from '../systems/ground-system.ts';
import { SUGAR_CAVES } from './generation-utils.ts';
import { isSugarCavesUnlocked, tryUnlockSugarCavesFromProgress } from './part-ii-unlock.ts';

const LAKE_DESCENT_X = 18;
const LAKE_DESCENT_Z = 22;
const LAKE_DESCENT_RADIUS = 6;
const CAVE_FLOOR_Y = -12;

let _installed = false;

export function installSugarCavesTraversal(): void {
    if (_installed) return;
    _installed = true;

    const steps = 8;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = THREE.MathUtils.lerp(LAKE_DESCENT_X, SUGAR_CAVES.startX, t);
        const z = THREE.MathUtils.lerp(LAKE_DESCENT_Z, SUGAR_CAVES.startZ, t);
        const y = THREE.MathUtils.lerp(0.5, CAVE_FLOOR_Y + 0.2, t);
        registerPlatform({
            id: `sugar_caves:descent:${i}`,
            minX: x - 2.5,
            maxX: x + 2.5,
            minZ: z - 2.5,
            maxZ: z + 2.5,
            minY: y - 0.4,
            maxY: y,
            priority: 4,
        });
    }

    const minX = Math.min(SUGAR_CAVES.startX, SUGAR_CAVES.endX) - 8;
    const maxX = Math.max(SUGAR_CAVES.startX, SUGAR_CAVES.endX) + 8;
    const minZ = Math.min(SUGAR_CAVES.startZ, SUGAR_CAVES.endZ) - 8;
    const maxZ = Math.max(SUGAR_CAVES.startZ, SUGAR_CAVES.endZ) + 8;
    registerPlatform({
        id: 'sugar_caves:floor',
        minX,
        maxX,
        minZ,
        maxZ,
        minY: CAVE_FLOOR_Y - 0.5,
        maxY: CAVE_FLOOR_Y,
        priority: 5,
    });
}

export function updateSugarCavesTraversal(playerX: number, playerY: number, playerZ: number): void {
    if (!_installed) return;

    const dx = playerX - LAKE_DESCENT_X;
    const dz = playerZ - LAKE_DESCENT_Z;
    const nearLake = dx * dx + dz * dz <= LAKE_DESCENT_RADIUS * LAKE_DESCENT_RADIUS;

    if (nearLake && playerY < 2) {
        if (FEATURE_FLAGS.awakenedPersistence) {
            const count = awakenedPersistence.serialize().length;
            tryUnlockSugarCavesFromProgress(count);
        } else if (!isSugarCavesUnlocked()) {
            unlockSugarCavesFromDiscovery();
        }
    }
}

function unlockSugarCavesFromDiscovery(): void {
    tryUnlockSugarCavesFromProgress(AWAKENED_THRESHOLD);
}

const AWAKENED_THRESHOLD = 3;

export function getSugarCavesViewpoint(): {
    cameraPosition: { x: number; y: number; z: number };
    cameraTarget: { x: number; y: number; z: number };
} {
    const midX = (SUGAR_CAVES.startX + SUGAR_CAVES.endX) * 0.5;
    const midZ = (SUGAR_CAVES.startZ + SUGAR_CAVES.endZ) * 0.5;
    return {
        cameraPosition: { x: midX + 12, y: CAVE_FLOOR_Y + 6, z: midZ + 10 },
        cameraTarget: { x: midX, y: CAVE_FLOOR_Y + 2, z: midZ },
    };
}

export const SUGAR_CAVES_TRAVERSAL = {
    lakeDescentX: LAKE_DESCENT_X,
    lakeDescentZ: LAKE_DESCENT_Z,
    caveFloorY: CAVE_FLOOR_Y,
};
