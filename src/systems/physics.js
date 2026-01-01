// src/systems/physics.js

import * as THREE from 'three';
import {
    getGroundHeight, initPhysics, addObstacle, setPlayerState, getPlayerState, updatePhysicsCPP
} from '../utils/wasm-loader.js';
import {
    foliageMushrooms, foliageTrampolines, foliageClouds,
    activeVineSwing, setActiveVineSwing, lastVineDetachTime, setLastVineDetachTime, vineSwings
} from '../world/state.js';
import { profiler } from '../utils/profiler.js';
import { SpatialHashGrid } from '../utils/spatial-hash.js';

// --- Configuration ---
const PLAYER_RADIUS = 0.5;
const GRAVITY = 20.0;
const SWIMMING_GRAVITY = 2.0; // Much lower gravity in water
const SWIMMING_DRAG = 4.0;    // High friction in water
const CLIMB_SPEED = 5.0;

// Optimization: Scratch variables to prevent GC in hot loops
const _scratchGatePos = new THREE.Vector3();
const _scratchSwimDir = new THREE.Vector3();
const _scratchCamDir = new THREE.Vector3();
const _scratchCamRight = new THREE.Vector3();
const _scratchMoveVec = new THREE.Vector3();
const _scratchTargetVelocity = new THREE.Vector3();

// --- State Definitions ---
export const PlayerState = {
    DEFAULT: 'default',   // Grounded or Airborne (Standard Physics)
    SWIMMING: 'swimming', // Underwater physics
    CLIMBING: 'climbing', // Wall scaling
    VINE: 'vine'          // Swinging on a vine
};

// --- Player State Object ---
export const player = {
    velocity: new THREE.Vector3(),
    speed: 15.0,
    sprintSpeed: 25.0,
    sneakSpeed: 5.0,
    gravity: GRAVITY,
    energy: 0.0,
    maxEnergy: 10.0,
    currentState: PlayerState.DEFAULT,

    // Flags for external systems to query
    isGrounded: false,
    isUnderwater: false
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

// C++ Physics Init Flag
let cppPhysicsInitialized = false;
let foliageCaves = []; // Store caves for collision checks

// Spatial Hash Grids for Collision Optimization (Tier 1 Optimization)
// Each grid partitions space into 10x10 unit cells for fast spatial queries
let caveGrid = null;
let mushroomGrid = null;
let cloudGrid = null;
let vineGrid = null;
let spatialHashEnabled = false; // Flag to enable/disable optimization

// --- Public API ---

export function registerPhysicsCave(cave) {
    foliageCaves.push(cave);
}

// Main Physics Update Loop
export function updatePhysics(delta, camera, controls, keyStates, audioState) {
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
    const playerPos = camera.position;

    // A. Check Water Level / Cave Flooding
    // We check if the player is inside the "Water Gate" zone of a blocked cave
    let waterLevel = -100;

    foliageCaves.forEach(cave => {
        // If cave is flooded (isBlocked) AND player is near the gate
        if (cave.userData.isBlocked) {
             // Bolt Optimization: Reuse scratch vector
             _scratchGatePos.copy(cave.userData.gatePosition).applyMatrix4(cave.matrixWorld);

             // Bolt Optimization: distanceToSquared (2.5 * 2.5 = 6.25)
             // 2.5 is approx radius of water gate visual
             if (playerPos.distanceToSquared(_scratchGatePos) < 6.25) {
                 waterLevel = _scratchGatePos.y + 5; // Water exists here
             }
        }
    });

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
    } else if (player.currentState === PlayerState.VINE) {
        player.currentState = PlayerState.DEFAULT;
    }
}

// --- State: SWIMMING ---
function updateSwimmingState(delta, camera, controls, keyStates) {
    // 1. Buoyancy (Float up slowly)
    player.velocity.y += (SWIMMING_GRAVITY * delta);

    // 2. Drag (Slow down constantly)
    player.velocity.multiplyScalar(1.0 - (SWIMMING_DRAG * delta));

    // 3. Movement (3D Movement - Camera Direction)
    const swimSpeed = player.speed * 0.6; // Slower than running
    _scratchSwimDir.set(0, 0, 0);

    if (keyStates.forward) _scratchSwimDir.z += 1;
    if (keyStates.backward) _scratchSwimDir.z -= 1;
    if (keyStates.right) _scratchSwimDir.x += 1;
    if (keyStates.left) _scratchSwimDir.x -= 1;

    if (_scratchSwimDir.lengthSq() > 0) {
        _scratchSwimDir.normalize();

        // Get Camera direction
        camera.getWorldDirection(_scratchCamDir);
        _scratchCamRight.crossVectors(_scratchCamDir, new THREE.Vector3(0, 1, 0)); // Using temp vec for UP is fine or optimization target? UP is const (0,1,0)

        // Apply input relative to camera view
        // Bolt: Reuse scratch vector
        _scratchMoveVec.set(0, 0, 0)
            .addScaledVector(_scratchCamDir, _scratchSwimDir.z)
            .addScaledVector(_scratchCamRight, _scratchSwimDir.x);

        player.velocity.addScaledVector(_scratchMoveVec, swimSpeed * delta);
    }

    // 4. Vertical Input (Jump = Swim Up, Sneak = Swim Down)
    if (keyStates.jump) player.velocity.y += 10 * delta;
    if (keyStates.sneak) player.velocity.y -= 10 * delta;

    // 5. Apply
    controls.moveRight(player.velocity.x * delta);
    controls.moveForward(player.velocity.z * delta);
    camera.position.y += player.velocity.y * delta;
}

// --- State: VINE SWING ---
function updateVineState(delta, camera, keyStates) {
    if (activeVineSwing) {
        activeVineSwing.update(camera, delta, keyStates);
        if (keyStates.jump) {
            setLastVineDetachTime(activeVineSwing.detach(player));
            setActiveVineSwing(null);
            keyStates.jump = false;
            player.currentState = PlayerState.DEFAULT;
        }
    }
}

// --- State: CLIMBING (Placeholder for future platforming) ---
function updateClimbingState(delta, camera, controls, keyStates) {
    player.velocity.set(0,0,0);
    player.currentState = PlayerState.DEFAULT; // Fallback for now
}

// --- State: DEFAULT (Walking/Falling) ---
function updateDefaultState(delta, camera, controls, keyStates, audioState) {
    // Initialize C++ Physics if needed
    if (!cppPhysicsInitialized) {
        initCppPhysics(camera);
        cppPhysicsInitialized = true;
    }

    // Update Vine Visuals (even if not swinging)
    vineSwings.forEach(v => {
        if (v !== activeVineSwing) v.update(camera, delta, null);
    });

    // Vine Attachment Check
    if (Date.now() - lastVineDetachTime > 500) {
        profiler.measure('VineAttach', () => {
            checkVineAttachment(camera);
        });
    }

    // --- C++ MOVEMENT INTEGRATION ---

    let inputX = 0;
    let inputZ = 0;
    let moveSpeed = keyStates.sprint ? player.sprintSpeed : (keyStates.sneak ? player.sneakSpeed : player.speed);

    if (keyStates.forward) inputZ += 1;
    if (keyStates.backward) inputZ -= 1;
    if (keyStates.left) inputX -= 1;
    if (keyStates.right) inputX += 1;

    // Normalize
    const lenSq = inputX*inputX + inputZ*inputZ;
    if (lenSq > 0) {
        const len = Math.sqrt(lenSq);
        inputX /= len; inputZ /= len;
    }

    // Sync State
    setPlayerState(camera.position.x, camera.position.y, camera.position.z, player.velocity.x, player.velocity.y, player.velocity.z);

    // Run C++ Update
    const onGround = updatePhysicsCPP(
        delta, inputX, inputZ, moveSpeed,
        keyStates.jump ? 1 : 0,
        keyStates.sprint ? 1 : 0,
        keyStates.sneak ? 1 : 0,
        grooveGravity.multiplier
    );

    if (onGround >= 0) {
        // C++ Success
        const newState = getPlayerState();
        camera.position.set(newState.x, newState.y, newState.z);
        player.velocity.set(newState.vx, newState.vy, newState.vz);
        if (player.velocity.y > 0) keyStates.jump = false; // Clear jump
        player.isGrounded = (onGround === 1);
    } else {
        // JS Fallback (if C++ fails)
        updateJSFallbackMovement(delta, camera, controls, keyStates, moveSpeed);
    }

    // --- ADDITIONAL JS COLLISIONS (Mushrooms, Clouds, Gates) ---
    profiler.measure('Collisions', () => {
        resolveSpecialCollisions(delta, camera, keyStates, audioState);
    });
}

function updateJSFallbackMovement(delta, camera, controls, keyStates, moveSpeed) {
    _scratchTargetVelocity.set(0, 0, 0);
    if (keyStates.forward) _scratchTargetVelocity.z += moveSpeed;
    if (keyStates.backward) _scratchTargetVelocity.z -= moveSpeed;
    if (keyStates.left) _scratchTargetVelocity.x -= moveSpeed;
    if (keyStates.right) _scratchTargetVelocity.x += moveSpeed;

    if (_scratchTargetVelocity.lengthSq() > 0) _scratchTargetVelocity.normalize().multiplyScalar(moveSpeed);

    const smoothing = Math.min(1.0, 15.0 * delta);
    player.velocity.x += (_scratchTargetVelocity.x - player.velocity.x) * smoothing;
    player.velocity.z += (_scratchTargetVelocity.z - player.velocity.z) * smoothing;
    player.velocity.y -= player.gravity * delta;

    controls.moveRight(player.velocity.x * delta);
    controls.moveForward(player.velocity.z * delta);
    camera.position.y += player.velocity.y * delta;

    // Simple Ground Check
    const groundY = getGroundHeight(camera.position.x, camera.position.z);
    if (camera.position.y < groundY + 1.8 && player.velocity.y <= 0) {
        camera.position.y = groundY + 1.8;
        player.velocity.y = 0;
        player.isGrounded = true;
    } else {
        player.isGrounded = false;
    }
}

// Resolve collisions with game objects (Mushrooms, Water Gates, etc)
function resolveSpecialCollisions(delta, camera, keyStates, audioState) {
    const playerPos = camera.position;

    // 1. Water Gates (Cave Blockers)
    // If not swimming (meaning we are walking into it), push back
    const nearbyCaves = spatialHashEnabled ? caveGrid.query(playerPos.x, playerPos.z) : foliageCaves;
    
    nearbyCaves.forEach(cave => {
        if (cave.userData.isBlocked) {
            // Bolt Optimization: Reuse scratch vector
            _scratchGatePos.copy(cave.userData.gatePosition).applyMatrix4(cave.matrixWorld);
            const dx = playerPos.x - _scratchGatePos.x;
            const dz = playerPos.z - _scratchGatePos.z;

            // Bolt Optimization: Squared distance (2.5^2 = 6.25)
            const distSq = dx*dx + dz*dz;

            // If near gate and NOT already inside water (transition state handles inside)
            if (distSq < 6.25 && player.currentState !== PlayerState.SWIMMING) {
                // Push back force
                const angle = Math.atan2(dz, dx);
                const pushForce = 15.0 * delta;
                camera.position.x += Math.cos(angle) * pushForce;
                camera.position.z += Math.sin(angle) * pushForce;
                player.velocity.x *= 0.5;
                player.velocity.z *= 0.5;
            }
        }
    });

    // 2. Mushroom Caps (Trampolines/Platforms) - JS Check with Spatial Hash Optimization
    const nearbyMushrooms = spatialHashEnabled ? mushroomGrid.query(playerPos.x, playerPos.z) : foliageMushrooms;
    
    for (const mush of nearbyMushrooms) {
        if (player.velocity.y < 0) {
            const capR = mush.userData.capRadius || 2.0;
            const capRSq = capR * capR;
            const capH = mush.userData.capHeight || 3.0;
            const dx = playerPos.x - mush.position.x;
            const dz = playerPos.z - mush.position.z;

            // Bolt Optimization: Squared distance
            const distSq = dx*dx + dz*dz;

            if (distSq < capRSq) {
                const surfaceY = mush.position.y + capH;
                if (playerPos.y >= surfaceY - 0.5 && playerPos.y <= surfaceY + 2.0) {
                    if (mush.userData.isTrampoline) {
                        const audioBoost = audioState?.kickTrigger || 0.0;
                        player.velocity.y = 15 + audioBoost * 10;
                        mush.scale.y = 0.7;
                        setTimeout(() => { mush.scale.y = 1.0; }, 100);
                        keyStates.jump = false;
                    } else {
                        // Platform land
                        camera.position.y = surfaceY + 1.8;
                        player.velocity.y = 0;
                        player.isGrounded = true;
                        if (keyStates.jump) player.velocity.y = 10;
                    }
                }
            }
        }
    }

    // 3. Cloud Walking (Simplified) - with Spatial Hash Optimization
    if (playerPos.y > 15) {
        const nearbyClouds = spatialHashEnabled ? cloudGrid.query(playerPos.x, playerPos.z) : foliageClouds;
        
        for (const cloud of nearbyClouds) {
            const dx = playerPos.x - cloud.position.x;
            const dz = playerPos.z - cloud.position.z;
            const radius = (cloud.scale.x || 1.0) * 2.0;
            const radiusSq = radius * radius;

            // Bolt Optimization: Squared distance
            const distSq = dx*dx + dz*dz;

            if (distSq < radiusSq) {
                if (cloud.userData.tier === 1) {
                     const topY = cloud.position.y + (cloud.scale.y || 1.0) * 0.8;
                     if (playerPos.y >= topY - 0.5 && (playerPos.y - topY) < 3.0) {
                         if (player.velocity.y <= 0) {
                             camera.position.y = topY;
                             player.velocity.y = 0;
                             player.isGrounded = true;
                             if (keyStates.jump) player.velocity.y = 15;
                         }
                     }
                }
            }
        }
    }
}

// Helper: Initialize C++ obstacles (One-time setup)
function initCppPhysics(camera) {
    initPhysics(camera.position.x, camera.position.y, camera.position.z);

    // Add Mushrooms
    for (const m of foliageMushrooms) {
        addObstacle(0, m.position.x, m.position.y, m.position.z, 0, m.userData.capHeight||3, m.userData.stemRadius||0.5, m.userData.capRadius||2, m.userData.isTrampoline?1:0);
    }
    // Add Clouds
    for (const c of foliageClouds) {
        addObstacle(1, c.position.x, c.position.y, c.position.z, (c.scale.x||1)*2.0, (c.scale.y||1)*0.8, 0, c.userData.tier||1, 0);
    }
    // Add Trampolines
    for (const t of foliageTrampolines) {
        addObstacle(2, t.position.x, t.position.y, t.position.z, t.userData.bounceRadius||0.5, t.userData.bounceHeight||0.5, t.userData.bounceForce||12, 0, 0);
    }
    console.log('[Physics] C++ Physics Initialized.');

    // Initialize Spatial Hash Grids (Tier 1 Optimization)
    // Cell size of 10 units chosen based on typical collision radii (2-5 units)
    caveGrid = new SpatialHashGrid(10);
    mushroomGrid = new SpatialHashGrid(10);
    cloudGrid = new SpatialHashGrid(10);
    vineGrid = new SpatialHashGrid(10);

    // Populate grids with static objects
    foliageCaves.forEach(cave => {
        caveGrid.insert(cave, cave.position.x, cave.position.z);
    });

    foliageMushrooms.forEach(mush => {
        mushroomGrid.insert(mush, mush.position.x, mush.position.z);
    });

    foliageClouds.forEach(cloud => {
        cloudGrid.insert(cloud, cloud.position.x, cloud.position.z);
    });

    vineSwings.forEach(vine => {
        vineGrid.insert(vine, vine.anchorPoint.x, vine.anchorPoint.z);
    });

    spatialHashEnabled = true;

    // Log spatial hash statistics
    console.log('[Physics] Spatial Hash Grids Initialized:');
    console.log('  - Caves:', caveGrid.getStats());
    console.log('  - Mushrooms:', mushroomGrid.getStats());
    console.log('  - Clouds:', cloudGrid.getStats());
    console.log('  - Vines:', vineGrid.getStats());
}

function checkVineAttachment(camera) {
    const playerPos = camera.position;
    const nearbyVines = spatialHashEnabled ? vineGrid.query(playerPos.x, playerPos.z) : vineSwings;
    
    for (const vineManager of nearbyVines) {
        const dx = playerPos.x - vineManager.anchorPoint.x;
        const dz = playerPos.z - vineManager.anchorPoint.z;

        // Bolt Optimization: Squared distance
        const distHSq = dx*dx + dz*dz;
        const tipY = vineManager.anchorPoint.y - vineManager.length;

        // 2.0^2 = 4.0
        if (distHSq < 4.0 && playerPos.y < vineManager.anchorPoint.y && playerPos.y > tipY) {
             // 1.0^2 = 1.0
             if (distHSq < 1.0) {
                 vineManager.attach(camera, player.velocity);
                 setActiveVineSwing(vineManager);
                 break;
             }
        }
    }
}
