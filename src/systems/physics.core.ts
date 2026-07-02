// src/systems/physics.core.ts
// Core physics calculation functions (Phase 1: JS -> TS Migration)
// Following PERFORMANCE_MIGRATION_STRATEGY.md - Extract only hot functions (~15%)

import * as THREE from 'three';
import {
    isInLakeBasin as _isInLakeBasin,
    isOnLakeIsland as _isOnLakeIsland,
    getGroundHeight as getAuthoritativeGroundHeight
} from './ground-system.ts';

// Re-export lake helpers so existing call sites keep working without edits.
export const isInLakeBasin = _isInLakeBasin;
export const isOnLakeIsland = _isOnLakeIsland;

// --- Type Definitions ---

export interface PlayerState {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    speed: number;
    sprintSpeed: number;
    sneakSpeed: number;
    gravity: number;
    energy: number;
    maxEnergy: number;
    currentState: string;
    isGrounded: boolean;
    isUnderwater: boolean;
}

export interface KeyStates {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    jump: boolean;
    sprint: boolean;
    sneak: boolean;
    dash: boolean;
    dodgeRoll: boolean;
    dance: boolean;
    action: boolean;
    phase: boolean;
    clap: boolean;
}

export interface MovementInput {
    moveVec: THREE.Vector3;
    moveSpeed: number;
}

export interface LakeBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface LakeIslandConfig {
    centerX: number;
    centerZ: number;
    radius: number;
    peakHeight: number;
    falloffRadius: number;
    enabled: boolean;
}

// --- Scratch vectors (reused to prevent GC)
const _scratchCamDir = new THREE.Vector3();
const _scratchCamRight = new THREE.Vector3();
const _scratchMoveVec = new THREE.Vector3();
const _scratchUp = new THREE.Vector3(0, 1, 0);
const _scratchGatePos = new THREE.Vector3(); // For cave gate calculations

// ⚡ OPTIMIZATION: Reusable result object to avoid allocation
const _movementInputResult: MovementInput = {
    moveVec: new THREE.Vector3(),
    moveSpeed: 0
};

// --- Core Physics Functions ---

/**
 * Calculate movement input vector based on camera orientation and key states
 * Hot path function - called every frame
 */
export function calculateMovementInput(
    camera: THREE.Camera,
    keyStates: KeyStates,
    player: PlayerState
): MovementInput {
    const moveSpeed = keyStates.sprint 
        ? player.sprintSpeed 
        : (keyStates.sneak ? player.sneakSpeed : player.speed);

    // Get Camera Orientation (Projected to XZ plane)
    const camDir = _scratchCamDir;
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() > 0.001) {
        camDir.normalize();
    } else {
        camDir.set(0, 0, -1);
    }

    const camRight = _scratchCamRight;
    camRight.crossVectors(camDir, _scratchUp);

    // Construct World-Space Move Vector based on Inputs
    const moveVec = _scratchMoveVec.set(0, 0, 0);
    if (keyStates.forward) moveVec.add(camDir);
    if (keyStates.backward) moveVec.sub(camDir);
    if (keyStates.right) moveVec.add(camRight);
    if (keyStates.left) moveVec.sub(camRight);

    if (moveVec.lengthSq() > 1.0) {
        moveVec.normalize();
    }

    // Reuse result object
    _movementInputResult.moveVec.copy(moveVec);
    _movementInputResult.moveSpeed = moveSpeed;

    return _movementInputResult;
}


/**
 * Apply damping to velocity
 * Common physics helper used in multiple state updates
 */
export function applyDamping(
    velocity: THREE.Vector3,
    damping: number,
    delta: number
): void {
    const factor = Math.max(0, 1.0 - damping * delta);
    velocity.multiplyScalar(factor);
}

/**
 * Calculate water level at a position
 * Used for swimming state transitions
 */
export function calculateWaterLevel(
    playerPos: THREE.Vector3,
    foliageCaves: any[]
): number {
    let waterLevel = -100;

    // Check cave water gates (using scratch vector to avoid GC)
    for (let i = 0; i < foliageCaves.length; i++) {
        const cave = foliageCaves[i];
        if (cave.userData.isBlocked) {
            const gatePos = _scratchGatePos
                .copy(cave.userData.gatePosition)
                .applyMatrix4(cave.matrixWorld);
            // ⚡ OPTIMIZATION: Converted cave water proximity check to use distanceToSquared
            if (playerPos.distanceToSquared(gatePos) < 6.25) {
                waterLevel = gatePos.y + 5; // Water exists here
            }
        }
    }

    // Check standard Lake Water Level (Y=1.5) if inside lake bounds
    // BUT NOT if on the island (island is above water)
    if (isInLakeBasin(playerPos.x, playerPos.z) && !isOnLakeIsland(playerPos.x, playerPos.z)) {
        waterLevel = Math.max(waterLevel, 1.5);
    }

    return waterLevel;
}
