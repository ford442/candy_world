// src/systems/physics/physics-states.ts
// State handlers: Swimming, Vine, Climbing, Dancing, Default

import * as THREE from 'three';
import { 
    player, 
    PlayerState, 
    _lastInputState,
    _scratchSwimDir,
    _scratchCamDir,
    _scratchCamRight,
    _scratchMoveVec,
    _scratchUp,
    SWIMMING_GRAVITY,
    SWIMMING_DRAG,
    PLAYER_HEIGHT_OFFSET,
    DANCE_KICK_THRESHOLD,
    bpmWind,
    grooveGravity,
    AudioState,
    KeyStates,
    foliageCaves
} from './physics-types.js';
import { 
    activeVineSwing, 
    setActiveVineSwing, 
    lastVineDetachTime, 
    setLastVineDetachTime, 
    vineSwings,
    foliageVineLadders
} from '../../world/state.ts';
import { discoverySystem } from '../discovery.ts';
import { spawnImpact } from '../../foliage/impacts.ts';
import { uChromaticIntensity } from '../../foliage/chromatic.ts';
import { calculateWaterLevel } from '../physics.core.js';
import { getGroundHeight as getAuthoritativeGroundHeight } from '../ground-system.ts';

// Helper: Unified Ground Height (authoritative terrain + lake + island + platforms)

// --- Environmental Modifiers ---
export function updateEnvironmentalModifiers(delta: number, audioState: AudioState) {
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

// --- State Transitions ---
export function updateStateTransitions(camera: THREE.Camera, keyStates: KeyStates) {
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
            // ⚡ OPTIMIZATION: Instead of undefined, just let the logic reset values on next dance to avoid GC
            player.danceStartY = undefined;
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

    // C. Check Climbing Transitions
    if (player.currentState === PlayerState.DEFAULT) {
        const nearest = findNearestClimbable(playerPos, 2.5);
        if (nearest) {
            // Enter climbing when pressing forward near a ladder
            const isForwardPressed = keyStates.forward;
            const isForwardTriggered = isForwardPressed && !_lastInputState.forward;
            if (isForwardTriggered) {
                player.currentState = PlayerState.CLIMBING;
                player.climbTarget = nearest;
                const length = nearest.userData.vineLength || 10;
                player.climbTopY = nearest.position.y;
                discoverySystem.discover('vine_ladder', 'Vine Ladder', '🪜');
            }
        }
    } else if (player.currentState === PlayerState.CLIMBING) {
        const isJumpPressed = keyStates.jump;
        const isJumpTriggered = isJumpPressed && !_lastInputState.jump;
        if (isJumpTriggered) {
            // Detach with boost
            player.currentState = PlayerState.DEFAULT;
            player.velocity.y = CLIMB_DETACH_BOOST;
            player.climbTarget = null;
        }
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
export function updateSwimmingState(
    delta: number, 
    camera: THREE.Camera, 
    controls: any, 
    keyStates: KeyStates, 
    audioState: AudioState | null
) {
    player.velocity.y -= (SWIMMING_GRAVITY * delta);
    // Clamp drag factor to [0,1] to prevent velocity reversal on large delta (e.g., tab switch)
    player.velocity.multiplyScalar(Math.max(0, 1.0 - (SWIMMING_DRAG * delta)));

    const kickTrigger = audioState?.kickTrigger || 0.0;
    const surfBoost = kickTrigger > 0.5 ? kickTrigger * 1.5 : 0;

    // Base speed + potential surfing boost on kick
    const swimSpeed = player.speed * (0.6 + surfBoost);
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

        // Surfing feedback if moving forward
        if (surfBoost > 0 && keyStates.forward) {
            // Only trigger occasionally so we don't spam impacts/toasts
            if (Math.random() < 0.05) {
                spawnImpact(player.position, 'dash');
                if (uChromaticIntensity) {
                    uChromaticIntensity.value = 0.3;
                }
                discoverySystem.discover('waveform_surfing', 'Waveform Surfing', '🌊');
            }
        }
    }

    if (keyStates.jump) player.velocity.y += 10 * delta;
    if (keyStates.sneak) player.velocity.y -= 10 * delta;

    // Harpoon Mechanics
    if (player.harpoon.active) {
        const dx = player.harpoon.anchor.x - player.position.x;
        const dy = player.harpoon.anchor.y - player.position.y;
        const dz = player.harpoon.anchor.z - player.position.z;
        const distSq = dx*dx + dy*dy + dz*dz;

        if (distSq < 4.0) { // Reached anchor
            player.harpoon.active = false;
            player.velocity.y += 15.0; // Boost out
            spawnImpact(player.position, 'jump');
        } else {
            // Pull towards anchor
            // ⚡ OPTIMIZATION: Bypassed Math.sqrt overhead using fastInvSqrt for vector normalization
            const invDist = fastInvSqrt(distSq);
            // Modulate pull speed with kick drum
            const kickBoost = audioState?.kickTrigger ? audioState.kickTrigger * 20.0 : 0;
            const pullSpeed = 30.0 + kickBoost;

            player.velocity.x += (dx * invDist) * pullSpeed * delta;
            player.velocity.y += (dy * invDist) * pullSpeed * delta;
            player.velocity.z += (dz * invDist) * pullSpeed * delta;

            if (Math.random() < 0.1) {
                spawnImpact(player.position, 'dash');
            }
        }
    }

    // controls.moveRight/Forward applies to the camera object directly, which we synced to player.position
    // But Three.js PointerLockControls uses its own internal object.
    // We update position manually here instead.

    player.position.x += player.velocity.x * delta;
    player.position.z += player.velocity.z * delta;
    player.position.y += player.velocity.y * delta;
}

// --- State: VINE SWING ---
export function updateVineState(delta: number, camera: THREE.Camera, keyStates: KeyStates) {
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
const CLIMB_SPEED = 6.0;
const CLIMB_DETACH_BOOST = 8.0;
const CLIMB_MAX_DIST_SQ = 2.5 * 2.5;

export function updateClimbingState(
    delta: number,
    camera: THREE.Camera,
    controls: any,
    keyStates: KeyStates
) {
    if (!player.climbTarget) {
        player.currentState = PlayerState.DEFAULT;
        return;
    }

    const target = player.climbTarget;
    const topY = player.climbTopY;

    // Horizontal snap: keep player centered on the climbable
    player.position.x += (target.position.x - player.position.x) * 5.0 * delta;
    player.position.z += (target.position.z - player.position.z) * 5.0 * delta;

    // Vertical movement
    if (keyStates.forward || keyStates.jump) {
        player.position.y += CLIMB_SPEED * delta;
    } else if (keyStates.backward || keyStates.sneak) {
        player.position.y -= CLIMB_SPEED * delta;
    }

    // Clamp to bottom (don't go below ladder base)
    const length = target.userData.vineLength || 10;
    const baseY = target.position.y - length;
    if (player.position.y < baseY + PLAYER_HEIGHT_OFFSET) {
        player.position.y = baseY + PLAYER_HEIGHT_OFFSET;
        // Drop off at bottom
        player.currentState = PlayerState.DEFAULT;
        player.climbTarget = null;
        return;
    }

    // Auto-step off at top
    if (player.position.y >= topY - 0.5) {
        player.position.y = topY + PLAYER_HEIGHT_OFFSET;
        player.currentState = PlayerState.DEFAULT;
        player.climbTarget = null;
        // Small forward nudge so we don't immediately fall back
        const forward = _scratchCamDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
        forward.y = 0;
        forward.normalize();
        player.position.addScaledVector(forward, 0.5);
        return;
    }

    // Check if we strayed too far horizontally
    const dx = player.position.x - target.position.x;
    const dz = player.position.z - target.position.z;
    if (dx * dx + dz * dz > CLIMB_MAX_DIST_SQ) {
        player.currentState = PlayerState.DEFAULT;
        player.climbTarget = null;
    }

    player.velocity.set(0, 0, 0);
}

// Helper: Find nearest climbable object
const _scratchClimbablePos = new THREE.Vector3();

export function findNearestClimbable(
    position: THREE.Vector3,
    maxRadius: number = 2.0
): THREE.Object3D | null {
    let best: THREE.Object3D | null = null;
    let bestDistSq = maxRadius * maxRadius;

    for (const ladder of foliageVineLadders) {
        _scratchClimbablePos.copy(ladder.position);
        // Ladder anchor is at top, bottom extends down by length
        const length = ladder.userData.vineLength || 10;
        const bottomY = _scratchClimbablePos.y - length;
        // Only climbable if player is within vertical range
        if (position.y < bottomY - 1.0 || position.y > _scratchClimbablePos.y + 1.0) continue;

        const dx = position.x - _scratchClimbablePos.x;
        const dz = position.z - _scratchClimbablePos.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = ladder;
        }
    }

    return best;
}

// --- State: DANCING ---
export function updateDancingState(
    delta: number, 
    camera: THREE.Camera, 
    controls: any, 
    keyStates: KeyStates, 
    audioState: AudioState | null
) {
    // Unlock pointer if locked
    if (document.pointerLockElement === document.body) {
        controls.unlock();
    }

    // Store initial values before updating dance time so that we can check for danceTime === 0
    const isFirstFrame = player.danceTime === 0;

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
    // ⚡ OPTIMIZATION: Zero-allocation dance state initialization
    if (isFirstFrame || !player.danceStartPos) {
        player.danceStartPos = player.danceStartPos || new THREE.Vector3();
        player.danceStartPos.copy(player.position);
        player.danceStartY = getAuthoritativeGroundHeight(player.position.x, player.position.z) + PLAYER_HEIGHT_OFFSET;
    }
    
    // Move in a circle around starting position
    player.position.x = player.danceStartPos.x + Math.sin(angle) * circleRadius;
    player.position.z = player.danceStartPos.z + Math.cos(angle) * circleRadius;
    
    // Bob up and down with the beat
    const bobAmount = 0.3 + (kickTrigger * 0.2);
    const bobPhase = beatPhase * Math.PI * 2;
    // TypeScript safety: danceStartY is initialized right after danceStartPos
    player.position.y = (player.danceStartY || 0) + Math.sin(bobPhase) * bobAmount;
    
    // Camera view movement: Rotate and tilt based on music
    // Get current camera rotation
    const pitchAmount = Math.sin(player.danceTime * danceSpeed * 1.5) * 0.15; // Tilt up/down
    const yawAmount = Math.cos(player.danceTime * danceSpeed) * 0.3; // Turn left/right
    
    // Apply rotation relative to initial orientation
    // ⚡ OPTIMIZATION: Zero-allocation dance state initialization
    if (isFirstFrame || !player.danceStartRotation) {
        player.danceStartRotation = player.danceStartRotation || { x: 0, y: 0, z: 0 };
        player.danceStartRotation.x = camera.rotation.x;
        player.danceStartRotation.y = camera.rotation.y;
        player.danceStartRotation.z = camera.rotation.z;
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
