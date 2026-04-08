// src/systems/physics/physics-types.ts
// Types, constants, and shared state for physics system

import * as THREE from 'three';
import { PlayerState as CorePlayerState, KeyStates } from '../physics.core.js';

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
}

// --- Configuration ---
export const GRAVITY = 20.0;
export const SWIMMING_GRAVITY = 2.0; // Much lower gravity in water
export const SWIMMING_DRAG = 4.0;    // High friction in water
export const PLAYER_HEIGHT_OFFSET = 1.8; // Height above ground
export const DANCE_KICK_THRESHOLD = 0.5; // Threshold for kick-triggered camera roll

// Movement constants
export const MOVE_ACCEL = 15.0;

// --- State Definitions ---
export const PlayerState = {
    DEFAULT: 'default',   // Grounded or Airborne (Standard Physics)
    SWIMMING: 'swimming', // Underwater physics
    CLIMBING: 'climbing', // Wall scaling
    VINE: 'vine',         // Swinging on a vine
    DANCING: 'dancing'    // Dance mode with unlocked cursor
} as const;

export type PlayerStateType = typeof PlayerState[keyof typeof PlayerState];

// --- Player State Object ---
export const player: PlayerExtended = {
    position: new THREE.Vector3(), // Shadowing camera position for WASM sync
    velocity: new THREE.Vector3(),
    speed: 15.0,
    sprintSpeed: 25.0,
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

    harpoon: {
        active: false,
        anchor: new THREE.Vector3()
    }
};

// Internal input tracking for edge detection
export const _lastInputState = {
    jump: false,
    dash: false,
    dodgeRoll: false,
    dance: false,
    phase: false,
    clap: false
};

// Global physics modifiers (Musical Ecosystem)
export const bpmWind = {
    direction: new THREE.Vector3(1, 0, 0),
    strength: 0,
    targetStrength: 0,
    bpm: 120
};

export const grooveGravity = {
    multiplier: 1.0,
    targetMultiplier: 1.0,
    baseGravity: 20.0
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
export const _clapColor = new THREE.Color(0xFFD700);

// C++ Physics Init Flag
export let cppPhysicsInitialized = false;

// Store caves for collision checks
export const foliageCaves: THREE.Object3D[] = [];

// Helper to set cpp physics initialized flag
export function setCppPhysicsInitialized(value: boolean) {
    cppPhysicsInitialized = value;
}
