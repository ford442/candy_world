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
    dash: boolean;
    dance: boolean;
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

// --- Constants ---
const LAKE_BOUNDS: LakeBounds = { 
    minX: -38, 
    maxX: 78, 
    minZ: -28, 
    maxZ: 68 
};
const LAKE_BOTTOM = -2.0;

// Lake Island Configuration (must match generation.ts)
const LAKE_ISLAND: LakeIslandConfig = {
    centerX: 20,
    centerZ: 20,
    radius: 12,
    peakHeight: 3.0,
    falloffRadius: 4,
    enabled: true
};

// Scratch vectors (reused to prevent GC)
const _scratchCamDir = new THREE.Vector3();
const _scratchCamRight = new THREE.Vector3();
const _scratchMoveVec = new THREE.Vector3();
const _scratchUp = new THREE.Vector3(0, 1, 0);
const _scratchGatePos = new THREE.Vector3(); // For cave gate calculations

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
 * Check if position is on the Lake Island
 * Returns true if the position is on solid ground above water
 */
export function isOnLakeIsland(x: number, z: number): boolean {
    if (!LAKE_ISLAND.enabled) return false;
    
    const dx = x - LAKE_ISLAND.centerX;
    const dz = z - LAKE_ISLAND.centerZ;
    const distFromCenter = Math.sqrt(dx * dx + dz * dz);
    
    return distFromCenter < LAKE_ISLAND.radius;
}

/**
 * Get unified ground height with lake carving and island applied
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
        // Check if we're on the island first
        if (LAKE_ISLAND.enabled) {
            const dx = x - LAKE_ISLAND.centerX;
            const dz = z - LAKE_ISLAND.centerZ;
            const distFromIslandCenter = Math.sqrt(dx * dx + dz * dz);
            
            if (distFromIslandCenter < LAKE_ISLAND.radius) {
                // On the island - calculate height above water
                const normalizedDist = distFromIslandCenter / LAKE_ISLAND.radius;
                
                // Smooth falloff using cosine curve for natural hill shape
                const islandHeight = LAKE_ISLAND.peakHeight * Math.cos(normalizedDist * Math.PI / 2);
                
                // Blend at the edge of the island
                const edgeDist = LAKE_ISLAND.radius - distFromIslandCenter;
                const edgeBlend = Math.min(1.0, edgeDist / LAKE_ISLAND.falloffRadius);
                
                // Island height above water level (water is at ~1.5)
                const waterLevel = 1.5;
                const finalIslandHeight = waterLevel + (islandHeight * edgeBlend);
                
                // Return island height (don't apply lake depression)
                return Math.max(height, finalIslandHeight);
            }
        }
        
        // Not on island - apply lake depression
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

    // Check cave water gates (using scratch vector to avoid GC)
    foliageCaves.forEach(cave => {
        if (cave.userData.isBlocked) {
            const gatePos = _scratchGatePos
                .copy(cave.userData.gatePosition)
                .applyMatrix4(cave.matrixWorld);
            if (playerPos.distanceTo(gatePos) < 2.5) {
                waterLevel = gatePos.y + 5; // Water exists here
            }
        }
    });

    // Check standard Lake Water Level (Y=1.5) if inside lake bounds
    // BUT NOT if on the island (island is above water)
    if (isInLakeBasin(playerPos.x, playerPos.z) && !isOnLakeIsland(playerPos.x, playerPos.z)) {
        waterLevel = Math.max(waterLevel, 1.5);
    }

    return waterLevel;
}
