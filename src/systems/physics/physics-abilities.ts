// src/systems/physics/physics-abilities.ts
// Ability system: Dash, Dodge Roll, Double Jump, Sonic Clap, Phase Shift

import * as THREE from 'three';
import { player, _lastInputState, _scratchCamDir, AudioState, KeyStates } from './physics-types.js';
import { spawnImpact } from '../../foliage/impacts.ts';
import { spawnDandelionExplosion } from '../../foliage/dandelion-seeds.ts';
import { dandelionBatcher } from '../../foliage/dandelion-batcher.ts';
import { animatedFoliage } from '../../world/state.ts';
import { discoverySystem } from '../discovery.ts';
import { unlockSystem } from '../unlocks.ts';
import { showToast } from '../../utils/toast.js';
import { uChromaticIntensity } from '../../foliage/chromatic.ts';
import { addCameraShake } from '../../main.ts';

// --- Ability Handler ---
export function handleAbilities(delta: number, camera: THREE.Camera, keyStates: KeyStates) {
    // 1. Cooldown Management
    if (player.dashCooldown > 0) {
        player.dashCooldown -= delta;
    }
    if (player.dodgeRollCooldown > 0) {
        player.dodgeRollCooldown -= delta;
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

        // 🎨 Palette: "Juice" Factor - Add screen shake and audio for Double Jump
        addCameraShake(0.15);
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
            (window as any).AudioSystem.playSound('jump', { pitch: Math.random() * 0.2 + 1.2, volume: 0.5 });
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
        addCameraShake(0.1); // 🎨 Palette: Dash shake

        // 🎨 Palette: Audio feedback for dash
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
            (window as any).AudioSystem.playSound('dash', { pitch: Math.random() * 0.2 + 0.9, volume: 0.6 });
        }

        if (uChromaticIntensity) {
            uChromaticIntensity.value = 0.5; // Stronger pulse for dash
        }

        discoverySystem.discover('ability_dash', 'Dash', '💨');
    }

    // 4.5 Dodge Roll
    // Trigger on Rising Edge of Dodge Roll Key AND Cooldown Ready
    const isDodgeRollPressed = keyStates.dodgeRoll;
    const isDodgeRollTriggered = isDodgeRollPressed && !_lastInputState.dodgeRoll;

    if (isDodgeRollTriggered && player.dodgeRollCooldown <= 0) {
        // Calculate Direction
        camera.getWorldDirection(_scratchCamDir);
        _scratchCamDir.y = 0;
        _scratchCamDir.normalize();

        // Apply Impulse
        player.velocity.addScaledVector(_scratchCamDir, 35.0);
        if (!player.isGrounded) {
            player.velocity.y = 0;
        }

        // Grant short invulnerability window
        player.isPhasing = true;
        player.phaseTimer = 0.5;

        player.dodgeRollCooldown = 1.5; // 1.5 Second Cooldown

        // Visual Feedback
        spawnImpact(player.position, 'dash');
        if (uChromaticIntensity) {
            uChromaticIntensity.value = 0.6;
        }

        discoverySystem.discover('ability_dodge_roll', 'Dodge Roll', '🌪️');
    }

    // 5. Sonic Clap
    // Trigger on Rising Edge of Clap Key
    const isClapPressed = keyStates.clap;
    const isClapTriggered = isClapPressed && !_lastInputState.clap;

    if (isClapTriggered) {
        handleSonicClap();
    }

    // 6. Phase Shift
    // Trigger on Rising Edge of Phase Key
    const isPhasePressed = keyStates.phase;
    const isPhaseTriggered = isPhasePressed && !_lastInputState.phase;

    if (isPhaseTriggered) {
        handlePhaseShift();
    }
}

// --- Sonic Clap Logic ---
function handleSonicClap() {
    // Visual effect for clap
    spawnImpact(player.position, 'dash');
    if (uChromaticIntensity) uChromaticIntensity.value = 0.3;

    // Iterate through flora to find Cymbal Dandelions
    let foundDandelion = false;
    for (const obj of animatedFoliage) {
        if (obj.userData?.type === 'flower' && obj.userData?.animationType === 'batchedCymbal') {
            if (!obj.userData.harvested) {
                const distSq = player.position.distanceToSquared(obj.position);
                if (distSq < 15.0 * 15.0) { // 15 unit radius
                    foundDandelion = true;

                    dandelionBatcher.harvest(obj.userData.batchIndex);
                    unlockSystem.harvest('chime_shard', 3, 'Chime Shards');

                    // Visual FX
                    const scale = obj.scale.x;
                    // ⚡ OPTIMIZATION: Reuse pre-allocated scratch vector and color for GC-free sonic clap
                    import('./physics-types.js').then(({ _scratchHeadOffset, _scratchPos, _clapColor }) => {
                        _scratchHeadOffset.set(0, 1.5 * scale, 0).applyQuaternion(obj.quaternion);
                        // ⚡ OPTIMIZATION: Reused scratch vector for headPos to prevent GC spike
                        const headPos = _scratchPos.copy(obj.position).add(_scratchHeadOffset);

                        spawnImpact(headPos, 'spore', _clapColor);
                        spawnDandelionExplosion(headPos, 24);
                    });

                    // 🎨 Palette: "Juice" Factor - Add screen shake and audio for Sonic Clap
                    addCameraShake(0.4);
                    if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                        (window as any).AudioSystem.playSound('impact', { pitch: Math.random() * 0.2 + 0.8, volume: 0.8 });
                    }

                    obj.userData.harvested = true;
                    obj.userData.interactionText = "Harvested";
                }
            }
        }
    }

    if (foundDandelion) {
        discoverySystem.discover('ability_sonic_clap', 'Sonic Clap', '👏');
    }
}

// --- Phase Shift Logic ---
function handlePhaseShift() {
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
