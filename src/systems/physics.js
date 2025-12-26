// src/systems/physics.js

import * as THREE from 'three';
import {
    getGroundHeight, initPhysics, addObstacle, setPlayerState, getPlayerState, updatePhysicsCPP
} from '../utils/wasm-loader.js';
import {
    foliageMushrooms, foliageTrampolines, foliageClouds,
    activeVineSwing, setActiveVineSwing, lastVineDetachTime, setLastVineDetachTime, vineSwings
} from '../world/state.js';

// Reusable vector for movement calculations
const _targetVelocity = new THREE.Vector3();
const PLAYER_RADIUS = 0.5; // Approximate width of player capsule

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

// --- Flag to track if C++ Physics is ready ---
let cppPhysicsInitialized = false;

// Initialize C++ physics state once
function initCppPhysics(camera) {
    if (cppPhysicsInitialized) return;

    // Set initial player state
    initPhysics(camera.position.x, camera.position.y, camera.position.z);

    // Populate Obstacles
    // Mushrooms (Type 0)
    for (const m of foliageMushrooms) {
        // type=0, x,y,z, stemR, capH, stemR(param1), capR(param2), isTrampoline(param3)
        // Note: Our C++ addObstacle signature: type, x, y, z, r, h, p1, p2, p3
        // C++:
        // Mushroom(0): r=unused?, h=capH, p1=stemR, p2=capR, p3=isTrampoline
        const stemR = m.userData.stemRadius || 0.5;
        const capR = m.userData.capRadius || 2.0;
        const capH = m.userData.capHeight || 3.0;
        const isTrampoline = m.userData.isTrampoline ? 1 : 0;
        addObstacle(0, m.position.x, m.position.y, m.position.z, 0, capH, stemR, capR, isTrampoline);
    }

    // Clouds (Type 1)
    for (const c of foliageClouds) {
        // type=1, x,y,z, radius, thickness(h), tier(p2)
        const radius = (c.scale.x || 1.0) * 2.0;
        const tier = c.userData.tier || 1;
        // height? Clouds are roughly flat but have volume. Let's say thickness 1.0
        const thickness = (c.scale.y || 1.0) * 0.8;
        addObstacle(1, c.position.x, c.position.y, c.position.z, radius, thickness, 0, tier, 0);
    }

    // Trampolines (Type 2)
    for (const t of foliageTrampolines) {
        // type=2, x,y,z, radius, bounceHeight(h), bounceForce(p1)
        const radius = t.userData.bounceRadius || 0.5;
        const bounceHeight = t.userData.bounceHeight || 0.5;
        const force = t.userData.bounceForce || 12.0;
        addObstacle(2, t.position.x, t.position.y, t.position.z, radius, bounceHeight, force, 0, 0);
    }

    cppPhysicsInitialized = true;
    console.log('[Physics] C++ Physics Initialized with obstacles.');
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

// @perf-migrate {target: "cpp", reason: "collision-heavy-simd", threshold: "8ms", note: "Requires spatial hashing before migration"}
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
        // "Groove" usually comes from beatSync or manual groove detection
        // Assuming audioState has grooveAmount normalized 0..1
        const groove = audioState.grooveAmount || 0;

        // When groove is high, gravity decreases slightly to give a "floaty" dance feel
        // E.g. 1.0 -> 0.6
        grooveGravity.targetMultiplier = 1.0 - (groove * 0.4);

        // Smoothly interpolate
        grooveGravity.multiplier += (grooveGravity.targetMultiplier - grooveGravity.multiplier) * delta * 5.0;

        // Apply to player gravity
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

            // --- TRY C++ PHYSICS ---
            if (!cppPhysicsInitialized) {
                 initCppPhysics(camera);
            }

            let inputX = 0;
            let inputZ = 0;

            let moveSpeed = player.speed;
            if (keyStates.sprint) moveSpeed = player.sprintSpeed;
            if (keyStates.sneak) moveSpeed = player.sneakSpeed;

            if (keyStates.forward) inputZ += 1;
            if (keyStates.backward) inputZ -= 1;
            if (keyStates.left) inputX -= 1;
            if (keyStates.right) inputX += 1;

            // Normalize input
            const len = Math.sqrt(inputX*inputX + inputZ*inputZ);
            if (len > 0) {
                inputX /= len;
                inputZ /= len;
            }

            // Sync JS state to C++ (in case vine swing or other things moved us)
            setPlayerState(camera.position.x, camera.position.y, camera.position.z, player.velocity.x, player.velocity.y, player.velocity.z);

            // CALL C++ UPDATE
            const onGround = updatePhysicsCPP(
                delta, inputX, inputZ, moveSpeed,
                keyStates.jump ? 1 : 0,
                keyStates.sprint ? 1 : 0,
                keyStates.sneak ? 1 : 0,
                grooveGravity.multiplier
            );

            if (onGround >= 0) { // Success (returns onGround status)
                // Read back state
                const newState = getPlayerState();
                camera.position.x = newState.x;
                camera.position.y = newState.y;
                camera.position.z = newState.z;
                player.velocity.x = newState.vx;
                player.velocity.y = newState.vy;
                player.velocity.z = newState.vz;

                // If jumped (was processed in C++), clear key
                if (keyStates.jump && onGround == 1) { // 1 = landed/grounded
                     // C++ handles jump impulse if key is set and onGround.
                     // We just need to clear the key if we are in air now?
                     // Actually C++ applies jump force immediately if onGround && jump.
                     // So we should clear it.
                }
                // Just clear jump if we are not on ground anymore (jumping)
                if (player.velocity.y > 0) keyStates.jump = false;

                controls.moveRight(0); // We set position directly, so no need for controls.move* accumulation?
                // Wait, PointerLockControls usually operates on camera position via moveRight/Forward.
                // But we just set camera.position directly.
                // This might desync if PLC maintains internal state?
                // Three.js PointerLockControls just modifies object.position. So setting object.position is fine.

                return; // SKIP JS FALLBACK
            }

            // --- END C++ PHYSICS ---

            // Standard Movement (JS Fallback)
            _targetVelocity.set(0, 0, 0);
            if (keyStates.forward) _targetVelocity.z += moveSpeed;
            if (keyStates.backward) _targetVelocity.z -= moveSpeed;
            if (keyStates.left) _targetVelocity.x -= moveSpeed;
            if (keyStates.right) _targetVelocity.x += moveSpeed;

            if (_targetVelocity.lengthSq() > 0) {
                _targetVelocity.normalize().multiplyScalar(moveSpeed);
            }

            // --- CHANGED: Disabled Player Wind Drifting ---
            // We removed the code that added bpmWind to _targetVelocity here.
            // This prevents the player from sliding/shaking when music plays.
            // (bpmWind is still maintained above for use by visual systems like foliage)
            // ----------------------------------------------

            const smoothing = Math.min(1.0, 15.0 * delta);
            player.velocity.x += (_targetVelocity.x - player.velocity.x) * smoothing;
            player.velocity.z += (_targetVelocity.z - player.velocity.z) * smoothing;

            player.velocity.y -= player.gravity * delta;

            if (isNaN(player.velocity.x) || isNaN(player.velocity.z) || isNaN(player.velocity.y)) {
                player.velocity.set(0, 0, 0);
            }

            controls.moveRight(player.velocity.x * delta);
            controls.moveForward(player.velocity.z * delta);

            // --- PHYSICS & COLLISION ---

            // Mushroom Collision (Stem & Cap)
            const pPos = camera.position;

            for (let i = 0; i < foliageMushrooms.length; i++) {
                const mush = foliageMushrooms[i];
                const stemR = mush.userData.stemRadius || 0.5;
                const capR = mush.userData.capRadius || 2.0;
                const capH = mush.userData.capHeight || 3.0; // Top of stem, start of cap
                const mPos = mush.position;

                // 1. Horizontal Distance
                const dx = pPos.x - mPos.x;
                const dz = pPos.z - mPos.z;
                const distH = Math.sqrt(dx * dx + dz * dz);

                // 2. Stem Collision (Blocking)
                // If we are below the cap and touching the stem...
                if (pPos.y < mPos.y + capH - 0.5) {
                    const minDist = stemR + PLAYER_RADIUS;
                    if (distH < minDist) {
                        // Push out
                        const angle = Math.atan2(dz, dx);
                        const pushX = Math.cos(angle) * minDist;
                        const pushZ = Math.sin(angle) * minDist;

                        camera.position.x = mPos.x + pushX;
                        camera.position.z = mPos.z + pushZ;
                    }
                }

                // 3. Cap Collision (Platform / Bounce)
                // Check if we are above the stem top and falling onto the cap
                else if (player.velocity.y < 0) {
                    // Check if within cap radius
                    if (distH < capR) {
                        // Check vertical overlap (are we hitting the cap surface?)
                        // Cap surface is approx at mPos.y + capH
                        const surfaceY = mPos.y + capH;

                        // If we are just above or slightly inside the surface...
                        if (pPos.y >= surfaceY - 0.5 && pPos.y <= surfaceY + 2.0) {

                            if (mush.userData.isTrampoline) {
                                // BOUNCE!
                                const audioBoost = audioState?.kickTrigger || 0.0;
                                player.velocity.y = 15 + audioBoost * 10;

                                // Visual squash
                                mush.scale.y = 0.7;
                                setTimeout(() => { mush.scale.y = 1.0; }, 100);
                                keyStates.jump = false; // Consume jump
                            } else {
                                // PLATFORM (Land)
                                camera.position.y = surfaceY + 1.8; // Stand on top
                                player.velocity.y = 0;

                                // Allow jumping off
                                if (keyStates.jump) {
                                    player.velocity.y = 10;
                                }
                            }
                        }
                    }
                }
            }

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

            // 2. Flower Trampoline
            const flowerBounce = checkFlowerTrampoline(playerPos, audioState);
            if (flowerBounce > 0) {
                player.velocity.y = Math.max(player.velocity.y, flowerBounce);
                keyStates.jump = false;
            }

            const safeGroundY = Math.max(isNaN(groundY) ? 0 : groundY, cloudY);

            // Landing (if not already handled by mushroom platform)
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
