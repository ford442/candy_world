// src/systems/physics.ts
// Orchestrator file - delegates hot paths to physics.core.ts (TypeScript)
// MIGRATED to TypeScript

import * as THREE from 'three';
import {
    getGroundHeight, initPhysics, addObstacle, setPlayerState, getPlayerState, updatePhysicsCPP,
    uploadCollisionObjects, resolveGameCollisionsWASM
} from '../utils/wasm-loader.js';
import {
    foliageMushrooms, foliageTrampolines, foliageClouds, foliagePanningPads, foliageGeysers,
    activeVineSwing, setActiveVineSwing, lastVineDetachTime, setLastVineDetachTime, vineSwings, animatedFoliage
} from '../world/state.ts';
import { discoverySystem } from './discovery.ts';
import { DISCOVERY_MAP } from './discovery_map.ts';
import { optimizedDiscovery, checkPlayerDiscovery } from './discovery-optimized.ts';
import {
    calculateMovementInput,
    isInLakeBasin,
    isOnLakeIsland,
    getUnifiedGroundHeightTyped,
    calculateWaterLevel,
    PlayerState as CorePlayerState,
    KeyStates
} from './physics.core.ts';
import { uChromaticIntensity } from '../foliage/chromatic.ts';
import { spawnImpact } from '../foliage/impacts.ts';
import { VineSwing } from '../foliage/trees.ts';
import { unlockSystem } from './unlocks.ts';
import { showToast } from '../utils/toast.js';

// --- Types ---

export interface AudioState {
    grooveAmount?: number;
    bpm?: number;
    kickTrigger?: number;
    [key: string]: any;
}

export interface PlayerExtended extends CorePlayerState {
    airJumpsLeft: number;
    dashCooldown: number;
    canDash: boolean;
    isDancing: boolean;
    danceTime: number;
    danceStartPos?: THREE.Vector3;
    danceStartY?: number;
    danceStartRotation?: { x: number; y: number; z: number };
    hasShield: boolean;
    isPhasing: boolean;
    phaseTimer: number;
}

// --- Configuration ---
const GRAVITY = 20.0;
const SWIMMING_GRAVITY = 2.0; // Much lower gravity in water
const SWIMMING_DRAG = 4.0;    // High friction in water
const PLAYER_HEIGHT_OFFSET = 1.8; // Height above ground
const DANCE_KICK_THRESHOLD = 0.5; // Threshold for kick-triggered camera roll

// --- State Definitions ---
export const PlayerState = {
    DEFAULT: 'default',   // Grounded or Airborne (Standard Physics)
    SWIMMING: 'swimming', // Underwater physics
    CLIMBING: 'climbing', // Wall scaling
    VINE: 'vine',         // Swinging on a vine
    DANCING: 'dancing'    // Dance mode with unlocked cursor
};

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
    isDancing: false,
    danceTime: 0.0,
    hasShield: false,
    isPhasing: false,
    phaseTimer: 0.0,

    // Flags for external systems to query
    isGrounded: false,
    isUnderwater: false
};

// Internal input tracking for edge detection
const _lastInputState = {
    jump: false,
    dash: false,
    dance: false,
    phase: false
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
const _scratchUp = new THREE.Vector3(0, 1, 0);

// C++ Physics Init Flag
let cppPhysicsInitialized = false;
let foliageCaves: THREE.Object3D[] = []; // Store caves for collision checks

// --- Helper: Unified Ground Height (WASM + Lake Modifiers) ---
// This prevents the player from floating on "invisible" ground over the lake
function getUnifiedGroundHeight(x: number, z: number): number {
    return getUnifiedGroundHeightTyped(x, z, getGroundHeight);
}

// --- Public API ---

export function registerPhysicsCave(cave: THREE.Object3D) {
    foliageCaves.push(cave);
}

// Main Physics Update Loop
export function updatePhysics(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates, audioState: AudioState) {
    // 0. Sync Player State with Camera
    player.position.copy(camera.position);

    // 1. Update Global Environmental Modifiers (Wind, Groove)
    updateEnvironmentalModifiers(delta, audioState);

    // 2. Check Triggers & State Transitions
    updateStateTransitions(camera, keyStates);

    // 3. Execute State Logic
    switch (player.currentState) {
        case PlayerState.DANCING:
            updateDancingState(delta, camera, controls, keyStates, audioState);
            break;
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
    _lastInputState.dance = keyStates.dance;
    _lastInputState.phase = keyStates.phase;

    // 5. Check Flora Discovery (Throttled)
    const frameCount = Math.floor(Date.now() / 16);
    if (frameCount % 10 === 0) {
        checkFloraDiscovery(player.position);
    }

    // Sync back
    camera.position.copy(player.position);
}

function checkFloraDiscovery(playerPos: THREE.Vector3) {
    // OPTIMIZATION: Use WASM spatial grid if available
    // Falls back to JS O(N) loop if WASM not available
    if (optimizedDiscovery.isUsingWasm()) {
        checkPlayerDiscovery(playerPos);
    } else {
        // Legacy O(N) distance check (fallback)
        const DISCOVERY_RADIUS_SQ = 5.0 * 5.0; // 5 meters

        for (let i = 0; i < animatedFoliage.length; i++) {
            const obj = animatedFoliage[i];
            if (!obj.userData || !obj.userData.type) continue;

            const type = obj.userData.type;
            const discoveryInfo = DISCOVERY_MAP[type];

            if (discoveryInfo) {
                // Already discovered? Skip distance check
                if (discoverySystem.isDiscovered(type)) continue;

                const dx = playerPos.x - obj.position.x;
                const dy = playerPos.y - obj.position.y;
                const dz = playerPos.z - obj.position.z;
                const distSq = dx*dx + dy*dy + dz*dz;

                if (distSq < DISCOVERY_RADIUS_SQ) {
                    discoverySystem.discover(type, discoveryInfo.name, discoveryInfo.icon);
                }
            }
        }
    }
}

// --- Internal Logic ---

function updateEnvironmentalModifiers(delta: number, audioState: AudioState) {
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

function updateStateTransitions(camera: THREE.Camera, keyStates: KeyStates) {
    const playerPos = player.position;

    // A. Check Dance Mode Toggle (Toggle on/off with R key)
    const isDancePressed = keyStates.dance;
    const isDanceTriggered = isDancePressed && !_lastInputState.dance;
    
    if (isDanceTriggered) {
        if (player.currentState === PlayerState.DANCING) {
            // Exit dance mode
            player.currentState = PlayerState.DEFAULT;
            player.isDancing = false;
            player.danceTime = 0;
            // Clean up dance state
            player.danceStartPos = undefined;
            player.danceStartY = undefined;
            player.danceStartRotation = undefined;
            // Reset camera rotation
            camera.rotation.z = 0;
        } else if (player.currentState === PlayerState.DEFAULT) {
            // Enter dance mode
            player.currentState = PlayerState.DANCING;
            player.isDancing = true;
            player.danceTime = 0;
        }
    }

    // Skip other state transitions when dancing
    if (player.currentState === PlayerState.DANCING) {
        return;
    }

    // B. Check Water Level / Cave Flooding
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
function updateSwimmingState(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates) {
    player.velocity.y -= (SWIMMING_GRAVITY * delta);
    // Clamp drag factor to [0,1] to prevent velocity reversal on large delta (e.g., tab switch)
    player.velocity.multiplyScalar(Math.max(0, 1.0 - (SWIMMING_DRAG * delta)));

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
function updateVineState(delta: number, camera: THREE.Camera, keyStates: KeyStates) {
    if (activeVineSwing) {
        // VineSwing.update expects PlayerObject, but Camera is an Object3D
        // We pass camera for visual updates (positioning) - it's compatible enough
        activeVineSwing.update(camera as any, delta, keyStates);

        // CRITICAL: Sync player position to match camera immediately
        // because VineSwing modified camera.position
        player.position.copy(camera.position);

        if (keyStates.jump) {
            // detach modifies velocity, pass player (has velocity)
            setLastVineDetachTime(activeVineSwing.detach(player as any));
            setActiveVineSwing(null);
            keyStates.jump = false;
            player.currentState = PlayerState.DEFAULT;
        }
    }
}

// --- State: CLIMBING ---
function updateClimbingState(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates) {
    player.velocity.set(0,0,0);
    player.currentState = PlayerState.DEFAULT;
}

// --- State: DANCING ---
function updateDancingState(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates, audioState: AudioState | null) {
    // Unlock pointer if locked
    if (document.pointerLockElement === document.body) {
        controls.unlock();
    }

    // Update dance time
    player.danceTime += delta;
    
    // Get BPM and beat info from audio (with fallbacks for when no music is playing)
    const bpm = audioState?.bpm ?? 120;
    const beatPhase = audioState?.beatPhase ?? 0;
    const kickTrigger = audioState?.kickTrigger ?? 0;
    
    // Calculate beat duration in seconds
    const beatDuration = 60.0 / bpm;
    const danceSpeed = 1.0 + (bpm / 120.0); // Faster dance at higher BPMs
    
    // Position movement: Small circular pattern
    const circleRadius = 0.5 + (kickTrigger * 0.3); // Bigger circle on kicks
    const circleSpeed = danceSpeed * 2.0;
    const angle = player.danceTime * circleSpeed;
    
    // Store initial position on first frame
    if (!player.danceStartPos) {
        player.danceStartPos = player.position.clone();
        player.danceStartY = getUnifiedGroundHeight(player.position.x, player.position.z) + PLAYER_HEIGHT_OFFSET;
    }
    
    // Move in a circle around starting position
    player.position.x = player.danceStartPos.x + Math.sin(angle) * circleRadius;
    player.position.z = player.danceStartPos.z + Math.cos(angle) * circleRadius;
    
    // Bob up and down with the beat
    const bobAmount = 0.3 + (kickTrigger * 0.2);
    const bobPhase = beatPhase * Math.PI * 2;
    player.position.y = player.danceStartY + Math.sin(bobPhase) * bobAmount;
    
    // Camera view movement: Rotate and tilt based on music
    // Get current camera rotation
    const pitchAmount = Math.sin(player.danceTime * danceSpeed * 1.5) * 0.15; // Tilt up/down
    const yawAmount = Math.cos(player.danceTime * danceSpeed) * 0.3; // Turn left/right
    
    // Apply rotation relative to initial orientation
    if (!player.danceStartRotation) {
        player.danceStartRotation = {
            x: camera.rotation.x,
            y: camera.rotation.y,
            z: camera.rotation.z
        };
    }
    
    // Smooth rotation animation
    camera.rotation.x = player.danceStartRotation.x + pitchAmount;
    camera.rotation.y = player.danceStartRotation.y + yawAmount;
    
    // Extra bounce on kick
    if (kickTrigger > DANCE_KICK_THRESHOLD) {
        camera.rotation.z = Math.sin(player.danceTime * 10) * 0.05;
    } else {
        camera.rotation.z *= 0.9; // Dampen roll
    }
    
    // Zero velocity while dancing
    player.velocity.set(0, 0, 0);
    
    // Discovery
    if (player.danceTime < 0.1) {
        discoverySystem.discover('ability_dance', 'Dance Mode', '💃');
    }
}

// --- Ability Handler ---
function handleAbilities(delta: number, camera: THREE.Camera, keyStates: KeyStates) {
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

    // 5. Phase Shift
    // Trigger on Rising Edge of Phase Key
    const isPhasePressed = keyStates.phase;
    const isPhaseTriggered = isPhasePressed && !_lastInputState.phase;

    if (isPhaseTriggered) {
        if (player.isPhasing) {
            // Cancel Phase Shift early? Or just ignore.
        } else {
            // Attempt to activate
            if (unlockSystem.consume('tremolo_bulb', 1)) {
                player.isPhasing = true;
                player.phaseTimer = 5.0; // 5 Seconds Duration

                // Visuals
                if (uChromaticIntensity) {
                    uChromaticIntensity.value = 0.8; // Strong distortion
                }
                spawnImpact(player.position, 'land'); // Reuse land impact for now
                showToast("Phase Shift Active! 👻", "👻");

                // Note: Collision logic would need to check player.isPhasing
                // to ignore obstacles, but for now it's just a status effect + visual.
            } else {
                showToast("Need Tremolo Bulb! 🌷", "❌");
            }
        }
    }
}


// --- State: DEFAULT (Walking/Falling) ---
function updateDefaultState(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates, audioState: AudioState) {
    if (!cppPhysicsInitialized) {
        initCppPhysics(camera);
        cppPhysicsInitialized = true;
    }

    vineSwings.forEach(v => {
        if (v !== activeVineSwing) v.update(player as any, delta, null);
    });

    if (Date.now() - lastVineDetachTime > 500) {
        checkVineAttachment(camera);
    }

    // --- ABILITIES & MOVEMENT ---
    handleAbilities(delta, camera, keyStates);

    // Update Phase Shift Timer
    if (player.isPhasing) {
        player.phaseTimer -= delta;
        if (player.phaseTimer <= 0) {
            player.isPhasing = false;
            showToast("Phase Shift Ended", "👻");
        }
    }

    // Decay Chromatic Pulse (Hack for now, ideally moved to a proper FX system)
    // If Phasing, keep intensity high
    if (player.isPhasing) {
        if (uChromaticIntensity) uChromaticIntensity.value = 0.8 + Math.sin(Date.now() * 0.01) * 0.1;
    } else {
        if (uChromaticIntensity && uChromaticIntensity.value > 0) {
            uChromaticIntensity.value = Math.max(0, uChromaticIntensity.value - delta * 2.0);
        }
    }

    const { moveVec: moveInput, moveSpeed } = calculateMovementInput(camera, keyStates, player);

    // 3. Sync State with C++
    setPlayerState(player.position.x, player.position.y, player.position.z, player.velocity.x, player.velocity.y, player.velocity.z);

    // 4. Run C++ Update (Pass World Space Vectors)
    // CRITICAL FIX: If we are in the Lake Basin, we MUST use JS Physics.
    // The C++ WASM engine does not know about the visual carving and will return the wrong ground height (floating player).
    const px = player.position.x;
    const pz = player.position.z;
    const inLakeBasin = isInLakeBasin(px, pz);

    let onGround = -1; // Default to failure/fallback

    // Prevent C++ from applying jump force if we are doing an Air Jump (which isn't grounded)
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
            if (uChromaticIntensity) uChromaticIntensity.value = 0.5;
        }
    } else {
        // JS Fallback (Used for Lake Basin or C++ Failure)
        updateJSFallbackMovement(delta, camera, controls, keyStates, moveSpeed);
    }

    // --- WASM COLLISION RESOLVER (New) ---
    // Try WASM resolution first
    const kickTrigger = audioState?.kickTrigger || 0.0;
    const wasmResolved = resolveGameCollisionsWASM(player, kickTrigger);

    // Check discovery flags based on what happened?
    if (wasmResolved) {
         if (player.velocity.y > 12.0) {
              discoverySystem.discover('trampoline_shroom', 'Trampoline Mushroom', '🍄');
              keyStates.jump = false;
         }
         // Check if we landed on a cloud (isGrounded=true at High Y)
         if (player.isGrounded && player.position.y > 10.0) {
              discoverySystem.discover('cloud_platform', 'Solid Cloud', '☁️');
         }
    }

    // --- Panning Pads (JS Physics) ---
    // Explicit check for dynamic panning pads (bobbing platforms)
    checkPanningPads();

    // --- Kick-Drum Geysers (Riding the Plume) ---
    checkGeysers(delta);
}

function checkGeysers(delta: number) {
    for (const geyser of foliageGeysers) {
        // Distance check (Cylinder)
        const dx = player.position.x - geyser.position.x;
        const dz = player.position.z - geyser.position.z;
        const distSq = dx * dx + dz * dz;

        // Radius ~1.5 for leniency
        if (distSq < 2.25) {
             const eruptionStrength = geyser.userData.eruptionStrength || 0;
             const maxHeight = geyser.userData.maxHeight || 5.0;
             const activeHeight = maxHeight * eruptionStrength;
             const baseHeight = 0.5; // Height of the ring base

             // Check vertical overlap
             // Player must be above base and within plume height
             if (player.position.y >= geyser.position.y + baseHeight - 0.5 &&
                 player.position.y <= geyser.position.y + activeHeight + 1.0) {

                 // If eruption is strong enough to lift (and visible)
                 if (eruptionStrength > 0.1) {
                     // Apply Lift
                     // Target velocity is proportional to eruption strength
                     const targetVel = 15.0 * eruptionStrength;

                     // Smoothly interpolate velocity upwards
                     if (player.velocity.y < targetVel) {
                         player.velocity.y += (targetVel - player.velocity.y) * 5.0 * delta;
                     }

                     // Reset Air Jumps (Player can jump out of the stream)
                     player.airJumpsLeft = 1;
                     player.isGrounded = false;

                     // Discovery
                     discoverySystem.discover('kick_drum_geyser', 'Kick-Drum Geyser', '⛲');
                 }
             }
        }
    }
}

function checkPanningPads() {
    // Panning Pads are flat cylinders created with createPanningPad
    // We treat them as dynamic platforms that boost the player if landed on at peak bob.

    for (const pad of foliagePanningPads) {
        // Simple Cylinder Collision (XZ Check)
        const dx = player.position.x - pad.position.x;
        const dz = player.position.z - pad.position.z;
        const distSq = dx*dx + dz*dz;

        // Estimate radius (base 1.2 roughly, scaled)
        // Note: createPanningPad uses radius to scale inner mesh, and generation might scale group.
        // We assume effective radius is ~1.5 * scale for lenient gameplay feel.
        const radius = 1.5 * (pad.scale.x || 1.0);

        if (distSq < (radius * radius)) {
            // Vertical Check
            // The pad's visual Y is driven by animation.ts (panningBob)
            const padY = pad.position.y;
            // Visual top is roughly padY + thickness (0.1 scaled)
            // We give a generous vertical capture window
            const topY = padY + (0.1 * (pad.scale.y || 1.0));

            // Check if player is landing on it (falling or standing near top)
            if (player.velocity.y <= 0 &&
                player.position.y >= topY - 0.2 &&
                player.position.y <= topY + 0.5) {

                const currentBob = pad.userData.currentBob || 0;

                // Logic: High bob (>0.5) = Boost
                if (currentBob > 0.5) {
                     // Boost!
                     player.velocity.y = 20.0;
                     player.airJumpsLeft = 1; // Reset double jump
                     spawnImpact(pad.position, 'jump');
                     discoverySystem.discover('panning_pad', 'Panning Pad', '🪷');
                } else {
                     // Solid Platform (Land)
                     player.position.y = topY;
                     player.velocity.y = 0;
                     player.isGrounded = true;

                     // If we just landed, maybe spawn a small effect?
                     // But prevent spamming
                }
                return; // Handled collision
            }
        }
    }
}

function updateJSFallbackMovement(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates, moveSpeed: number) {
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
             if (uChromaticIntensity) uChromaticIntensity.value = 0.5;
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
function initCppPhysics(camera: THREE.Camera) {
    initPhysics(camera.position.x, camera.position.y, camera.position.z);

    // 1. Upload to C++ Engine (Emscripten) - For Standard Terrain/Obstacles
    for (const m of foliageMushrooms) {
        addObstacle(0, m.position.x, m.position.y, m.position.z, 0, (m.userData as any).capHeight||3, (m.userData as any).stemRadius||0.5, (m.userData as any).capRadius||2, (m.userData as any).isTrampoline?1:0);
    }
    for (const c of foliageClouds) {
        addObstacle(1, c.position.x, c.position.y, c.position.z, (c.scale.x||1)*2.0, (c.scale.y||1)*0.8, 0, (c.userData as any).tier||1, 0);
    }
    for (const t of foliageTrampolines) {
        addObstacle(2, t.position.x, t.position.y, t.position.z, (t.userData as any).bounceRadius||0.5, (t.userData as any).bounceHeight||0.5, (t.userData as any).bounceForce||12, 0, 0);
    }

    // 2. Upload to AssemblyScript Engine (ASC) - For Narrow Phase Interactivity
    uploadCollisionObjects(foliageCaves, foliageMushrooms, foliageClouds, foliageTrampolines);

    console.log('[Physics] Engines Initialized (C++ & ASC).');
}

function checkVineAttachment(camera: THREE.Camera) {
    const playerPos = player.position;
    for (const vineManager of vineSwings) {
        // SAFETY: Ensure vineManager and anchorPoint exist before accessing properties
        if (!vineManager || !vineManager.anchorPoint) continue;
        const anchor = vineManager.anchorPoint;
        if (typeof (anchor as any).x !== 'number' || typeof (anchor as any).y !== 'number' || typeof (anchor as any).z !== 'number') continue;

        const dx = playerPos.x - anchor.x;
        const dz = playerPos.z - anchor.z;
        const distH = Math.sqrt(dx*dx + dz*dz);
        const tipY = anchor.y - (typeof vineManager.length === 'number' ? vineManager.length : 0);

        if (distH < 2.0 && playerPos.y < anchor.y && playerPos.y > tipY) {
             if (distH < 1.0) {
                 if (typeof vineManager.attach === 'function') {
                     vineManager.attach(player as any, player.velocity);
                     setActiveVineSwing(vineManager);
                     break;
                 }
             }
        }
    }
}
