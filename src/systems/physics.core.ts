// src/systems/physics.core.ts
// Core physics calculation functions (Phase 1: JS -> TS Migration)
// Following PERFORMANCE_MIGRATION_STRATEGY.md - Extract only hot functions (~15%)

import * as THREE from 'three';

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

// --- Constants ---
const LAKE_BOUNDS: LakeBounds = { 
    minX: -38, 
    maxX: 78, 
    minZ: -28, 
    maxZ: 68 
};
const LAKE_BOTTOM = -2.0;

// Scratch vectors (reused to prevent GC)
const _scratchCamDir = new THREE.Vector3();
const _scratchCamRight = new THREE.Vector3();
const _scratchMoveVec = new THREE.Vector3();
const _scratchUp = new THREE.Vector3(0, 1, 0);

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

    return { moveVec, moveSpeed };
}

/**
 * Check if player is in lake basin
 * Helper function for physics routing decisions
 */
export function isInLakeBasin(x: number, z: number): boolean {
    return (
        x > LAKE_BOUNDS.minX && 
        x < LAKE_BOUNDS.maxX && 
        z > LAKE_BOUNDS.minZ && 
        z < LAKE_BOUNDS.maxZ
    );
}

/**
 * Get unified ground height with lake carving applied
 * Must match the logic in generation.ts
 */
export function getUnifiedGroundHeightTyped(
    x: number,
    z: number,
    getGroundHeight: (x: number, z: number) => number
): number {
    let height = getGroundHeight(x, z);

    // Apply Lake Carving (Mirroring Generation.ts)
    if (isInLakeBasin(x, z)) {
        const distX = Math.min(x - LAKE_BOUNDS.minX, LAKE_BOUNDS.maxX - x);
        const distZ = Math.min(z - LAKE_BOUNDS.minZ, LAKE_BOUNDS.maxZ - z);
        const distEdge = Math.min(distX, distZ);

        // Smooth blend area (10 units wide)
        const blend = Math.min(1.0, distEdge / 10.0);
        const targetHeight = THREE.MathUtils.lerp(height, LAKE_BOTTOM, blend);

        // Only lower, never raise
        if (targetHeight < height) {
            height = targetHeight;
        }
    }
    return height;
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

    // Check cave water gates
    foliageCaves.forEach(cave => {
        if (cave.userData.isBlocked) {
            const gatePos = new THREE.Vector3()
                .copy(cave.userData.gatePosition)
                .applyMatrix4(cave.matrixWorld);
            if (playerPos.distanceTo(gatePos) < 2.5) {
                waterLevel = gatePos.y + 5; // Water exists here
            }
        }
    });

    // Check standard Lake Water Level (Y=1.5) if inside lake bounds
    if (isInLakeBasin(playerPos.x, playerPos.z)) {
        waterLevel = Math.max(waterLevel, 1.5);
    }

    return waterLevel;
}
