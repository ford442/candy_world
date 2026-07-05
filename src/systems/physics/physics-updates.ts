/**
 * physics-updates.ts
 * 
 * Physics calculation and update functions.
 * 
 * - checkFloraDiscovery(): Flora proximity detection
 * - checkHarmonyOrbs(): Collectible orb interactions
 * - checkRetriggerMushrooms(): Strobe effect triggers
 * - checkVibratoViolets(): Frequency distortion fields
 * - checkPortamentoPines(): Slingshot/ramp mechanics
 * - checkSnareTraps(): Knockback trap mechanics
 * - checkGeysers(): Geyser lift mechanics
 * - checkPanningPads(): Bobbing platform mechanics
 * - updateJSFallbackMovement(): JavaScript physics fallback
 * - checkVineAttachment(): Vine swing attachment
 * - initCppPhysics(): C++ engine initialization
 * 
 * No external dependencies on physics-core.ts (avoids circular deps).
 */

import * as THREE from 'three';
import { DISCOVERY_MAP } from '../discovery_map.ts';
import { optimizedDiscovery, checkPlayerDiscovery } from '../discovery-optimized.ts';
import { discoverySystem } from '../discovery.ts';
import { spawnImpact } from '../../foliage/impacts.ts';
import { showToast } from '../../utils/toast.ts';
import { harmonyOrbSystem } from '../../foliage/aurora.ts';
import { addCameraShake } from '../../core/camera-shake.ts';
import { unlockSystem } from '../unlocks.ts';
import { uChromaticIntensity } from '../../foliage/chromatic.ts';
import { uStrobeIntensity } from '../../foliage/strobe.ts';
import {
    initPhysics, uploadObstaclesBatch,
    uploadCollisionObjects, initDynamicFoliageBridge
} from '../../utils/wasm-loader.ts';
import { getGroundHeight, reconcileGroundedEyeY } from '../ground-system.ts';
import { CONFIG } from '../../core/config.ts';
import {
    foliageMushrooms, foliageTrampolines, foliageClouds,
    foliageTraps, foliageGeysers, foliagePortamentoPines,
    foliagePanningPads, animatedFoliage
} from '../../world/state.ts';
import {
    player,
    _scratchPlayerState,
    _scratchCamDir,
    _scratchMoveVec,
    _scratchMatrix,
    KeyStates,
    AudioState,
    _scratchCamRight,
    _scratchTargetVel,
    _scratchUp,
    foliageCaves
} from './physics-types.js';
import {
    calculateMovementInput
} from '../physics.core.js';
import {
    physicsFoliageGrid,
    physicsTrapsGrid,
    physicsGeysersGrid,
    physicsPinesGrid,
    physicsPanningPadsGrid
} from './physics-core.ts';

interface PhysicsSyncObject {
    position?: {
        x?: number;
        y?: number;
        z?: number;
    };
}

function hasFinitePosition(obj: PhysicsSyncObject): boolean {
    const position = obj?.position;
    return Number.isFinite(position?.x) && Number.isFinite(position?.y) && Number.isFinite(position?.z);
}

function filterValidPhysicsObjects<T extends PhysicsSyncObject>(objects: T[] | undefined, label: string): T[] {
    if (!Array.isArray(objects) || objects.length === 0) {
        return [];
    }

    const validObjects: T[] = [];
    for (let i = 0; i < objects.length; i++) {
        if (hasFinitePosition(objects[i])) {
            validObjects.push(objects[i]);
        }
    }

    if (validObjects.length !== objects.length) {
        console.warn(`[Physics] Skipping ${objects.length - validObjects.length} invalid ${label} objects during WASM collision sync.`);
    }
    return validObjects;
}

/**
 * Checks for flora discovery within player proximity.
 */
export function checkFloraDiscovery(playerPos: THREE.Vector3) {
    if (optimizedDiscovery.isUsingWasm()) {
        checkPlayerDiscovery(playerPos);
    } else {
        const DISCOVERY_RADIUS_SQ = 5.0 * 5.0;
        for (let i = 0; i < animatedFoliage.length; i++) {
            const obj = animatedFoliage[i];
            if (!obj.userData || !obj.userData.type) continue;
            const type = obj.userData.type;
            const discoveryInfo = DISCOVERY_MAP[type];
            if (discoveryInfo) {
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
    if (player.velocity.lengthSq() > 400 && Math.random() < 0.3) {
        spawnImpact(player.position, 'trail');
    }
}

/**
 * Harmony orb collection mechanics.
 */
export function checkHarmonyOrbs() {
    const playerPos = player.position;
    const radiusSq = 2.0 * 2.0;
    for (let i = 0; i < harmonyOrbSystem.orbs.length; i++) {
        const orb = harmonyOrbSystem.orbs[i];
        if (!orb.active) continue;
        const dx = orb.position.x - playerPos.x;
        const dy = orb.position.y - playerPos.y;
        const dz = orb.position.z - playerPos.z;
        const distSq = dx*dx + dy*dy + dz*dz;
        if (distSq < radiusSq) {
            orb.active = false;
            harmonyOrbSystem.dummy.position.set(0, -9999, 0);
            harmonyOrbSystem.dummy.scale.setScalar(0);
            _scratchMatrix.compose(harmonyOrbSystem.dummy.position, harmonyOrbSystem.dummy.quaternion, harmonyOrbSystem.dummy.scale);
            _scratchMatrix.toArray(harmonyOrbSystem.mesh.instanceMatrix.array, (i) * 16);
            harmonyOrbSystem.mesh.instanceMatrix.needsUpdate = true;
            spawnImpact(orb.position, 'berry', 0x9933FF);
            unlockSystem.harvest('harmony_orb', 1, 'Harmony Orb');
            if (uChromaticIntensity) {
                uChromaticIntensity.value = Math.max(uChromaticIntensity.value, 0.4);
            }
        }
    }
}

/**
 * Retrigger mushroom strobe effect triggers.
 */
export function checkRetriggerMushrooms(delta: number, audioState: AudioState | null) {
    if (!audioState || !audioState.channelData) return;
    const playerPos = player.position;
    let inStrobeField = false;
    let maxIntensity = 0;

    // ⚡ OPTIMIZATION: Hoisted O(N) audio channel scan outside the spatial query loop
    let isStrobing = false;
    for (const ch of audioState.channelData) {
        if (ch.activeEffect === 5 && ch.effectValue > 0) {
            isStrobing = true;
            break;
        }
    }

    if (isStrobing) {
        const nearbyObjects = physicsFoliageGrid.findNearby(playerPos.x, playerPos.z, 15.0);
        for (let i = 0; i < nearbyObjects.length; i++) {
            const obj = nearbyObjects[i];
            if (obj.userData?.type === 'retrigger_mushroom') {
                const dx = playerPos.x - obj.position.x;
                const dz = playerPos.z - obj.position.z;
                const distSq = dx * dx + dz * dz;
                if (distSq < 15.0 * 15.0) {
                    inStrobeField = true;
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
        if (typeof uStrobeIntensity !== 'undefined' && uStrobeIntensity.value > 0) {
            uStrobeIntensity.value = Math.max(0, uStrobeIntensity.value - delta * 2.0);
        }
    }
}

/**
 * Vibrato violet frequency distortion field effects.
 */
export function checkVibratoViolets(delta: number, audioState: AudioState | null) {
    if (!audioState || !audioState.channelData) return;
    const playerPos = player.position;
    let inDistortionField = false;

    // ⚡ OPTIMIZATION: Hoisted O(N) audio channel scan outside the spatial query loop
    let isVibrating = false;
    for (const ch of audioState.channelData) {
        if (ch.activeEffect === 4 && ch.effectValue > 0) {
            isVibrating = true;
            break;
        }
    }

    if (!isVibrating) return; // Early out if no vibration is active

    const nearbyObjects = physicsFoliageGrid.findNearby(playerPos.x, playerPos.z, 20.0);
    for (let i = 0; i < nearbyObjects.length; i++) {
        const obj = nearbyObjects[i];
        if (obj.userData?.type === 'vibratoViolet') {
            const dx = playerPos.x - obj.position.x;
            const dz = playerPos.z - obj.position.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < 20.0 * 20.0) {
                inDistortionField = true;
                if (typeof uChromaticIntensity !== 'undefined' && uChromaticIntensity.value < 0.3) {
                     uChromaticIntensity.value += delta * 1.5;
                }
                break;
            }
        }
    }
}

/**
 * Portamento pine slingshot/ramp mechanics.
 */
export function checkPortamentoPines(delta: number) {
    const playerPos = player.position;
    const now = performance.now();
    const nearbyPines = physicsPinesGrid.findNearby(playerPos.x, playerPos.z, 5.0);
    for (let i = 0; i < nearbyPines.length; i++) {
        const pine = nearbyPines[i];
        const dx = playerPos.x - pine.position.x;
        const dz = playerPos.z - pine.position.z;
        const distSq = dx*dx + dz*dz;
        const interactRadius = 1.2;
        if (distSq < interactRadius * interactRadius) {
            const dy = playerPos.y - pine.position.y;
            if (dy > 0 && dy < 4.0) {
                const state = pine.userData.reactivityState;
                if (!state) continue;
                const bendDir = _scratchCamDir.set(1, 0, 0).applyQuaternion(pine.quaternion);
                const bend = state.currentBend || 0;
                const pushDir = _scratchMoveVec.set(dx, 0, dz).normalize();
                const pushAlignment = pushDir.dot(bendDir);
                const pushStrength = 60.0;
                state.velocity += pushAlignment * pushStrength * delta;
                if (now - (pine.userData.lastLaunchTime || 0) < 1000) continue;
                if (bend > 0.5) {
                    if (player.velocity.y < 5.0) {
                         player.velocity.y = 25.0 * (Math.abs(bend) / 1.0);
                         player.velocity.addScaledVector(bendDir, 10.0);
                         spawnImpact(playerPos, 'jump');
                         discoverySystem.discover('portamento_pine', 'Portamento Pine', '🌲');
                         player.airJumpsLeft = 1;
                         player.isGrounded = false;
                         pine.userData.lastLaunchTime = now;
                    }
                }
                else if (bend < -0.5) {
                    if (state.velocity > 5.0) {
                         player.velocity.addScaledVector(bendDir, 40.0 * Math.abs(bend));
                         player.velocity.y = 15.0;
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

/**
 * Snare trap knockback mechanics.
 */
export function checkSnareTraps(delta: number) {
    const nearbyTraps = physicsTrapsGrid.findNearby(player.position.x, player.position.z, 5.0);
    for (let i = 0; i < nearbyTraps.length; i++) {
        const trap = nearbyTraps[i];
        const dx = player.position.x - trap.position.x;
        const dz = player.position.z - trap.position.z;
        const distSq = dx * dx + dz * dz;
        const radius = 0.8 * (trap.scale.x || 1.0);
        if (distSq < radius * radius) {
            const dy = player.position.y - trap.position.y;
            if (dy > -0.5 && dy < 1.5) {
                const snapState = trap.userData.snapState || 0;
                if (snapState < 0.2) {
                     trap.userData.snapState = 1.0;
                     spawnImpact(trap.position, 'snare');
                }
                if (trap.userData.snapState > 0.5) {
                     const pushDir = _scratchMoveVec.set(dx, 0, dz).normalize();
                     if (pushDir.lengthSq() === 0) pushDir.set(1, 0, 0);
                     player.velocity.addScaledVector(pushDir, 60.0 * delta * snapState);
                     player.velocity.y = Math.max(player.velocity.y, 15.0 * snapState);
                     player.isGrounded = false;
                     if (Math.random() < 0.2) {
                         if (uChromaticIntensity) uChromaticIntensity.value = 0.8;
                         spawnImpact(player.position, 'snare');
                         addCameraShake(0.6);
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

/**
 * Geyser lift mechanics.
 */
export function checkGeysers(delta: number) {
    const nearbyGeysers = physicsGeysersGrid.findNearby(player.position.x, player.position.z, 5.0);
    for (let i = 0; i < nearbyGeysers.length; i++) {
        const geyser = nearbyGeysers[i];
        const dx = player.position.x - geyser.position.x;
        const dz = player.position.z - geyser.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 2.25) {
             const eruptionStrength = geyser.userData.eruptionStrength || 0;
             const maxHeight = geyser.userData.maxHeight || 5.0;
             const activeHeight = maxHeight * eruptionStrength;
             const baseHeight = 0.5;
             if (player.position.y >= geyser.position.y + baseHeight - 0.5 &&
                 player.position.y <= geyser.position.y + activeHeight + 1.0) {
                  if (eruptionStrength > 0.1) {
                      const targetVel = 15.0 * eruptionStrength;
                      if (player.velocity.y < targetVel) {
                          player.velocity.y += (targetVel - player.velocity.y) * 5.0 * delta;
                      }
                      player.airJumpsLeft = 1;
                      player.isGrounded = false;
                      discoverySystem.discover('kick_drum_geyser', 'Kick-Drum Geyser', '⛲');
                  }
             }
        }
    }
}

/**
 * Panning pad bobbing platform mechanics.
 */
export function checkPanningPads() {
    const nearbyPads = physicsPanningPadsGrid.findNearby(player.position.x, player.position.z, 10.0);
    for (let i = 0; i < nearbyPads.length; i++) {
        const pad = nearbyPads[i];
        const dx = player.position.x - pad.position.x;
        const dz = player.position.z - pad.position.z;
        const distSq = dx*dx + dz*dz;
        const radius = 1.5 * (pad.scale.x || 1.0);
        if (distSq < (radius * radius)) {
             const padY = pad.position.y;
             const topY = padY + (0.1 * (pad.scale.y || 1.0));
             if (player.velocity.y <= 0 &&
                 player.position.y >= topY - 0.2 &&
                 player.position.y <= topY + 0.5) {
                 const currentBob = pad.userData.currentBob || 0;
                 if (currentBob > 0.5) {
                      player.velocity.y = 20.0;
                      player.airJumpsLeft = 1;
                      spawnImpact(pad.position, 'jump');
                      discoverySystem.discover('panning_pad', 'Panning Pad', '🪷');
                 } else {
                      player.position.y = topY;
                      player.velocity.y = 0;
                      player.isGrounded = true;
                 }
                 return;
             }
        }
    }
}

/**
 * JavaScript fallback movement (used for Lake Basin).
 */
export function updateJSFallbackMovement(delta: number, camera: THREE.Camera, controls: any, keyStates: KeyStates, moveSpeed: number) {
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
    const groundY = getGroundHeight(player.position.x, player.position.z);
    const eyeY = groundY + CONFIG.player.eyeHeight;
    const wasGrounded = player.isGrounded;
    if (player.position.y < eyeY && player.velocity.y <= 0) {
        player.position.y = eyeY;
        player.velocity.y = 0;
        player.isGrounded = true;
        if (!wasGrounded) {
             const fallSpeed = Math.abs(player.velocity.y);
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
    } else {
        player.isGrounded = false;
    }

    if (player.isGrounded) {
        const smoothedY = reconcileGroundedEyeY(
            player.position.y,
            player.position.x,
            player.position.z,
            delta,
            { isGrounded: true, velocityY: player.velocity.y }
        );
        if (smoothedY !== player.position.y) {
            player.position.y = smoothedY;
            player.velocity.y = 0;
        }
    }

    if (player.isGrounded && keyStates.jump) {
        player.velocity.y = 8.0;
        player.isGrounded = false;
    }
}

/**
 * Vine attachment detection and handler.
 */
export function checkVineAttachment(camera: THREE.Camera) {
    import('../../world/state.ts').then(vineStateModule => {
        if (!vineStateModule) return;
        const { vineSwings, setActiveVineSwing } = vineStateModule;
        const playerPos = player.position;
        for (const vineManager of vineSwings) {
            if (!vineManager || !vineManager.anchorPoint) continue;
            const anchor = vineManager.anchorPoint;
            if (typeof anchor.x !== 'number' || typeof anchor.y !== 'number' || typeof anchor.z !== 'number') continue;
            const dx = playerPos.x - anchor.x;
            const dz = playerPos.z - anchor.z;
            const distHSq = dx*dx + dz*dz;
            const tipY = anchor.y - (typeof vineManager.length === 'number' ? vineManager.length : 0);
            if (distHSq < 4.0 && playerPos.y < anchor.y && playerPos.y > tipY) {
                 if (distHSq < 1.0) {
                     if (typeof vineManager.attach === 'function') {
                         vineManager.attach(player, player.velocity);
                         setActiveVineSwing(vineManager);
                         break;
                     }
                 }
            }
        }
    });
}

/**
 * Initialize C++ physics engine (one-time setup).
 */
export async function initCppPhysics(camera: THREE.Camera) {
    initPhysics(camera.position.x, camera.position.y, camera.position.z);
    const validMushrooms = filterValidPhysicsObjects(foliageMushrooms, 'mushroom');
    const validClouds = filterValidPhysicsObjects(foliageClouds, 'cloud');
    const validTrampolines = filterValidPhysicsObjects(foliageTrampolines, 'trampoline');
    const totalCount = validMushrooms.length + validClouds.length + validTrampolines.length;
    console.log(`[Physics] Uploading obstacle batch: ${validMushrooms.length} mushrooms, ${validClouds.length} clouds, ${validTrampolines.length} trampolines (total: ${totalCount})`);
    if (totalCount > 0) {
        const batchData = new Float32Array(totalCount * 9);
        let ptr = 0;
        for (const m of validMushrooms) {
            batchData[ptr++] = 0;
            batchData[ptr++] = m.position.x;
            batchData[ptr++] = m.position.y;
            batchData[ptr++] = m.position.z;
            batchData[ptr++] = 0;
            batchData[ptr++] = (m.userData as any).capHeight || 3;
            batchData[ptr++] = (m.userData as any).stemRadius || 0.5;
            batchData[ptr++] = (m.userData as any).capRadius || 2;
            batchData[ptr++] = (m.userData as any).isTrampoline ? 1 : 0;
        }
        for (const c of validClouds) {
            batchData[ptr++] = 1;
            batchData[ptr++] = c.position.x;
            batchData[ptr++] = c.position.y;
            batchData[ptr++] = c.position.z;
            batchData[ptr++] = (c.scale.x || 1) * 2.0;
            batchData[ptr++] = (c.scale.y || 1) * 0.8;
            batchData[ptr++] = 0;
            batchData[ptr++] = (c.userData as any).tier || 1;
            batchData[ptr++] = 0;
        }
        for (const t of validTrampolines) {
            batchData[ptr++] = 2;
            batchData[ptr++] = t.position.x;
            batchData[ptr++] = t.position.y;
            batchData[ptr++] = t.position.z;
            batchData[ptr++] = (t.userData as any).bounceRadius || 0.5;
            batchData[ptr++] = (t.userData as any).bounceHeight || 0.5;
            batchData[ptr++] = (t.userData as any).bounceForce || 12;
            batchData[ptr++] = 0;
            batchData[ptr++] = 0;
        }
        uploadObstaclesBatch(batchData, totalCount);
    } else {
        // Core mode or early startup: no physics obstacles yet — safe to skip batch upload.
        console.log('[Physics] No obstacles to batch-upload (Core mode or empty scene); skipping.');
    }
    initDynamicFoliageBridge(500);
    const { arpeggioFernBatcher } = await import('../../foliage/arpeggio-batcher.ts');
    const validCaves = filterValidPhysicsObjects(foliageCaves, 'cave');
    const rawFerns = Array.isArray(arpeggioFernBatcher.logicFerns) ? arpeggioFernBatcher.logicFerns : [];
    const validFerns = filterValidPhysicsObjects(rawFerns, 'arpeggio fern');
    const fernCount = validFerns.length;
    if (rawFerns.length === 0) {
        console.log('[Physics] Arpeggio fern batcher is empty or uninitialized; skipping dynamic foliage collision sync.');
    }
    if (fernCount > 0) {
        uploadCollisionObjects(validCaves, validMushrooms, validClouds, validTrampolines, validFerns);
    } else {
        // No arpeggio ferns yet (Core mode): upload only structural collision objects.
        uploadCollisionObjects(validCaves, validMushrooms, validClouds, validTrampolines, []);
    }
    console.log('[Physics] Engines Initialized (C++ & ASC).');
}
