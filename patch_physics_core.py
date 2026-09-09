import re

with open('src/systems/physics/physics-core.ts', 'r') as f:
    content = f.read()

# 1. Add setPlayerState to the wasm-loader imports
content = content.replace(
    "    updatePhysicsCPP,\n    getPlayerState,\n} from '../../utils/wasm-loader.ts';",
    "    updatePhysicsCPP,\n    getPlayerState,\n    setPlayerState,\n} from '../../utils/wasm-loader.ts';"
)

# 2. Add resolveCharacterMovement, getGroundHeight, sampleFootprint and other required things
content = content.replace(
    "import { reconcileGroundedEyeY, isInLakeBasin } from '../ground-system.ts';",
    "import { reconcileGroundedEyeY, isInLakeBasin, getGroundHeight, sampleGroundFootprint } from '../ground-system.ts';"
)
content = content.replace(
    "import {\n    updateSwimmingState,",
    "import { resolveCharacterMovement } from './character-controller.ts';\nimport {\n    updateSwimmingState,"
)

# Add missing scratch variables and fix imports from physics-types
content = content.replace(
    "    _scratchPlayerState,\n} from './physics-types.ts';",
    "    _scratchPlayerState,\n    _scratchTargetVel,\n    _scratchCamDir,\n    _scratchCamRight,\n    _scratchUp,\n} from './physics-types.ts';"
)

# 3. Replace updateJSFallbackMovement in physics-updates import with nothing
content = content.replace(
    "    initCppPhysics,\n    updateJSFallbackMovement,\n} from './physics-updates.ts';",
    "    initCppPhysics,\n} from './physics-updates.ts';"
)

# Find the start of the dynamic import and everything until the end of updateDefaultState
start_marker = "    // Seed WASM state at start of next frame\n    import('../../utils/wasm-physics.ts').then(({ setPlayerState }) => {\n        setPlayerState(player.position.x, player.position.y, player.position.z, player.velocity.x, player.velocity.y, player.velocity.z);\n    }).catch(() => {});\n\n    if (!inLakeBasin) {"
start_idx = content.find("    // Seed WASM state at start of next frame")

end_marker = "    if ((window as any).__diagPhysicsCount === 4) {"
end_idx = content.find(end_marker)

replacement = """    // Calculate target velocity based on input (formerly in updateJSFallbackMovement)
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
        { sampleFootprint: sampleGroundFootprint, getGroundHeight }
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
"""

# There is a block to replace:
content = content[:start_idx] + replacement + content[end_idx:]

# Also remove the block:
#     if (!(window as any).__physicsPathStats) {
#         (window as any).__physicsPathStats = physicsPathStats;
#     }
#
#     if (onGround >= 0) { ... } else { ... }
start_idx_2 = content.find("    if (!(window as any).__physicsPathStats) {")
end_idx_2 = content.find("    if ((window as any).__diagPhysicsCount === 4) {", start_idx_2)
# Oh wait, my replacement replaced all the way up to "if ((window as any).__diagPhysicsCount === 4) {"

with open('src/systems/physics/physics-core.ts', 'w') as f:
    f.write(content)
