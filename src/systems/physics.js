// src/systems/physics.js

import * as THREE from 'three';
import { getGroundHeight } from '../utils/wasm-loader.js';
import {
    foliageMushrooms, foliageTrampolines, foliageClouds,
    activeVineSwing, setActiveVineSwing, lastVineDetachTime, setLastVineDetachTime, vineSwings
} from '../world/state.js';

// Reusable vector for movement calculations
const _targetVelocity = new THREE.Vector3();

export const player = {
    velocity: new THREE.Vector3(),
    speed: 15.0,
    sprintSpeed: 25.0,
    sneakSpeed: 5.0,
    gravity: 20.0,
    energy: 0.0,        // Berry energy (0 to 10)
    maxEnergy: 10.0
};

// Global physics modifiers (from musical ecosystem)
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

function checkMushroomBounce(pos, audioState) {
    for (let i = 0; i < foliageMushrooms.length; i++) {
        const obj = foliageMushrooms[i];
        const dx = pos.x - obj.position.x;
        const dz = pos.z - obj.position.z;

        if (dx * dx + dz * dz < 2.0) {
            const distSq = pos.distanceToSquared(obj.position);
            if (distSq < 5.0) {
                if (player.velocity.y < 0 && pos.y > obj.position.y + 0.5) {
                    const audioIntensity = audioState?.kickTrigger || 0.5;
                    return 15 + audioIntensity * 10;
                }
            }
        }
    }
    return 0;
}

function checkFlowerTrampoline(pos, audioState) {
    for (let i = 0; i < foliageTrampolines.length; i++) {
        const obj = foliageTrampolines[i];
        const dx = pos.x - obj.position.x;
        const dz = pos.z - obj.position.z;
        const bounceTop = obj.position.y + obj.userData.bounceHeight;
        const dy = pos.y - bounceTop;
        const distH = Math.sqrt(dx * dx + dz * dz);
        const radius = obj.userData.bounceRadius || 0.5;

        if (distH < radius && dy > -0.5 && dy < 1.5) {
            if (player.velocity.y < 0) {
                const audioBoost = audioState?.kickTrigger || 0.3;
                const force = obj.userData.bounceForce || 12;

                obj.scale.y = 0.7;
                setTimeout(() => { obj.scale.y = 1.0; }, 100);

                return force + audioBoost * 5;
            }
        }
    }
    return 0;
}

export function updatePhysics(delta, camera, controls, keyStates, audioState) {
    // Collect falling berries (moved here conceptually, but logic can stay in main if preferred.
    // For now, main.js still calls collectFallingBerries separately, we just handle player movement here.)

    // --- Musical Ecosystem: BPM Wind ---
    if (audioState) {
        const currentBPM = audioState.bpm || 120;
        bpmWind.bpm = currentBPM;
        bpmWind.targetStrength = Math.min(1.0, (currentBPM - 60) / 120);

        const currentBeatPhase = audioState.beatPhase || 0;
        const gustPulse = Math.sin(currentBeatPhase * Math.PI * 2) * 0.3;
        bpmWind.targetStrength += gustPulse;

        bpmWind.strength += (bpmWind.targetStrength - bpmWind.strength) * delta * 2;
        bpmWind.strength = Math.max(0, Math.min(1, bpmWind.strength));

        bpmWind.direction.x = Math.sin(Date.now() * 0.0001); // Approx time
        bpmWind.direction.z = Math.cos(Date.now() * 0.0001);
        bpmWind.direction.normalize();
    }

    // --- Musical Ecosystem: Groove Gravity ---
    if (audioState) {
        const groove = audioState.grooveAmount || 0;
        grooveGravity.targetMultiplier = 1.0 - groove * 0.4;
        grooveGravity.multiplier += (grooveGravity.targetMultiplier - grooveGravity.multiplier) * delta;
        player.gravity = grooveGravity.baseGravity * grooveGravity.multiplier;
    }

    // Update Vine Visuals
    vineSwings.forEach(v => {
        if (v !== activeVineSwing) {
            v.update(camera, delta, null);
        }
    });

    if (controls.isLocked) {
        // --- VINE SWINGING LOGIC ---
        if (activeVineSwing) {
            activeVineSwing.update(camera, delta, keyStates);

            if (keyStates.jump) {
                setLastVineDetachTime(activeVineSwing.detach(player));
                setActiveVineSwing(null);
                keyStates.jump = false;
            }
        } else {
            // Check for Vine Attachment
            if (Date.now() - lastVineDetachTime > 500) {
                const playerPos = camera.position;
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

            // Standard Movement
            let moveSpeed = player.speed;
            if (keyStates.sprint) moveSpeed = player.sprintSpeed;
            if (keyStates.sneak) moveSpeed = player.sneakSpeed;

            _targetVelocity.set(0, 0, 0);
            if (keyStates.forward) _targetVelocity.z += moveSpeed;
            if (keyStates.backward) _targetVelocity.z -= moveSpeed;
            if (keyStates.left) _targetVelocity.x -= moveSpeed;
            if (keyStates.right) _targetVelocity.x += moveSpeed;

            if (_targetVelocity.lengthSq() > 0) {
                _targetVelocity.normalize().multiplyScalar(moveSpeed);
            }

            // Apply BPM Wind
            const windEffect = bpmWind.strength * 2.0;
            _targetVelocity.x += bpmWind.direction.x * windEffect;
            _targetVelocity.z += bpmWind.direction.z * windEffect;

            const smoothing = Math.min(1.0, 15.0 * delta);
            player.velocity.x += (_targetVelocity.x - player.velocity.x) * smoothing;
            player.velocity.z += (_targetVelocity.z - player.velocity.z) * smoothing;

            player.velocity.y -= player.gravity * delta;

            if (isNaN(player.velocity.x) || isNaN(player.velocity.z) || isNaN(player.velocity.y)) {
                player.velocity.set(0, 0, 0);
            }

            controls.moveRight(player.velocity.x * delta);
            controls.moveForward(player.velocity.z * delta);
        }

        // --- PHYSICS & COLLISION ---
        if (!activeVineSwing) {
            const groundY = getGroundHeight(camera.position.x, camera.position.z);
            const playerPos = camera.position;

            // 1. Cloud Walking
            let cloudY = -Infinity;
            if (playerPos.y > 15) {
                for (let i = 0; i < foliageClouds.length; i++) {
                    const obj = foliageClouds[i];
                    const dx = playerPos.x - obj.position.x;
                    const dz = playerPos.z - obj.position.z;
                    const distH = Math.sqrt(dx*dx + dz*dz);
                    const radius = (obj.scale.x || 1.0) * 2.0;

                    if (distH < radius) {
                        if (obj.userData.tier === 1) {
                             const topY = obj.position.y + (obj.scale.y || 1.0) * 0.8;
                             if (playerPos.y >= topY - 0.5 && (playerPos.y - topY) < 3.0) {
                                 cloudY = Math.max(cloudY, topY);
                             }
                        } else if (obj.userData.tier === 2) {
                            const bottomY = obj.position.y - 2.0;
                            const topY = obj.position.y + 2.0;
                            if (playerPos.y > bottomY && playerPos.y < topY) {
                                player.velocity.y += 30.0 * delta;
                                if (player.velocity.y > 8.0) player.velocity.y = 8.0;
                            }
                        }
                    }
                }
            }

            // 2. Mushroom Bounce
            const bounce = checkMushroomBounce(playerPos, audioState);
            if (bounce > 0) {
                player.velocity.y = Math.max(player.velocity.y, bounce);
                keyStates.jump = false;
            }

            // 3. Flower Trampoline
            const flowerBounce = checkFlowerTrampoline(playerPos, audioState);
            if (flowerBounce > 0) {
                player.velocity.y = Math.max(player.velocity.y, flowerBounce);
                keyStates.jump = false;
            }

            const safeGroundY = Math.max(isNaN(groundY) ? 0 : groundY, cloudY);

            // Landing
            if (camera.position.y < safeGroundY + 1.8 && player.velocity.y <= 0) {
                camera.position.y = safeGroundY + 1.8;
                player.velocity.y = 0;
                if (keyStates.jump) {
                    const energyBonus = 1 + (player.energy / player.maxEnergy) * 0.5;
                    player.velocity.y = 10 * energyBonus;
                    if (cloudY > groundY) player.velocity.y = 15 * energyBonus;
                }
            } else {
                camera.position.y += player.velocity.y * delta;
            }
        }
    }
}
