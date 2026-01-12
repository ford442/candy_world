// src/systems/physics.js
// Orchestrator file - delegates hot paths to physics.core.ts (TypeScript)
// Following PERFORMANCE_MIGRATION_STRATEGY.md - Keep JS as "Drafting Ground"

import * as THREE from 'three';
import {
    getGroundHeight, initPhysics, addObstacle, setPlayerState, getPlayerState, updatePhysicsCPP,
    uploadCollisionObjects, resolveGameCollisionsWASM
} from '../utils/wasm-loader.js';
import {
    foliageMushrooms, foliageTrampolines, foliageClouds,
    activeVineSwing, setActiveVineSwing, lastVineDetachTime, setLastVineDetachTime, vineSwings
} from '../world/state.js';
import { discoverySystem } from './discovery.js';
// Import TypeScript core functions (Phase 1 Migration)
import {
    calculateMovementInput,
    isInLakeBasin,
    getUnifiedGroundHeightTyped,
    calculateWaterLevel
} from './physics.core.js';
import { uChromaticIntensity } from '../foliage/chromatic.js';
import { spawnImpact } from '../foliage/impacts.js';

// --- Configuration ---
const PLAYER_RADIUS = 0.5;
const GRAVITY = 20.0;
const SWIMMING_GRAVITY = 2.0; // Much lower gravity in water
const SWIMMING_DRAG = 4.0;    // High friction in water
const CLIMB_SPEED = 5.0;

// --- Lake Configuration (Must match Generation.ts) ---
const LAKE_BOUNDS = { minX: -38, maxX: 78, minZ: -28, maxZ: 68 };
const LAKE_BOTTOM = -2.0;

// --- State Definitions ---
export const PlayerState = {
    DEFAULT: 'default',   // Grounded or Airborne (Standard Physics)
    SWIMMING: 'swimming', // Underwater physics
    CLIMBING: 'climbing', // Wall scaling
    VINE: 'vine'          // Swinging on a vine
};

// --- Player State Object ---
export const player = {
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

    // Flags for external systems to query
    isGrounded: false,
    isUnderwater: false
};

// Internal input tracking for edge detection
const _lastInputState = {
    jump: false,
    dash: false
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
const _scratchSwimDir = new THREE.Vector3();
const _scratchCamDir = new THREE.Vector3();
const _scratchCamRight = new THREE.Vector3();
const _scratchMoveVec = new THREE.Vector3();
const _scratchTargetVel = new THREE.Vector3();
const _scratchGatePos = new THREE.Vector3();
const _scratchUp = new THREE.Vector3(0, 1, 0);

// C++ Physics Init Flag
let cppPhysicsInitialized = false;
let foliageCaves = []; // Store caves for collision checks

// --- Helper: Unified Ground Height (WASM + Lake Modifiers) ---
// This prevents the player from floating on "invisible" ground over the lake
// MIGRATED: Now uses TypeScript version from physics.core.ts
function getUnifiedGroundHeight(x, z) {
    return getUnifiedGroundHeightTyped(x, z, getGroundHeight);
}

// --- Public API ---

export function registerPhysicsCave(cave) {
    foliageCaves.push(cave);
}

// Main Physics Update Loop
export function updatePhysics(delta, camera, controls, keyStates, audioState) {
    // 0. Sync Player State with Camera
    player.position.copy(camera.position);

    // 1. Update Global Environmental Modifiers (Wind, Groove)
    updateEnvironmentalModifiers(delta, audioState);

    // 2. Check Triggers & State Transitions
    updateStateTransitions(camera, keyStates);

    // 3. Execute State Logic
    switch (player.currentState) {
        case PlayerState.VINE:
            updateVineState(delta, camera, keyStates);
            break;
        case PlayerState.SWIMMING:
            updateSwimmingState(delta, camera, controls, keyStates);
            break;
        case PlayerState.CLIMBING:
            updateClimbingState(delta, camera, controls, keyStates);
            break;
        case PlayerState.DEFAULT:
        default:
            updateDefaultState(delta, camera, controls, keyStates, audioState);
            break;
    }

    // 4. Update Input History (for next frame edge detection)
    _lastInputState.jump = keyStates.jump;
    _lastInputState.dash = keyStates.dash;

    // Sync back
    camera.position.copy(player.position);
}

// --- Internal Logic ---

function updateEnvironmentalModifiers(delta, audioState) {
    if (audioState) {
        // Groove Gravity
        const groove = audioState.grooveAmount || 0;
        grooveGravity.targetMultiplier = 1.0 - (groove * 0.4);
        grooveGravity.multiplier += (grooveGravity.targetMultiplier - grooveGravity.multiplier) * delta * 5.0;
        player.gravity = grooveGravity.baseGravity * grooveGravity.multiplier;

        // BPM Wind (Visuals only for now)
        const currentBPM = audioState.bpm || 120;
        bpmWind.bpm = currentBPM;
        bpmWind.targetStrength = Math.min(1.0, (currentBPM - 60) / 120);
        bpmWind.strength += (bpmWind.targetStrength - bpmWind.strength) * delta * 2;
    }
}

function updateStateTransitions(camera, keyStates) {
    const playerPos = player.position;

    // A. Check Water Level / Cave Flooding
    // MIGRATED: Now uses TypeScript version from physics.core.ts
    const waterLevel = calculateWaterLevel(playerPos, foliageCaves);

    const wasSwimming = player.currentState === PlayerState.SWIMMING;
    const isNowUnderwater = playerPos.y < waterLevel;
    player.isUnderwater = isNowUnderwater;

    // Transition: Enter/Exit Water
    if (isNowUnderwater && !wasSwimming) {
        player.currentState = PlayerState.SWIMMING;
        // Dampen velocity on entry
        player.velocity.multiplyScalar(0.5);
    } else if (!isNowUnderwater && wasSwimming) {
        // Exit water logic
        if (playerPos.y > waterLevel) {
            player.currentState = PlayerState.DEFAULT;
            if (keyStates.jump) player.velocity.y = 8.0; // Boost out
        }
    }

    // Transition: Vine Handling
    if (activeVineSwing) {
        player.currentState = PlayerState.VINE;
        discoverySystem.discover('vine_swing', 'Swingable Vine', '🪜');
    } else if (player.currentState === PlayerState.VINE) {
        player.currentState = PlayerState.DEFAULT;
    }
}

// --- State: SWIMMING ---
function updateSwimmingState(delta, camera, controls, keyStates) {
    player.velocity.y += (SWIMMING_GRAVITY * delta);
    player.velocity.multiplyScalar(1.0 - (SWIMMING_DRAG * delta));

    const swimSpeed = player.speed * 0.6;
    const swimDir = _scratchSwimDir.set(0, 0, 0);

    if (keyStates.forward) swimDir.z += 1;
    if (keyStates.backward) swimDir.z -= 1;
    if (keyStates.right) swimDir.x += 1;
    if (keyStates.left) swimDir.x -= 1;

    if (swimDir.lengthSq() > 0) {
        swimDir.normalize();
        const camDir = _scratchCamDir;
        camera.getWorldDirection(camDir);
        const camRight = _scratchCamRight;
        camRight.crossVectors(camDir, _scratchUp);

        const moveVec = _scratchMoveVec.set(0, 0, 0)
            .addScaledVector(camDir, swimDir.z)
            .addScaledVector(camRight, swimDir.x);

        player.velocity.addScaledVector(moveVec, swimSpeed * delta);
    }

    if (keyStates.jump) player.velocity.y += 10 * delta;
    if (keyStates.sneak) player.velocity.y -= 10 * delta;

    // controls.moveRight/Forward applies to the camera object directly, which we synced to player.position
    // But Three.js PointerLockControls uses its own internal object.
    // We update position manually here instead.

    player.position.x += player.velocity.x * delta;
    player.position.z += player.velocity.z * delta;
    player.position.y += player.velocity.y * delta;
}

// --- State: VINE SWING ---
function updateVineState(delta, camera, keyStates) {
    if (activeVineSwing) {
        activeVineSwing.update(camera, delta, keyStates);
        // Sync velocity back to player for detach momentum
        // (Managed inside VineSwing class mostly)
        if (keyStates.jump) {
            setLastVineDetachTime(activeVineSwing.detach(player));
            setActiveVineSwing(null);
            keyStates.jump = false;
            player.currentState = PlayerState.DEFAULT;
        }
    }
}

// --- State: CLIMBING ---
function updateClimbingState(delta, camera, controls, keyStates) {
    player.velocity.set(0,0,0);
    player.currentState = PlayerState.DEFAULT;
}

// --- Ability Handler ---
function handleAbilities(delta, camera, keyStates) {
    // 1. Cooldown Management
    if (player.dashCooldown > 0) {
        player.dashCooldown -= delta;
    }

    // 2. Ground Reset
    if (player.isGrounded) {
        player.airJumpsLeft = 1; // Reset Double Jump
    }

    // 3. Double Jump (Air Jump)
    // Trigger on Rising Edge of Jump Key AND Not Grounded AND Jumps Left
    const isJumpPressed = keyStates.jump;
    const isJumpTriggered = isJumpPressed && !_lastInputState.jump;

    if (isJumpTriggered && !player.isGrounded && player.airJumpsLeft > 0) {
        // Apply Jump Force
        player.velocity.y = 12.0;
        player.airJumpsLeft--;

        // Visual / Feedback
        spawnImpact(player.position, 'jump');

        // Small chromatic aberration bump
        if (uChromaticIntensity) {
             // We can't set node directly? uChromaticIntensity is a UniformNode.
             // .value property updates the uniform value.
             uChromaticIntensity.value = 0.2;
        }

        discoverySystem.discover('ability_double_jump', 'Double Jump', '🦘');
    }

    // 4. Dash
    // Trigger on Rising Edge of Dash Key AND Cooldown Ready
    const isDashPressed = keyStates.dash;
    const isDashTriggered = isDashPressed && !_lastInputState.dash;

    if (isDashTriggered && player.dashCooldown <= 0) {
        // Calculate Dash Direction (Camera Forward, flattened)
        camera.getWorldDirection(_scratchCamDir);
        _scratchCamDir.y = 0;
        _scratchCamDir.normalize();

        // Apply Impulse (25 units/sec instant boost)
        // We add to existing velocity? Or set it?
        // Setting it gives a "snappy" feel. Adding preserves momentum.
        // Let's Add, but clamp Y.
        player.velocity.addScaledVector(_scratchCamDir, 25.0);

        // Cancel vertical momentum for "Air Dash" feel
        if (!player.isGrounded) {
            player.velocity.y = 0;
        }

        player.dashCooldown = 1.0; // 1 Second Cooldown

        // Visual Feedback
        spawnImpact(player.position, 'dash');

        if (uChromaticIntensity) {
            uChromaticIntensity.value = 0.5; // Stronger pulse for dash
        }

        discoverySystem.discover('ability_dash', 'Dash', '💨');
    }
}


// --- State: DEFAULT (Walking/Falling) ---
function updateDefaultState(delta, camera, controls, keyStates, audioState) {
    if (!cppPhysicsInitialized) {
        initCppPhysics(camera);
        cppPhysicsInitialized = true;
    }

    vineSwings.forEach(v => {
        if (v !== activeVineSwing) v.update(camera, delta, null);
    });

    if (Date.now() - lastVineDetachTime > 500) {
        checkVineAttachment(camera);
    }

    // --- ABILITIES & MOVEMENT ---
    handleAbilities(delta, camera, keyStates);

    // Decay Chromatic Pulse (Hack for now, ideally moved to a proper FX system)
    if (uChromaticIntensity && uChromaticIntensity.value > 0) {
        uChromaticIntensity.value = Math.max(0, uChromaticIntensity.value - delta * 2.0);
    }

    // MIGRATED: Now uses TypeScript version from physics.core.ts
    const { moveVec: moveInput, moveSpeed } = calculateMovementInput(camera, keyStates, player);

    // 3. Sync State with C++
    setPlayerState(player.position.x, player.position.y, player.position.z, player.velocity.x, player.velocity.y, player.velocity.z);

    // 4. Run C++ Update (Pass World Space Vectors)
    // CRITICAL FIX: If we are in the Lake Basin, we MUST use JS Physics.
    // The C++ WASM engine does not know about the visual carving and will return the wrong ground height (floating player).
    const px = player.position.x;
    const pz = player.position.z;
    // MIGRATED: Now uses TypeScript version from physics.core.ts
    const inLakeBasin = isInLakeBasin(px, pz);

    let onGround = -1; // Default to failure/fallback

    // Prevent C++ from applying jump force if we are doing an Air Jump (which isn't grounded)
    // But C++ checks ground internally. If we pass jump=1 and it's not ground, it does nothing.
    // However, if we just air-jumped, we might want to tell C++ we are jumping?
    // Actually, we modified velocity in handleAbilities. C++ will integrate that velocity.
    // We should pass jump=0 to C++ if we are air-jumping, so it doesn't double-dip if it mistakenly thinks we are grounded.
    // Only pass jump=1 if we WANT a ground jump.
    // Ground jump logic is handled by C++ when on ground.
    // So: if isGrounded, pass keyStates.jump. If not, pass 0.
    const effectiveJumpInput = (player.isGrounded && keyStates.jump) ? 1 : 0;

    if (!inLakeBasin) {
        onGround = updatePhysicsCPP(
            delta,
            moveInput.x,
            moveInput.z,
            moveSpeed,
            effectiveJumpInput,
            keyStates.sprint ? 1 : 0,
            keyStates.sneak ? 1 : 0,
            grooveGravity.multiplier
        );
    }

    if (onGround >= 0) {
        // C++ Success
        const newState = getPlayerState();
        player.position.set(newState.x, newState.y, newState.z);
        player.velocity.set(newState.vx, newState.vy, newState.vz);

        // Reset jump key if we successfully jumped (velocity.y > 0)
        // But only if we were grounded before (normal jump)
        if (player.velocity.y > 0 && player.isGrounded) keyStates.jump = false;

        const wasGrounded = player.isGrounded;
        player.isGrounded = (onGround === 1);

        if (!wasGrounded && player.isGrounded && player.velocity.y < -1.0) {
            spawnImpact(player.position, 'land');
        }
    } else {
        // JS Fallback (Used for Lake Basin or C++ Failure)
        updateJSFallbackMovement(delta, camera, controls, keyStates, moveSpeed);
    }

    // --- WASM COLLISION RESOLVER (New) ---
    // Try WASM resolution first
    const kickTrigger = audioState?.kickTrigger || 0.0;
    const wasmResolved = resolveGameCollisionsWASM(player, kickTrigger);

    // If WASM didn't handle something critical (or wasn't ready), we might need fallback,
    // but the goal is to replace it.
    // However, for safety during migration, we can keep the JS logic as a backup if WASM fails?
    // No, if WASM returns true, it modified state. If false, it didn't collide.
    // But we need to ensure WASM *has* the objects.

    // Check discovery flags based on what happened?
    // The WASM function modifies velocity (e.g. bounce).
    // We can check if velocity.y spiked > 10 to infer trampoline?
    if (wasmResolved) {
         if (player.velocity.y > 12.0) {
              discoverySystem.discover('trampoline_shroom', 'Trampoline Mushroom', '🍄');
              keyStates.jump = false;
         }
         // Check if we landed on a cloud (isGrounded=true at High Y)
         if (player.isGrounded && player.position.y > 10.0) {
              discoverySystem.discover('cloud_platform', 'Solid Cloud', '☁️');
         }
    } else {
        // Fallback or Legacy check (if WASM not loaded or empty)
        // resolveSpecialCollisions(delta, camera, keyStates, audioState);
    }
}

function updateJSFallbackMovement(delta, camera, controls, keyStates, moveSpeed) {
    // Same Camera-Relative Logic
    const camDir = _scratchCamDir;
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();
    const camRight = _scratchCamRight.crossVectors(camDir, _scratchUp);

    const _targetVelocity = _scratchTargetVel.set(0, 0, 0);
    if (keyStates.forward) _targetVelocity.add(camDir);
    if (keyStates.backward) _targetVelocity.sub(camDir);
    if (keyStates.right) _targetVelocity.add(camRight);
    if (keyStates.left) _targetVelocity.sub(camRight);

    if (_targetVelocity.lengthSq() > 0) _targetVelocity.normalize().multiplyScalar(moveSpeed);

    const smoothing = Math.min(1.0, 15.0 * delta);
    player.velocity.x += (_targetVelocity.x - player.velocity.x) * smoothing;
    player.velocity.z += (_targetVelocity.z - player.velocity.z) * smoothing;
    player.velocity.y -= player.gravity * delta;

    player.position.x += player.velocity.x * delta;
    player.position.z += player.velocity.z * delta;
    player.position.y += player.velocity.y * delta;

    // Corrected Ground Check using Unified Height (Accounts for Lake)
    const groundY = getUnifiedGroundHeight(player.position.x, player.position.z);

    const wasGrounded = player.isGrounded;
    if (player.position.y < groundY + 1.8 && player.velocity.y <= 0) {
        player.position.y = groundY + 1.8;
        player.velocity.y = 0;
        player.isGrounded = true;

        if (!wasGrounded) {
             spawnImpact(player.position, 'land');
        }
    } else {
        player.isGrounded = false;
    }

    // JS Logic doesn't auto-handle jump, so we add it here for consistency if needed?
    // But JS fallback is mostly for lake where we swim.
    // If walking on lake bottom:
    if (player.isGrounded && keyStates.jump) {
        player.velocity.y = 8.0;
        player.isGrounded = false;
    }
}

// Helper: Initialize C++ obstacles (One-time setup)
function initCppPhysics(camera) {
    initPhysics(camera.position.x, camera.position.y, camera.position.z);

    // 1. Upload to C++ Engine (Emscripten) - For Standard Terrain/Obstacles
    // (This might be redundant if we use the new ASC system, but C++ handles ground physics well)
    // We keep it for now.
    for (const m of foliageMushrooms) {
        addObstacle(0, m.position.x, m.position.y, m.position.z, 0, m.userData.capHeight||3, m.userData.stemRadius||0.5, m.userData.capRadius||2, m.userData.isTrampoline?1:0);
    }
    for (const c of foliageClouds) {
        addObstacle(1, c.position.x, c.position.y, c.position.z, (c.scale.x||1)*2.0, (c.scale.y||1)*0.8, 0, c.userData.tier||1, 0);
    }
    for (const t of foliageTrampolines) {
        addObstacle(2, t.position.x, t.position.y, t.position.z, t.userData.bounceRadius||0.5, t.userData.bounceHeight||0.5, t.userData.bounceForce||12, 0, 0);
    }

    // 2. Upload to AssemblyScript Engine (ASC) - For Narrow Phase Interactivity
    uploadCollisionObjects(foliageCaves, foliageMushrooms, foliageClouds, foliageTrampolines);

    console.log('[Physics] Engines Initialized (C++ & ASC).');
}

function checkVineAttachment(camera) {
    const playerPos = player.position;
    for (const vineManager of vineSwings) {
        const dx = playerPos.x - vineManager.anchorPoint.x;
        const dz = playerPos.z - vineManager.anchorPoint.z;
        const distH = Math.sqrt(dx*dx + dz*dz);
        const tipY = vineManager.anchorPoint.y - vineManager.length;

        if (distH < 2.0 && playerPos.y < vineManager.anchorPoint.y && playerPos.y > tipY) {
             if (distH < 1.0) {
                 vineManager.attach(camera, player.velocity);
                 setActiveVineSwing(vineManager);
                 break;
             }
        }
    }
}
