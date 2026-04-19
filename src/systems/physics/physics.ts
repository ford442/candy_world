// src/systems/physics/physics.ts
// Main physics orchestrator - delegates to state handlers and abilities
// MIGRATED to TypeScript

import * as THREE from 'three';
import {
    getGroundHeight, initPhysics, uploadObstaclesBatch, setPlayerState, getPlayerState, updatePhysicsCPP,
    uploadCollisionObjects, resolveGameCollisionsWASM
} from '../../utils/wasm-loader.js';
import {
    foliageMushrooms, foliageTrampolines, foliageClouds, vineSwings, animatedFoliage
} from '../../world/state.ts';
import { discoverySystem } from '../discovery.ts';
import { DISCOVERY_MAP } from '../discovery_map.ts';
import { optimizedDiscovery, checkPlayerDiscovery } from '../discovery-optimized.ts';
import {
    calculateMovementInput,
    isInLakeBasin,
    getUnifiedGroundHeightTyped
} from '../physics.core.js';
import { uChromaticIntensity } from '../../foliage/chromatic.ts';
import { uGlitchExplosionCenter, uGlitchExplosionRadius } from '../../foliage/index.ts';
import { spawnImpact } from '../../foliage/impacts.ts';
import { showToast } from '../../utils/toast.js';
import { harmonyOrbSystem } from '../../foliage/aurora.ts';
import { addCameraShake } from '../../main.ts';
import { unlockSystem } from '../unlocks.ts';

// Import from physics modules
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
export type { AudioState, PlayerExtended, KeyStates } from './physics-types.js';

// --- Public API ---

export function grantInvisibility(duration: number) {
    player.isInvisible = true;
    player.invisibilityTimer = duration;
    showToast("Spiritual Camouflage Active! 🦌", "🌟");
    if (uChromaticIntensity) {
        uChromaticIntensity.value = 0.5;
    }
}

export function registerPhysicsCave(cave: THREE.Object3D) {
    foliageCaves.push(cave);
}

export function triggerHarpoon(anchor: THREE.Vector3) {
    // Only trigger if player is swimming (in water)
    if (player.currentState === PlayerState.SWIMMING || player.isUnderwater) {
        player.harpoon.active = true;
        player.harpoon.anchor.copy(anchor);
        showToast("Waveform Harpoon Anchored! ⚓", "🌊");
        discoverySystem.discover('waveform_harpoon', 'Waveform Harpoon', '⚓');
    }
}

// Main Physics Update Loop
export function updatePhysics(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates, audioState: AudioState) {
    // 0. Sync Player State with Camera
    player.position.copy(camera.position);

    // 1. Update Global Environmental Modifiers (Wind, Groove)
    updateEnvironmentalModifiers(delta, audioState);

    // Check if player is within active glitch grenade field
    if (uGlitchExplosionRadius.value > 0) {
        const distSq = player.position.distanceToSquared(uGlitchExplosionCenter.value as THREE.Vector3);
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

    // 🎨 Palette: Sparkle trail when swimming fast
    if (player.velocity.lengthSq() > 400 && Math.random() < 0.3) {
        spawnImpact(player.position, 'trail');
    }
}

// --- State: DEFAULT (Walking/Falling) ---
function updateDefaultState(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates, audioState: AudioState) {
    if (!cppPhysicsInitialized) {
        initCppPhysics(camera);
        setCppPhysicsInitialized(true);
    }

    for (let i = 0; i < vineSwings.length; i++) {
        const v = vineSwings[i];
        import('../../world/state.ts').then(({ activeVineSwing }) => {
            if (v !== activeVineSwing) v.update(player as any, delta, null);
        });
    }

    import('../../world/state.ts').then(({ lastVineDetachTime }) => {
        if (Date.now() - lastVineDetachTime > 500) {
            checkVineAttachment(camera);
        }
    });

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
            effectiveJumpInput,
            keyStates.sprint ? 1 : 0,
            keyStates.sneak ? 1 : 0,
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

    // --- WASM COLLISION RESOLVER (New) ---
    // Try WASM resolution first
    const kickTrigger = audioState?.kickTrigger || 0.0;
    const wasmResolved = resolveGameCollisionsWASM(player, kickTrigger);

    // Check discovery flags based on what happened?
    if (wasmResolved) {
         if (player.velocity.y > 12.0) {
              discoverySystem.discover('trampoline_shroom', 'Trampoline Mushroom', '🍄');
              keyStates.jump = false;

              // 🎨 Palette: Add "Juice" to trampoline mushroom bounce
              spawnImpact(player.position, 'jump');
              addCameraShake(0.3); // 🎨 Palette: Trampoline bounce shake
              if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                  (window as any).AudioSystem.playSound('impact', { pitch: 1.5, volume: 0.8 });
              }
              if (typeof uChromaticIntensity !== 'undefined') {
                  uChromaticIntensity.value = 0.5;
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

// Helper: Initialize C++ obstacles (One-time setup)
function initCppPhysics(camera: THREE.Camera) {
    initPhysics(camera.position.x, camera.position.y, camera.position.z);

    // 1. Upload to C++ Engine (Emscripten) - For Standard Terrain/Obstacles
    const totalCount = foliageMushrooms.length + foliageClouds.length + foliageTrampolines.length;
    if (totalCount > 0) {
        const batchData = new Float32Array(totalCount * 9);
        let ptr = 0;

        for (const m of foliageMushrooms) {
            batchData[ptr++] = 0; // type
            batchData[ptr++] = m.position.x;
            batchData[ptr++] = m.position.y;
            batchData[ptr++] = m.position.z;
            batchData[ptr++] = 0; // r (unused for mushroom here)
            batchData[ptr++] = (m.userData as any).capHeight || 3;
            batchData[ptr++] = (m.userData as any).stemRadius || 0.5;
            batchData[ptr++] = (m.userData as any).capRadius || 2;
            batchData[ptr++] = (m.userData as any).isTrampoline ? 1 : 0;
        }

        for (const c of foliageClouds) {
            batchData[ptr++] = 1; // type
            batchData[ptr++] = c.position.x;
            batchData[ptr++] = c.position.y;
            batchData[ptr++] = c.position.z;
            batchData[ptr++] = (c.scale.x || 1) * 2.0; // r
            batchData[ptr++] = (c.scale.y || 1) * 0.8; // h
            batchData[ptr++] = 0; // p1
            batchData[ptr++] = (c.userData as any).tier || 1; // p2
            batchData[ptr++] = 0; // p3
        }

        for (const t of foliageTrampolines) {
            batchData[ptr++] = 2; // type
            batchData[ptr++] = t.position.x;
            batchData[ptr++] = t.position.y;
            batchData[ptr++] = t.position.z;
            batchData[ptr++] = (t.userData as any).bounceRadius || 0.5; // r
            batchData[ptr++] = (t.userData as any).bounceHeight || 0.5; // h
            batchData[ptr++] = (t.userData as any).bounceForce || 12; // p1
            batchData[ptr++] = 0; // p2
            batchData[ptr++] = 0; // p3
        }

        uploadObstaclesBatch(batchData, totalCount);
    }

    // 2. Upload to AssemblyScript Engine (ASC) - For Narrow Phase Interactivity
    uploadCollisionObjects(foliageCaves, foliageMushrooms, foliageClouds, foliageTrampolines);

    console.log('[Physics] Engines Initialized (C++ & ASC).');
}

// --- Foliage Interactions (check functions moved from original) ---

import {
    foliagePanningPads,
    foliageGeysers,
    foliageTraps,
    foliagePortamentoPines
} from '../../world/state.ts';
import { uStrobeIntensity } from '../../foliage/strobe.ts';

function checkHarmonyOrbs() {
    const playerPos = player.position;
    const radiusSq = 2.0 * 2.0; // 2m collection radius

    for (let i = 0; i < harmonyOrbSystem.orbs.length; i++) {
        const orb = harmonyOrbSystem.orbs[i];
        if (!orb.active) continue;

        const distSq = orb.position.distanceToSquared(playerPos);
        if (distSq < radiusSq) {
            // Collect orb
            orb.active = false;

            // Hide mesh immediately
            harmonyOrbSystem.dummy.position.set(0, -9999, 0);
            harmonyOrbSystem.dummy.scale.setScalar(0);
            _scratchMatrix.compose(harmonyOrbSystem.dummy.position, harmonyOrbSystem.dummy.quaternion, harmonyOrbSystem.dummy.scale);
            // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
            _scratchMatrix.toArray(harmonyOrbSystem.mesh.instanceMatrix.array, (i) * 16);
            harmonyOrbSystem.mesh.instanceMatrix.needsUpdate = true;

            // Visuals & Logic
            spawnImpact(orb.position, 'berry', 0x9933FF);
            unlockSystem.harvest('harmony_orb', 1, 'Harmony Orb');

            if (uChromaticIntensity) {
                uChromaticIntensity.value = Math.max(uChromaticIntensity.value, 0.4);
            }
        }
    }
}

function checkRetriggerMushrooms(delta: number, audioState: AudioState | null) {
    if (!audioState || !audioState.channelData) return;

    const playerPos = player.position;
    let inStrobeField = false;
    let maxIntensity = 0;

    for (const obj of animatedFoliage) {
        if (obj.userData?.type === 'retrigger_mushroom') {
            const dx = playerPos.x - obj.position.x;
            const dz = playerPos.z - obj.position.z;
            const distSq = dx * dx + dz * dz;

            // 15m radius
            if (distSq < 15.0 * 15.0) {
                // Determine if any channel is playing a retrigger effect (5 or 'Rxx')
                let isStrobing = false;
                for (const ch of audioState.channelData) {
                    if (ch.activeEffect === 5 && ch.effectValue > 0) {
                        isStrobing = true;
                        break;
                    }
                }

                if (isStrobing) {
                    inStrobeField = true;
                    // Calculate intensity based on squared distance to avoid Math.sqrt()
                    const localIntensity = 1.0 - (distSq / 225.0);
                    if (localIntensity > maxIntensity) {
                        maxIntensity = localIntensity;
                    }
                }
            }
        }
    }

    if (inStrobeField) {
        if (typeof uStrobeIntensity !== 'undefined') {
            uStrobeIntensity.value = Math.max(uStrobeIntensity.value, maxIntensity * 0.8);
        }
    } else {
        // Decay the strobe intensity rapidly when out of range or not strobing
        if (typeof uStrobeIntensity !== 'undefined' && uStrobeIntensity.value > 0) {
            uStrobeIntensity.value = Math.max(0, uStrobeIntensity.value - delta * 2.0);
        }
    }
}

function checkVibratoViolets(delta: number, audioState: AudioState | null) {
    if (!audioState || !audioState.channelData) return;

    const playerPos = player.position;
    let inDistortionField = false;

    // Check all vibrato violets
    // (Note: They are part of animatedFoliage, we can filter them out)
    for (const obj of animatedFoliage) {
        if (obj.userData?.type === 'vibratoViolet') {
            const dx = playerPos.x - obj.position.x;
            const dz = playerPos.z - obj.position.z;
            const distSq = dx * dx + dz * dz;

            // 20m radius as specified
            if (distSq < 20.0 * 20.0) {
                // Determine if this violet is actively vibrating
                // Vibrato is driven by channel 2 (melody) or channel 3 (chords) with vibrato effect (4xx)
                let isVibrating = false;
                for (const ch of audioState.channelData) {
                    // Check if channel is active and has vibrato effect (4)
                    if (ch.activeEffect === 4 && ch.effectValue > 0) {
                        isVibrating = true;
                        break;
                    }
                }

                if (isVibrating) {
                    inDistortionField = true;
                    // The frequency distortion field causes enemy projectiles to zigzag.
                    // Since we don't have a full enemy system yet, we simulate the distortion
                    // by manipulating the TSL-driven uChromaticIntensity uniform which
                    // drives a full-screen viewport distortion in src/foliage/chromatic.ts.

                    // Apply a sustained, pulsing distortion based on time (delta)
                    // We cap it at 0.3 so it's noticeable but not overwhelming like the Kick pulse
                    if (typeof uChromaticIntensity !== 'undefined' && uChromaticIntensity.value < 0.3) {
                         uChromaticIntensity.value += delta * 1.5;
                    }

                    break; // Only need to be in one field at a time
                }
            }
        }
    }
}

function checkPortamentoPines(delta: number) {
    const playerPos = player.position;
    const now = performance.now();

    for (const pine of foliagePortamentoPines) {
        // Distance check
        const dx = playerPos.x - pine.position.x;
        const dz = playerPos.z - pine.position.z;
        const distSq = dx*dx + dz*dz;
        const interactRadius = 1.2;

        if (distSq < interactRadius * interactRadius) {
            // Height check (Pine is tall, ~4.0m)
            const dy = playerPos.y - pine.position.y;
            if (dy > 0 && dy < 4.0) {
                const state = pine.userData.reactivityState;
                if (!state) continue;

                // 1. Calculate Bend Direction in World Space (Local X axis)
                // Reuse scratch vector safely
                const bendDir = _scratchCamDir.set(1, 0, 0).applyQuaternion(pine.quaternion);

                // Current physical bend amount
                const bend = state.currentBend || 0;

                // 2. Player Push Logic (Bend the tree)
                // Project player-to-pine vector onto Bend Axis
                // Reuse scratch vector safely
                const pushDir = _scratchMoveVec.set(dx, 0, dz).normalize();
                const pushAlignment = pushDir.dot(bendDir); // -1 to 1

                // If player is pushing along the bend axis (e.g. pushing forward), add force
                // Alignment +1 = Pushing towards +X (Bend Positive)
                // Alignment -1 = Pushing towards -X (Bend Negative)

                const pushStrength = 60.0; // Strong enough to fight spring
                state.velocity += pushAlignment * pushStrength * delta;

                // 3. Launch Logic (Slingshot / Ramp)
                // Debounce check
                if (now - (pine.userData.lastLaunchTime || 0) < 1000) continue;

                // RAMP: If bent forward (+X) significantly
                if (bend > 0.5) {
                    // Launch UP
                    // "Forward-leaning ramps launch players vertically."
                    if (player.velocity.y < 5.0) {
                         // Apply Impulse (Instant velocity change)
                         player.velocity.y = 25.0 * (Math.abs(bend) / 1.0); // Minimum 12.5 boost
                         player.velocity.addScaledVector(bendDir, 10.0); // Forward nudge (Instant)

                         // Visuals
                         spawnImpact(playerPos, 'jump');
                         discoverySystem.discover('portamento_pine', 'Portamento Pine', '🌲');

                         player.airJumpsLeft = 1;
                         player.isGrounded = false;
                         pine.userData.lastLaunchTime = now;
                    }
                }

                // SLINGSHOT: If bent Backward (-X) significantly and snapping back
                else if (bend < -0.5) {
                    // Tree is bent Backward (-X). It wants to go to 0 (+Velocity).
                    // If it's moving fast towards 0 (+Velocity > 0), launch player!
                    // "Leaned-back pines act as slingshots"

                    if (state.velocity > 5.0) { // Snapping forward
                        // Launch Forward (+X direction, which is bendDir)
                        // Apply Impulse (Instant velocity change)
                        player.velocity.addScaledVector(bendDir, 40.0 * Math.abs(bend));
                        player.velocity.y = 15.0; // Lift (Instant)

                        spawnImpact(playerPos, 'dash');
                        discoverySystem.discover('portamento_pine', 'Portamento Pine', '🌲');

                        player.airJumpsLeft = 1;
                        player.isGrounded = false;
                        pine.userData.lastLaunchTime = now;
                    }
                }
            }
        }
    }
}

function checkSnareTraps(delta: number) {
    for (const trap of foliageTraps) {
        // Distance Check
        const dx = player.position.x - trap.position.x;
        const dz = player.position.z - trap.position.z;
        const distSq = dx * dx + dz * dz;
        const radius = 0.8 * (trap.scale.x || 1.0); // Approx trigger radius

        if (distSq < radius * radius) {
            // Height Check
            const dy = player.position.y - trap.position.y;
            if (dy > -0.5 && dy < 1.5) { // Inside jaws
                const snapState = trap.userData.snapState || 0;

                // Trigger Logic (If open and player steps inside)
                if (snapState < 0.2) {
                     // Snap Shut!
                     trap.userData.snapState = 1.0;
                     spawnImpact(trap.position, 'snare');
                }

                // If closing or closed (> 0.5)
                // Note: We check current state. If we just triggered it (above), it's 1.0 now.
                if (trap.userData.snapState > 0.5) {
                    // KNOCKBACK
                    // Calculate direction away from trap center
                    // Reuse scratch vector safely
                    const pushDir = _scratchMoveVec.set(dx, 0, dz).normalize();
                    if (pushDir.lengthSq() === 0) pushDir.set(1, 0, 0); // Fallback

                    // Apply impulse (Force = Mass * Accel, but we modify velocity directly)
                    // High force to eject player
                    player.velocity.addScaledVector(pushDir, 60.0 * delta * snapState); // Push horiz
                    player.velocity.y = Math.max(player.velocity.y, 15.0 * snapState); // Launch up

                    // Reset ground state to allow air movement
                    player.isGrounded = false;

                    // Visuals (Throttled?)
                    // Logic runs every frame, so we need to prevent spamming impacts?
                    // But if we launch the player, they leave the zone quickly.
                    if (Math.random() < 0.2) {
                        if (uChromaticIntensity) uChromaticIntensity.value = 0.8;
                        spawnImpact(player.position, 'snare');
                        addCameraShake(0.6); // 🎨 Palette: Trap snap shake
                        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                            (window as any).AudioSystem.playSound('impact', { pitch: 0.4, volume: 1.0 });
                        }
                        showToast("Snared! 🪤", "⚠️");
                    }
                }
            }
        }
    }
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

// --- JS Fallback Movement ---
import {
    _scratchCamRight,
    _scratchTargetVel,
    _scratchUp,
    PLAYER_HEIGHT_OFFSET
} from './physics-types.js';

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
    const groundY = getUnifiedGroundHeightTyped(player.position.x, player.position.z, getGroundHeight);

    const wasGrounded = player.isGrounded;
    if (player.position.y < groundY + PLAYER_HEIGHT_OFFSET && player.velocity.y <= 0) {
        player.position.y = groundY + PLAYER_HEIGHT_OFFSET;
        player.velocity.y = 0;
        player.isGrounded = true;

        if (!wasGrounded) {
             // 🎨 PALETTE: Make JS fallback landing feedback dynamic based on fall velocity too
             const fallSpeed = Math.abs(player.velocity.y);

             if (fallSpeed > 15.0) {
                 spawnImpact(player.position, 'land');
                 spawnImpact(player.position, 'dash');
                 addCameraShake(0.4); // 🎨 Palette: Heavy landing shake
                 if (uChromaticIntensity) uChromaticIntensity.value = 0.8;
                 // 🎨 Palette: Heavy impact audio
                 if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                     (window as any).AudioSystem.playSound('impact', { pitch: 0.6, volume: 1.0 });
                 }
             } else if (fallSpeed > 8.0) {
                 spawnImpact(player.position, 'land');
                 addCameraShake(0.15); // 🎨 Palette: Medium landing shake
                 if (uChromaticIntensity) uChromaticIntensity.value = 0.5;
                 // 🎨 Palette: Medium impact audio
                 if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                     (window as any).AudioSystem.playSound('impact', { pitch: 0.8, volume: 0.7 });
                 }
             } else {
                 spawnImpact(player.position, 'jump');
                 if (uChromaticIntensity) uChromaticIntensity.value = 0.2;
                 // 🎨 Palette: Soft impact audio
                 if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                     (window as any).AudioSystem.playSound('impact', { pitch: 1.2, volume: 0.4 });
                 }
             }
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

// --- Vine Attachment Helper ---
function checkVineAttachment(camera: THREE.Camera) {
    import('../../world/state.ts').then(({ vineSwings, activeVineSwing, setActiveVineSwing }) => {
        const playerPos = player.position;
        for (const vineManager of vineSwings) {
            // SAFETY: Ensure vineManager and anchorPoint exist before accessing properties
            if (!vineManager || !vineManager.anchorPoint) continue;
            const anchor = vineManager.anchorPoint;
            // @ts-ignore
            if (typeof anchor.x !== 'number' || typeof anchor.y !== 'number' || typeof anchor.z !== 'number') continue;

            const dx = playerPos.x - anchor.x;
            const dz = playerPos.z - anchor.z;

            // ⚡ OPTIMIZATION: Use squared distance to avoid expensive Math.sqrt() in a hot loop
            const distHSq = dx*dx + dz*dz;
            const tipY = anchor.y - (typeof vineManager.length === 'number' ? vineManager.length : 0);

            // Compare against squared thresholds (2.0^2 = 4.0, 1.0^2 = 1.0)
            if (distHSq < 4.0 && playerPos.y < anchor.y && playerPos.y > tipY) {
                 if (distHSq < 1.0) {
                     if (typeof vineManager.attach === 'function') {
                         // @ts-ignore
                         vineManager.attach(player, player.velocity);
                         setActiveVineSwing(vineManager);
                         break;
                     }
                 }
            }
        }
    });
}
