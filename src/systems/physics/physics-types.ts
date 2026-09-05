// src/systems/physics/physics-types.ts
// Types, constants, and shared state for physics system

import * as THREE from 'three';
import { CONFIG } from '../../core/config.ts';
import { PlayerState as CorePlayerState, KeyStates } from '../physics.core.ts';

// Re-export KeyStates for convenience
export type { KeyStates };

// --- Types ---

export interface AudioState {
    grooveAmount?: number;
    bpm?: number;
    kickTrigger?: number;
    beatPhase?: number;
    channelData?: any[];
    [key: string]: any;
}

export interface PlayerExtended extends CorePlayerState {
    airJumpsLeft: number;
    dashCooldown: number;
    canDash: boolean;
    dodgeRollCooldown: number;
    canDodgeRoll: boolean;
    isDancing: boolean;
    danceTime: number;
    danceStartPos?: THREE.Vector3;
    danceStartY?: number;
    danceStartRotation?: { x: number; y: number; z: number };
    hasShield: boolean;
    isPhasing: boolean;
    phaseTimer: number;
    isInvisible: boolean;
    invisibilityTimer: number;
    harpoon: {
        active: boolean;
        anchor: THREE.Vector3;
    };
    climbTarget: THREE.Object3D | null;
    climbTopY: number;
    /** Frames remaining where gravity is frozen after a spawn/teleport. */
    spawnProtectFrames: number;
    /**
     * Accumulated simulation clock (sum of physics deltas), used by the
     * character controller for coyote time / jump buffering (#1577).
     * Deliberately NOT wall-clock time — stays correct under frame stalls
     * and the game's own time scaling.
     */
    controllerClock: number;
    /** controllerClock value at the last frame the player was grounded. */
    lastGroundedTime: number;
    /** controllerClock value at the last rising-edge jump input. */
    jumpPressedTime: number;
}

// --- Configuration ---
export const GRAVITY = 21.5;
export const SWIMMING_GRAVITY = 2.0; // Much lower gravity in water
export const SWIMMING_DRAG = 4.0; // High friction in water
// Re-export the config value so legacy call sites keep working without edits.
export const PLAYER_HEIGHT_OFFSET = CONFIG.player.eyeHeight;
export const DANCE_KICK_THRESHOLD = 0.5; // Threshold for kick-triggered camera roll

// Movement constants
export const MOVE_ACCEL = 15.0;

// --- Kinematic Character Controller (#1577) ---

export interface CharacterControllerConfig {
    capsuleRadius: number;
    skinWidth: number;
    maxSlopeDeg: number;
    maxStepHeight: number;
    coyoteMs: number;
    jumpBufferMs: number;
    airControl: number;
    terminalFallSpeed: number;
    moveAccel: number;
    jumpVelocity: number;
    slopeSlideAccel: number;
    stepProbeDistance: number;
    footprintSamples: number;
}

export const CHARACTER_CONTROLLER: CharacterControllerConfig = {
    capsuleRadius: 0.35,
    skinWidth: 0.08,
    maxSlopeDeg: 42,
    maxStepHeight: 0.4,
    coyoteMs: 120,
    jumpBufferMs: 120,
    airControl: 0.35,
    terminalFallSpeed: 55,
    moveAccel: MOVE_ACCEL,
    jumpVelocity: 8.0,
    slopeSlideAccel: 12,
    stepProbeDistance: 0.45,
    footprintSamples: 4,
};

export interface CharacterIntent {
    wishDir: THREE.Vector3;
    moveSpeed: number;
    jumpPressed: boolean;
    jumpTriggered: boolean;
}

export interface CharacterStepResult {
    jumped: boolean;
    landed: boolean;
    fallSpeed: number;
}

export const _characterControllerState = {
    coyoteTimer: 0,
    jumpBufferTimer: 0,
};

export function resetCharacterControllerState(): void {
    _characterControllerState.coyoteTimer = 0;
    _characterControllerState.jumpBufferTimer = 0;
}

// Character controller scratch (zero-alloc hot path)
export const _scratchGroundNormal = new THREE.Vector3(0, 1, 0);
export const _scratchSlideDir = new THREE.Vector3();
export const _scratchProbePos = new THREE.Vector3();
export const _scratchWishOnPlane = new THREE.Vector3();
export const _scratchDownhill = new THREE.Vector3();
export const _scratchInputVel = new THREE.Vector3();
export const _scratchCapsuleProbe = { supportY: 0, normal: _scratchGroundNormal };

// --- State Definitions ---
export const PlayerState = {
    DEFAULT: 'default', // Grounded or Airborne (Standard Physics)
    SWIMMING: 'swimming', // Underwater physics
    CLIMBING: 'climbing', // Wall scaling
    VINE: 'vine', // Swinging on a vine
    DANCING: 'dancing', // Dance mode with unlocked cursor
} as const;

export type PlayerStateType = (typeof PlayerState)[keyof typeof PlayerState];

// --- Player State Object ---
export const player: PlayerExtended = {
    position: new THREE.Vector3(), // Shadowing camera position for WASM sync
    velocity: new THREE.Vector3(),
    speed: 14.0,
    sprintSpeed: 22.5,
    sneakSpeed: 5.0,
    gravity: GRAVITY,
    energy: 0.0,
    maxEnergy: 10.0,
    currentState: PlayerState.DEFAULT,

    // Ability State
    airJumpsLeft: 1,
    dashCooldown: 0.0,
    canDash: true,
    dodgeRollCooldown: 0.0,
    canDodgeRoll: true,
    isDancing: false,
    danceTime: 0.0,
    hasShield: false,
    isPhasing: false,
    phaseTimer: 0.0,
    isInvisible: false,
    invisibilityTimer: 0.0,

    // Flags for external systems to query
    isGrounded: false,
    isUnderwater: false,

    // Spawn protection: gravity is frozen for this many frames after placement.
    spawnProtectFrames: 0,

    harpoon: {
        active: false,
        anchor: new THREE.Vector3(),
    },
    climbTarget: null,
    climbTopY: 0,

    controllerClock: 0,
    lastGroundedTime: -Infinity,
    jumpPressedTime: -Infinity,
};

// Internal input tracking for edge detection
export const _lastInputState = {
    jump: false,
    dash: false,
    dodgeRoll: false,
    dance: false,
    phase: false,
    clap: false,
    forward: false,
};

// Global physics modifiers (Musical Ecosystem)
export const bpmWind = {
    direction: new THREE.Vector3(1, 0, 0),
    strength: 0,
    targetStrength: 0,
    bpm: 120,
};

export const grooveGravity = {
    multiplier: 1.0,
    targetMultiplier: 1.0,
    baseGravity: 20.0,
};

// --- Optimization: Scratch Variables (Zero-Allocation) ---
export const _scratchSwimDir = new THREE.Vector3();
export const _scratchCamDir = new THREE.Vector3();
export const _scratchCamRight = new THREE.Vector3();
export const _scratchMoveVec = new THREE.Vector3();
export const _scratchTargetVel = new THREE.Vector3();
export const _scratchUp = new THREE.Vector3(0, 1, 0);
// ⚡ OPTIMIZATION: Shared scratch object for WASM state reads to avoid GC spikes
export const _scratchPlayerState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
// ⚡ OPTIMIZATION: Scratch vector for Sonic Clap head offset calculations
export const _scratchHeadOffset = new THREE.Vector3();
export const _scratchPos = new THREE.Vector3();
export const _clapColor = new THREE.Color(0xffd700);

// C++ Physics Init Flag
export let cppPhysicsInitialized = false;

// Store caves for collision checks
export const foliageCaves: THREE.Object3D[] = [];

// Helper to set cpp physics initialized flag
export function setCppPhysicsInitialized(value: boolean) {
    cppPhysicsInitialized = value;
}

export const _scratchMatrix = new THREE.Matrix4();
