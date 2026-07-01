/**
 * physics-core.ts
 * 
 * Core physics orchestration and spatial grid implementation.
 * 
 * - PhysicsSpatialGrid: Lightweight spatial partitioning for collision queries
 * - populatePhysicsGrids(): Maintains grid state from world foliage
 * - updatePhysics(): Main physics loop orchestrator
 * - Ability functions: grantInvisibility, registerPhysicsCave, triggerHarpoon
 * 
 * Dependencies:
 * - physics-types.ts: Player state and types
 * - physics-states.ts: State machine handlers (swimming, climbing, dancing, etc.)
 * - physics-abilities.js: Ability system
 * - physics-updates.ts: Individual check* functions (imported by updatePhysics)
 * 
 * No circular dependencies. Depends on other modules but is not depended upon.
 */

import * as THREE from 'three';

import {
    foliageMushrooms, foliageTrampolines, foliageClouds, vineSwings, animatedFoliage,
    foliageTraps, foliageGeysers, foliagePortamentoPines, foliagePanningPads,
    activeVineSwing, lastVineDetachTime
} from '../../world/state.ts';
import { discoverySystem } from '../discovery.ts';
import { uChromaticIntensity } from '../../foliage/chromatic.ts';
import { uGlitchExplosionCenter, uGlitchExplosionRadius } from '../../foliage/index.ts';
import { spawnImpact } from '../../foliage/impacts.ts';
import { showToast } from '../../utils/toast.ts';
import { addCameraShake } from '../../core/camera-shake.ts';
import { unlockSystem } from '../unlocks.ts';
import {
    calculateMovementInput
} from '../physics.core.js';
import { CONFIG } from '../../core/config.ts';
import { isInLakeBasin, reconcileGroundedEyeY } from '../ground-system.ts';
import {
    initPhysics, uploadObstaclesBatch, setPlayerState, getPlayerState, updatePhysicsCPP,
    uploadCollisionObjects, resolveGameCollisionsWASM, initDynamicFoliageBridge
} from '../../utils/wasm-loader.ts';

import { 
    player, 
    PlayerState,
    _lastInputState,
    _scratchPlayerState,
    _scratchCamDir,
    _scratchMoveVec,
    grooveGravity,
    bpmWind,
    foliageCaves,
    setCppPhysicsInitialized,
    _scratchMatrix,
    cppPhysicsInitialized,
    AudioState,
    KeyStates
} from './physics-types.js';

import {
    updateSwimmingState,
    updateVineState,
    updateClimbingState,
    updateDancingState,
    updateStateTransitions,
    updateEnvironmentalModifiers
} from './physics-states.js';

import { handleAbilities } from './physics-abilities.js';

// Re-export player and types for external use
export { player, PlayerState };
export type { AudioState, KeyStates } from './physics-types.js';

// --- Lightweight Physics Spatial Grid (⚡ OPTIMIZATION) ---
export class PhysicsSpatialGrid {
    private cellSize: number;
    private cells: Map<string, any[]>;
    // ⚡ OPTIMIZATION: Reusable array to avoid GC spikes on findNearby
    private _queryResult: any[] = [];
    private _querySet: Set<any> = new Set();

    constructor(cellSize: number) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    private getHash(x: number, z: number): string {
        return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
    }

    insert(obj: any): void {
        if (!obj || !obj.position) return;
        const hash = this.getHash(obj.position.x, obj.position.z);
        let cell = this.cells.get(hash);
        if (!cell) {
            cell = [];
            this.cells.set(hash, cell);
        }
        cell.push(obj);
    }

    clear(): void {
        this.cells.clear();
    }

    findNearby(x: number, z: number, radius: number): any[] {
        this._queryResult.length = 0;
        this._querySet.clear();

        const minX = Math.floor((x - radius) / this.cellSize);
        const maxX = Math.floor((x + radius) / this.cellSize);
        const minZ = Math.floor((z - radius) / this.cellSize);
        const maxZ = Math.floor((z + radius) / this.cellSize);

        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const hash = `${cx},${cz}`;
                const cell = this.cells.get(hash);
                if (cell) {
                    for (let i = 0; i < cell.length; i++) {
                        const obj = cell[i];
                        if (!this._querySet.has(obj)) {
                            this._querySet.add(obj);
                            this._queryResult.push(obj);
                        }
                    }
                }
            }
        }
        return this._queryResult;
    }
}

// Global grids for different collision types
export const physicsFoliageGrid = new PhysicsSpatialGrid(20);
export const physicsTrapsGrid = new PhysicsSpatialGrid(20);
export const physicsGeysersGrid = new PhysicsSpatialGrid(20);
export const physicsPinesGrid = new PhysicsSpatialGrid(20);
export const physicsPanningPadsGrid = new PhysicsSpatialGrid(20);

/**
 * Populates physics grids from world state.
 * Called during initialization and when world regenerates.
 */
export function populatePhysicsGrids() {
    physicsFoliageGrid.clear();
    physicsTrapsGrid.clear();
    physicsGeysersGrid.clear();
    physicsPinesGrid.clear();
    physicsPanningPadsGrid.clear();

    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i];
        if (obj.userData?.type === 'retrigger_mushroom' || obj.userData?.type === 'vibratoViolet' || (obj.userData?.type === 'flower' && obj.userData?.animationType === 'batchedCymbal')) {
            physicsFoliageGrid.insert(obj);
        }
    }
    for (let i = 0; i < foliageTraps.length; i++) {
        physicsTrapsGrid.insert(foliageTraps[i]);
    }
    for (let i = 0; i < foliageGeysers.length; i++) {
        physicsGeysersGrid.insert(foliageGeysers[i]);
    }
    for (let i = 0; i < foliagePortamentoPines.length; i++) {
        physicsPinesGrid.insert(foliagePortamentoPines[i]);
    }
    for (let i = 0; i < foliagePanningPads.length; i++) {
        physicsPanningPadsGrid.insert(foliagePanningPads[i]);
    }
}

/**
 * Grants player invisibility for a duration.
 * @param duration - Duration of invisibility in seconds
 */
export function grantInvisibility(duration: number) {
    player.isInvisible = true;
    player.invisibilityTimer = duration;
    showToast("Spiritual Camouflage Active! 🦌", "🌟");
    if (uChromaticIntensity) {
        uChromaticIntensity.value = 0.5;
    }
}

/**
 * Registers a cave object for physics interaction.
 * @param cave - The cave mesh to register
 */
export function registerPhysicsCave(cave: THREE.Object3D) {
    foliageCaves.push(cave);
}

/**
 * Triggers harpoon mechanics when player is swimming.
 * @param anchor - The target anchor point
 */
export function triggerHarpoon(anchor: THREE.Vector3) {
    // Only trigger if player is swimming (in water)
    if (player.currentState === PlayerState.SWIMMING || player.isUnderwater) {
        player.harpoon.active = true;
        player.harpoon.anchor.copy(anchor);
        showToast("Waveform Harpoon Anchored! ⚓", "🌊");
        discoverySystem.discover('waveform_harpoon', 'Waveform Harpoon', '⚓');
    }
}

// Import check* functions from physics-updates
import {
    checkFloraDiscovery,
    checkHarmonyOrbs,
    checkRetriggerMushrooms,
    checkVibratoViolets,
    checkPortamentoPines,
    checkSnareTraps,
    checkGeysers,
    checkPanningPads,
    checkVineAttachment,
    initCppPhysics
} from './physics-updates.ts';

/**
 * Main physics update loop.
 * Orchestrates state transitions, ability handling, and collision checks.
 * @param delta - Time delta in seconds
 * @param camera - Active camera
 * @param controls - Player controls
 * @param keyStates - Current key states
 * @param audioState - Audio state for reactivity
 */
export function updatePhysics(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates, audioState: AudioState) {
    // 1. Update Global Environmental Modifiers (Wind, Groove)
    updateEnvironmentalModifiers(delta, audioState);

    // Check if player is within active glitch grenade field
    if (uGlitchExplosionRadius.value > 0) {

        const center = uGlitchExplosionCenter.value as THREE.Vector3;
        const dx = player.position.x - center.x;
        const dy = player.position.y - center.y;
        const dz = player.position.z - center.z;
        const distSq = dx*dx + dy*dy + dz*dz;

        const radiusSq = uGlitchExplosionRadius.value * uGlitchExplosionRadius.value;
        if (distSq < radiusSq) {
            // Player is inside the glitch field - grant intangibility/phasing
            if (!player.isPhasing) {
                player.isPhasing = true;
                player.phaseTimer = 0.5; // Short duration, refreshed each frame while inside
            } else {
                // Refresh timer while inside
                player.phaseTimer = Math.max(player.phaseTimer, 0.5);
            }
        }
    }

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
            updateSwimmingState(delta, camera, controls, keyStates, audioState);
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
    _lastInputState.dodgeRoll = keyStates.dodgeRoll;
    _lastInputState.dance = keyStates.dance;
    _lastInputState.phase = keyStates.phase;
    _lastInputState.clap = keyStates.clap;
    _lastInputState.forward = keyStates.forward;

    // 5. Check Flora Discovery (Throttled)
    const frameCount = Math.floor(Date.now() / 16);
    if (frameCount % 10 === 0) {
        checkFloraDiscovery(player.position);
    }

    // Sync back
    camera.position.x = player.position.x;
    camera.position.z = player.position.z;
    // 🎨 PALETTE: Smooth vertical tracking (LERP) for better game feel
    const targetY = player.position.y;
    const lerpSpeed = CONFIG.ground.followLerpSpeed;
    const maxStep = CONFIG.ground.followMaxStep;
    let nextY = THREE.MathUtils.lerp(camera.position.y, targetY, Math.min(delta * lerpSpeed, 1.0));
    nextY = THREE.MathUtils.clamp(nextY, camera.position.y - maxStep, camera.position.y + maxStep);
    camera.position.y = nextY;
}

// --- State: DEFAULT (Walking/Falling) ---
/**
 * Updates physics for the DEFAULT state (walking/falling).
 * Handles C++ physics integration, collision resolution, and foliage interactions.
 */
function updateDefaultState(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates, audioState: AudioState) {
    if (!cppPhysicsInitialized) {
        initCppPhysics(camera);
        setCppPhysicsInitialized(true);
    }

    for (let i = 0; i < vineSwings.length; i++) {
        const v = vineSwings[i];
        if (v !== activeVineSwing) v.update(player as any, delta, null);
    }

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

    // Update Invisibility Timer
    if (player.isInvisible) {
        player.invisibilityTimer -= delta;
        if (player.invisibilityTimer <= 0) {
            player.isInvisible = false;
            showToast("Camouflage Faded", "💨");
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

    const { moveVec: moveInput, moveSpeed: baseMoveSpeed } = calculateMovementInput(camera, keyStates, player);
    let moveSpeed = baseMoveSpeed;

    // --- Groove Boots Logic ---
    const hasGrooveBoots = unlockSystem.isUnlocked('groove_boots');
    // If we have groove boots AND groove gravity is significantly active (< 0.95)
    if (hasGrooveBoots && grooveGravity.multiplier < 0.95) {
        // Boost speed based on how strong the groove is (lower multiplier = stronger groove)
        const grooveBoost = 1.0 + (1.0 - grooveGravity.multiplier); // e.g., 0.8 -> 1.2x speed
        moveSpeed *= grooveBoost;

        // Visual/Audio Feedback could be added here periodically or when moving fast
        if (player.isGrounded && moveInput.lengthSq() > 0 && Math.random() < 0.05) {
             spawnImpact(player.position, 'dash'); // Sparkles at feet
        }
        discoverySystem.discover('groove_boots', 'Groove Boots', '🥾');
    }

    // 🎨 Palette: Sparkle trail when moving fast (Dash / Sprint / Fall)
    if (player.velocity.lengthSq() > 400 && Math.random() < 0.3) {
        spawnImpact(player.position, 'trail');
    }

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

    // --- BPM Wind Player Impact ---
    const hasWindAnchor = unlockSystem.isUnlocked('wind_anchor');
    let windForceX = 0;
    let windForceZ = 0;
    if (!hasWindAnchor && bpmWind.strength > 0) {
        // Apply wind force scaled by strength
        // The strength ranges [0, 1]. Apply a constant push velocity.
        const windPushForce = 25.0; // units/sec max
        windForceX = bpmWind.direction.x * bpmWind.strength * windPushForce * delta;
        windForceZ = bpmWind.direction.z * bpmWind.strength * windPushForce * delta;
    } else if (hasWindAnchor && bpmWind.strength > 0.5) {
        discoverySystem.discover('wind_anchor', 'Wind Anchor', '⚓');
    }

    if (!inLakeBasin) {
        onGround = updatePhysicsCPP(
            delta,
            moveInput.x,
            moveInput.z,
            moveSpeed,
            effectiveJumpInput > 0,
            keyStates.sprint,
            keyStates.sneak,
            grooveGravity.multiplier
        );
    }

    if (onGround >= 0) {
        // C++ Success
        getPlayerState(_scratchPlayerState);
        player.position.set(_scratchPlayerState.x + windForceX, _scratchPlayerState.y, _scratchPlayerState.z + windForceZ);
        player.velocity.set(_scratchPlayerState.vx, _scratchPlayerState.vy, _scratchPlayerState.vz);

        // Reset jump key if we successfully jumped (velocity.y > 0)
        // But only if we were grounded before (normal jump)
        if (player.velocity.y > 0 && player.isGrounded) {
             keyStates.jump = false;
             spawnImpact(player.position, 'jump');
             // 🎨 Palette: Audio feedback for jump
             if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                 (window as any).AudioSystem.playSound('jump', { pitch: Math.random() * 0.2 + 0.9, volume: 0.5 });
             }
             if (typeof uChromaticIntensity !== 'undefined') {
                 uChromaticIntensity.value = 0.2;
             }
        }

        const wasGrounded = player.isGrounded;
        player.isGrounded = (onGround === 1);

        if (!wasGrounded && player.isGrounded && player.velocity.y < -1.0) {
            // 🎨 PALETTE: Make landing feedback dynamic based on fall velocity
            const fallSpeed = Math.abs(player.velocity.y);

            if (fallSpeed > 15.0) {
                // Hard fall -> Big splash, heavy screen distortion
                spawnImpact(player.position, 'land');
                spawnImpact(player.position, 'dash'); // Extra particles
                addCameraShake(0.4); // 🎨 Palette: Heavy landing shake
                if (uChromaticIntensity) uChromaticIntensity.value = 0.8;
                // 🎨 Palette: Heavy impact audio
                if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                    (window as any).AudioSystem.playSound('impact', { pitch: 0.6, volume: 1.0 });
                }
            } else if (fallSpeed > 8.0) {
                // Medium fall
                spawnImpact(player.position, 'land');
                addCameraShake(0.15); // 🎨 Palette: Medium landing shake
                if (uChromaticIntensity) uChromaticIntensity.value = 0.5;
                // 🎨 Palette: Medium impact audio
                if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                    (window as any).AudioSystem.playSound('impact', { pitch: 0.8, volume: 0.7 });
                }
            } else {
                // Soft landing
                spawnImpact(player.position, 'jump'); // Lighter particle burst
                if (uChromaticIntensity) uChromaticIntensity.value = 0.2;
                // 🎨 Palette: Soft impact audio
                if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                    (window as any).AudioSystem.playSound('impact', { pitch: 1.2, volume: 0.4 });
                }
            }
        }
    } else {
        // JS Fallback (Used for Lake Basin or C++ Failure)
        updateJSFallbackMovement(delta, camera, controls, keyStates, moveSpeed);
        player.position.x += windForceX;
        player.position.z += windForceZ;
    }

    // Issue #1265: Reconcile C++ / fallback Y with the authoritative ground query.
    // Smoothly tracks terrain when grounded; preserves platform elevation when high.
    if (player.isGrounded || player.velocity.y <= 0) {
        const prevY = player.position.y;
        const nextY = reconcileGroundedEyeY(
            prevY,
            player.position.x,
            player.position.z,
            delta,
            { isGrounded: player.isGrounded, velocityY: player.velocity.y }
        );
        if (nextY !== prevY) {
            player.position.y = nextY;
            if (player.isGrounded) {
                player.velocity.y = 0;
            }
        }
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

              // --- VERTICAL ECOSYSTEM: Audio-Reactive Mushroom Bounce ---
              // Scale bounce height with current kick strength / note energy
              const kick = audioState?.kickTrigger || 0;
              const noteStrength = audioState?.noteVelocity || kick;
              const bounceMultiplier = 1.0 + noteStrength * 0.8; // 1.0x - 1.8x
              player.velocity.y *= bounceMultiplier;

              // 🎨 Palette: Add "Juice" to trampoline mushroom bounce
              spawnImpact(player.position, 'jump');
              addCameraShake(0.3 * bounceMultiplier); // 🎨 Palette: Trampoline bounce shake
              if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                  (window as any).AudioSystem.playSound('impact', { pitch: 1.2 + noteStrength * 0.6, volume: 0.8 });
              }
              if (typeof uChromaticIntensity !== 'undefined') {
                  uChromaticIntensity.value = 0.5 * bounceMultiplier;
              }
         }
         // Check if we landed on a cloud (isGrounded=true at High Y)
         if (player.isGrounded && player.position.y > 10.0) {
              discoverySystem.discover('cloud_platform', 'Solid Cloud', '☁️');
         }
    }

    // --- Panning Pads (JS Physics) --
    // Explicit check for dynamic panning pads (bobbing platforms)
    checkPanningPads();

    // --- Kick-Drum Geysers (Riding the Plume) ---
    checkGeysers(delta);

    // --- Snare Traps (Knockback) ---
    checkSnareTraps(delta);

    // --- Portamento Pines (Slingshot/Ramp) ---
    checkPortamentoPines(delta);

    // --- Vibrato Violets (Frequency Distortion Field) ---
    checkVibratoViolets(delta, audioState);

    // --- Retrigger Mushrooms (Strobe Sickness HUD Flicker) ---
    checkRetriggerMushrooms(delta, audioState);

    // --- Harmony Orbs (Collection) ---
    checkHarmonyOrbs();
}
