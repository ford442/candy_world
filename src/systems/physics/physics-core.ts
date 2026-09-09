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
import { addCameraShake } from '../../core/camera-shake.ts';
import { CONFIG } from '../../core/config.ts';
import { uChromaticIntensity } from '../../foliage/chromatic-nodes.ts';
import { spawnImpact } from '../../foliage/impacts.ts';
import { uGlitchExplosionCenter, uGlitchExplosionRadius } from '../../foliage/index.ts';
import { showToast } from '../../utils/toast.ts';
import {
    initPhysics,
    uploadCollisionObjects,
    resolveGameCollisionsWASM,
    initDynamicFoliageBridge,
    updatePhysicsCPP,
    getPlayerState,
    setPlayerState,
} from '../../utils/wasm-loader.ts';
import {
    foliageMushrooms,
    foliageTrampolines,
    foliageClouds,
    vineSwings,
    animatedFoliage,
    foliageTraps,
    foliageGeysers,
    foliagePortamentoPines,
    foliagePanningPads,
    activeVineSwing,
    lastVineDetachTime,
} from '../../world/state.ts';
import { discoverySystem } from '../discovery.ts';
import { DISCOVERY_MAP } from '../discovery_map.ts';
import { reconcileGroundedEyeY, isInLakeBasin, getGroundHeight, sampleGroundFootprint } from '../ground-system.ts';

const _characterGroundQuery = { sampleFootprint: sampleGroundFootprint, getGroundHeight };
import { calculateMovementInput } from '../physics.core.ts';
import { unlockSystem } from '../unlocks.ts';
import { handleAbilities } from './physics-abilities.ts';
import { resolveCharacterMovement } from './character-controller.ts';


import {
    updateSwimmingState,
    updateVineState,
    updateClimbingState,
    updateDancingState,
    updateStateTransitions,
    updateEnvironmentalModifiers,
} from './physics-states.ts';
import {
    player,
    PlayerState,
    _lastInputState,
    _scratchMoveVec,
    grooveGravity,
    bpmWind,
    foliageCaves,
    setCppPhysicsInitialized,
    cppPhysicsInitialized,
    AudioState,
    KeyStates,
    _scratchPlayerState,
    _scratchTargetVel,
    _scratchCamDir,
    _scratchCamRight,
    _scratchUp,
} from './physics-types.ts';

// Re-export player and types for external use
export { player, PlayerState };
export type { AudioState, KeyStates } from './physics-types.ts';

// --- Lightweight Physics Spatial Grid (⚡ OPTIMIZATION) ---
let _globalQueryId = 0;

export class PhysicsSpatialGrid {
    private cellSize: number;
    private cells: Map<number, any[]>;
    // ⚡ OPTIMIZATION: Reusable array to avoid GC spikes on findNearby
    private _queryResult: any[] = [];

    constructor(cellSize: number) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    private getHash(x: number, z: number): number {
        const cx = Math.floor(x / this.cellSize);
        const cz = Math.floor(z / this.cellSize);
        // Pack into a single numeric key (assuming coordinates don't exceed +/- 32767 chunks)
        // using 16 bits for x and 16 bits for z
        return ((cx & 0xffff) << 16) | (cz & 0xffff);
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
        _globalQueryId++;
        this._queryResult.length = 0;

        const minX = Math.floor((x - radius) / this.cellSize);
        const maxX = Math.floor((x + radius) / this.cellSize);
        const minZ = Math.floor((z - radius) / this.cellSize);
        const maxZ = Math.floor((z + radius) / this.cellSize);

        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const hash = ((cx & 0xffff) << 16) | (cz & 0xffff);
                const cell = this.cells.get(hash);
                if (cell) {
                    for (let i = 0; i < cell.length; i++) {
                        const obj = cell[i];
                        if (obj._gridStamp !== _globalQueryId) {
                            obj._gridStamp = _globalQueryId;
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
export const physicsFoliageGrid = new PhysicsSpatialGrid(30);
export const physicsDiscoveryGrid = new PhysicsSpatialGrid(30);
export const physicsTrapsGrid = new PhysicsSpatialGrid(30);
export const physicsGeysersGrid = new PhysicsSpatialGrid(30);
export const physicsPinesGrid = new PhysicsSpatialGrid(30);
export const physicsPanningPadsGrid = new PhysicsSpatialGrid(30);

/**
 * Populates physics grids from world state.
 * Called during initialization and when world regenerates.
 */
export function populatePhysicsGrids() {
    physicsFoliageGrid.clear();
    physicsDiscoveryGrid.clear();
    physicsTrapsGrid.clear();
    physicsGeysersGrid.clear();
    physicsPinesGrid.clear();
    physicsPanningPadsGrid.clear();

    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i];
        if (obj.userData?.type && DISCOVERY_MAP[obj.userData.type]) {
            physicsDiscoveryGrid.insert(obj);
        }
        if (
            obj.userData?.type === 'retrigger_mushroom' ||
            obj.userData?.type === 'vibratoViolet' ||
            (obj.userData?.type === 'flower' && obj.userData?.animationType === 'batchedCymbal')
        ) {
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
    showToast('Spiritual Camouflage Active! 🦌', '🌟');
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
        showToast('Waveform Harpoon Anchored! ⚓', '🌊');
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
    initCppPhysics,
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
export function updatePhysics(
    delta: number,
    camera: THREE.Camera,
    controls: any,
    keyStates: KeyStates,
    audioState: AudioState
) {
    // 1. Update Global Environmental Modifiers (Wind, Groove)
    updateEnvironmentalModifiers(delta, audioState);

    // Check if player is within active glitch grenade field
    // ⚡ OPTIMIZATION: Faster radius squared check
    const glitchRad = uGlitchExplosionRadius.value;
    if (glitchRad > 0) {
        const center = uGlitchExplosionCenter.value as unknown as THREE.Vector3;
        const dx = player.position.x - center.x;
        const dy = player.position.y - center.y;
        const dz = player.position.z - center.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < glitchRad * glitchRad) {
            // Player is inside the glitch field - grant intangibility/phasing
            if (!player.isPhasing) {
                player.isPhasing = true;
                player.phaseTimer = 0.5; // Short duration, refreshed each frame while inside
            } else {
                // Refresh timer while inside
                if (player.phaseTimer < 0.5) player.phaseTimer = 0.5;
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
 * Movement-path accounting for the default (non-swim/climb/vine) state.
 *
 * The kinematic character controller (#1577) owns the movement resolve on all
 * player-walkable frames. When the native Emscripten module is available,
 * `updatePhysicsCPP` runs only as an obstacle/trampoline assist: TS seeds WASM
 * state, resolves the authoritative kinematic move in JS, then applies only the
 * native correction delta back onto the JS result.
 *
 * These counters make that split visible at runtime through
 * `window.__physicsPathStats`.
 */
export const physicsPathStats = {
    /** Frames whose kinematics were resolved by resolveCharacterMovement (#1577). */
    controller: 0,
    /** Subset of `controller` frames that also used updatePhysicsCPP obstacle/trampoline assist. */
    native: 0,
    /** Subset of `controller` frames that took the JS path because of the Melody Lake basin. */
    lakeBasin: 0,
};

let _warnedNativePathActive = false;

if (typeof window !== 'undefined') {
    (window as any).__physicsPathStats = physicsPathStats;
}

/**
 * Updates physics for the DEFAULT state (walking/falling).
 * Handles C++ physics integration, collision resolution, and foliage interactions.
 */
function updateDefaultState(
    delta: number,
    camera: THREE.Camera,
    controls: any,
    keyStates: KeyStates,
    audioState: AudioState
) {
    if (!cppPhysicsInitialized) {
        initCppPhysics(camera);
        setCppPhysicsInitialized(true);
        console.log('[PhysicsDiag] updateDefaultState: initCppPhysics returned');
    }

    // ⚡ OPTIMIZATION: Caching time to avoid multiple Date.now() calls
    const now = performance.now(); // More precise than Date.now()

    // 5. Check Flora Discovery (Throttled)
    const frameCount = Math.floor(now / 16);
    if (frameCount % 10 === 0) {
        checkFloraDiscovery(player.position);
    }

    // ⚡ OPTIMIZATION: Only update vines if they are somewhat near the player.
    for (let i = 0; i < vineSwings.length; i++) {
        const v = vineSwings[i];
        if (v !== activeVineSwing) {
            // Simple distance check (e.g. 50 units) before calling update to save CPU
            if (v.anchorPoint) {
                const dx = player.position.x - v.anchorPoint.x;
                const dz = player.position.z - v.anchorPoint.z;
                if (dx * dx + dz * dz < 2500) {
                    v.update(player as any, delta, null);
                }
            } else {
                v.update(player as any, delta, null);
            }
        }
    }

    if (now - lastVineDetachTime > 500) {
        checkVineAttachment(camera);
    }

    if (!cppPhysicsInitialized || (window as any).__diagPhysicsCount === undefined) {
        (window as any).__diagPhysicsCount = 1;
        console.log('[PhysicsDiag] updateDefaultState: vines loop finished');
    }

    // --- ABILITIES & MOVEMENT ---
    handleAbilities(delta, camera, keyStates);

    if ((window as any).__diagPhysicsCount === 1) {
        (window as any).__diagPhysicsCount = 2;
        console.log('[PhysicsDiag] updateDefaultState: handleAbilities finished');
    }

    // Update Phase Shift Timer
    if (player.isPhasing) {
        player.phaseTimer -= delta;
        if (player.phaseTimer <= 0) {
            player.isPhasing = false;
            showToast('Phase Shift Ended', '👻');
        }
    }

    // Update Invisibility Timer
    if (player.isInvisible) {
        player.invisibilityTimer -= delta;
        if (player.invisibilityTimer <= 0) {
            player.isInvisible = false;
            showToast('Camouflage Faded', '💨');
        }
    }

    // Decay Chromatic Pulse (Hack for now, ideally moved to a proper FX system)
    // If Phasing, keep intensity high
    if (player.isPhasing) {
        if (uChromaticIntensity) uChromaticIntensity.value = 0.8 + Math.sin(now * 0.01) * 0.1;
    } else {
        if (uChromaticIntensity && uChromaticIntensity.value > 0) {
            uChromaticIntensity.value = Math.max(0, uChromaticIntensity.value - delta * 2.0);
        }
    }

    const inLakeBasin = isInLakeBasin(player.position.x, player.position.z);
    let onGround = -1;
    if (inLakeBasin) physicsPathStats.lakeBasin++;
    const effectiveJumpInput = keyStates.jump ? 1 : 0;
    const { moveVec: moveInput, moveSpeed: baseMoveSpeed } = calculateMovementInput(
        camera,
        keyStates,
        player
    );
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

    // --- BPM Wind Player Impact ---
    const hasWindAnchor = unlockSystem.isUnlocked('wind_anchor');
    let windForceX = 0;
    let windForceZ = 0;
    if (!hasWindAnchor && bpmWind.strength > 0) {
        const windPushForce = 25.0;
        windForceX = bpmWind.direction.x * bpmWind.strength * windPushForce * delta;
        windForceZ = bpmWind.direction.z * bpmWind.strength * windPushForce * delta;
    } else if (hasWindAnchor && bpmWind.strength > 0.5) {
        discoverySystem.discover('wind_anchor', 'Wind Anchor', '⚓');
    }

    if ((window as any).__diagPhysicsCount === 2) {
        (window as any).__diagPhysicsCount = 3;
        console.log(
            '[PhysicsDiag] updateDefaultState: Calling updatePhysicsCPP (LakeBasin=' +
                inLakeBasin +
                ')'
        );
    }

    // Calculate target velocity based on input (formerly in updateJSFallbackMovement)
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

    if (!inLakeBasin) {
        // Seed WASM state synchronously before running C++ update
        setPlayerState(player.position.x, player.position.y, player.position.z, player.velocity.x, player.velocity.y, player.velocity.z);

        const preX = player.position.x;
        const preZ = player.position.z;

        // 3. updatePhysicsCPP(..., jump = false) as obstacle/trampoline solver only
        onGround = updatePhysicsCPP(
            delta,
            _targetVelocity.x,
            _targetVelocity.z,
            moveSpeed,
            false, // jump=false to prevent C++ from firing vy=10
            keyStates.sprint,
            keyStates.sneak,
            grooveGravity.multiplier
        );

        if (onGround >= 0) {
            physicsPathStats.native++;
            if (!_warnedNativePathActive) {
                _warnedNativePathActive = true;
                console.log(
                    '[Physics] Native obstacle/trampoline assist active; JS character controller remains authoritative.'
                );
            }

            getPlayerState(_scratchPlayerState);

            // Extract the C++ obstacle-constrained displacement as the new target velocity
            // This isolates the C++ collision sliding while letting TS own kinematic acceleration
            _targetVelocity.x = (_scratchPlayerState.x - preX) / delta;
            _targetVelocity.z = (_scratchPlayerState.z - preZ) / delta;

            if (onGround === 2) {
                player.velocity.y = _scratchPlayerState.vy;
                player.isGrounded = false;
            }
        }
    }

    // Now TS controller owns the movement resolve for BOTH paths!
    physicsPathStats.controller++;
    const jumpTriggered = keyStates.jump && !_lastInputState.jump;
    const outcome = resolveCharacterMovement(
        delta,
        player,
        _targetVelocity,
        keyStates.jump,
        jumpTriggered,
        _characterGroundQuery
    );

    // Apply wind forces
    player.position.x += windForceX;
    player.position.z += windForceZ;

    // Handle landing FX (formerly in updateJSFallbackMovement)
    if (outcome.justLanded) {
        const fallSpeed = outcome.fallSpeed;
        if (fallSpeed > 15.0) {
            spawnImpact(player.position, 'land');
            spawnImpact(player.position, 'dash');
            addCameraShake(0.4);
            if (uChromaticIntensity) uChromaticIntensity.value = 0.8;
            if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                (window as any).AudioSystem.playSound('impact', { pitch: 0.6, volume: 1.0 });
            }
        } else if (fallSpeed > 8.0) {
            spawnImpact(player.position, 'land');
            addCameraShake(0.15);
            if (uChromaticIntensity) uChromaticIntensity.value = 0.5;
            if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                (window as any).AudioSystem.playSound('impact', { pitch: 0.8, volume: 0.7 });
            }
        } else {
            spawnImpact(player.position, 'jump');
            if (uChromaticIntensity) uChromaticIntensity.value = 0.2;
            if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                (window as any).AudioSystem.playSound('impact', { pitch: 1.2, volume: 0.4 });
            }
        }
    }

    // Reset jump key if we successfully jumped
    if (player.velocity.y > 0 && player.isGrounded) {
        keyStates.jump = false;
        spawnImpact(player.position, 'jump');
        // 🎨 Palette: Audio feedback for jump
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
            (window as any).AudioSystem.playSound('jump', {
                pitch: Math.random() * 0.2 + 0.9,
                volume: 0.5,
            });
        }
        if (typeof uChromaticIntensity !== 'undefined') {
            uChromaticIntensity.value = 0.2;
        }
    }
    if ((window as any).__diagPhysicsCount === 4) {
        (window as any).__diagPhysicsCount = 5;
        console.log('[PhysicsDiag] updateDefaultState: Reconcile Y begin');
    }

    // Issue #1265: Reconcile C++ / fallback Y with the authoritative ground query.
    // Smoothly tracks terrain when grounded; preserves platform elevation when high.
    if (player.isGrounded || player.velocity.y <= 0) {
        const prevY = player.position.y;
        const nextY = reconcileGroundedEyeY(prevY, player.position.x, player.position.z, delta, {
            isGrounded: player.isGrounded,
            velocityY: player.velocity.y,
        });
        if (nextY !== prevY) {
            player.position.y = nextY;
            if (player.isGrounded) {
                player.velocity.y = 0;
            }
        }
    }

    if ((window as any).__diagPhysicsCount === 5) {
        (window as any).__diagPhysicsCount = 6;
        console.log('[PhysicsDiag] updateDefaultState: WASM collision resolver begin');
    }

    // --- WASM COLLISION RESOLVER (New) ---
    // Try WASM resolution first
    const kickTrigger = audioState?.kickTrigger || 0.0;
    let wasmResolved = false;
    try {
        wasmResolved = resolveGameCollisionsWASM(player, kickTrigger);
    } catch (e) {
        console.error('[PhysicsDiag] WASM crash', e);
    }

    if ((window as any).__diagPhysicsCount === 6) {
        (window as any).__diagPhysicsCount = 7;
        console.log('[PhysicsDiag] updateDefaultState: WASM collision resolver returned');
    }

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
                (window as any).AudioSystem.playSound('impact', {
                    pitch: 1.2 + noteStrength * 0.6,
                    volume: 0.8,
                });
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

    if ((window as any).__diagPhysicsCount === 7) {
        (window as any).__diagPhysicsCount = 8;
        console.log('[PhysicsDiag] updateDefaultState: Entering JS physics checks');
    }
    // Platform-preservation: reconcile Y after WASM; skips elevated platforms internally.
    if (player.isGrounded && player.velocity.y <= 0) {
        const prevY = player.position.y;
        const nextY = reconcileGroundedEyeY(prevY, player.position.x, player.position.z, delta, {
            isGrounded: player.isGrounded,
            velocityY: player.velocity.y,
        });
        if (nextY !== prevY) {
            player.position.y = nextY;
            player.velocity.y = 0;
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

    if ((window as any).__diagPhysicsCount === 8) {
        (window as any).__diagPhysicsCount = 9;
        console.log('[PhysicsDiag] updateDefaultState: FINISHED ENTIRELY');
    }
}
