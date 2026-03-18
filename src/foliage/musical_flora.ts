import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { 
    createClayMaterial, 
    createCandyMaterial, 
    registerReactiveMaterial, 
    attachReactivity,
    CandyPresets,
    uAudioLow,
    uTime,
    uGlitchIntensity
} from './common.ts';
import {
    color, float, vec3, sin, cos, mix, uv, positionLocal, time, smoothstep, uniform, vec2, step, abs
} from 'three/tsl';
import { applyGlitch } from './glitch.ts';

import { makeInteractive as makeInteractiveUtils } from '../utils/interaction-utils.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { spawnImpact } from './impacts.ts';

import { batchAnimationCalc, uploadPositions } from '../utils/wasm-loader.js';
import { arpeggioFernBatcher } from './arpeggio-batcher.ts';
import { dandelionBatcher } from './dandelion-batcher.ts';
import { portamentoPineBatcher } from './portamento-batcher.ts';
import { spawnDandelionExplosion } from './dandelion-seeds.ts';

// Interfaces for options
export interface ArpeggioFernOptions {
    color?: number;
    scale?: number;
}

export interface PortamentoPineOptions {
    height?: number;
}

export interface CymbalDandelionOptions {
    scale?: number;
}

export interface SnareTrapOptions {
    color?: number;
    scale?: number;
}

export interface RetriggerMushroomOptions {
    color?: number;
    scale?: number;
    retriggerSpeed?: number;
}

// Interfaces for internal structures
interface SystemData {
    mesh: THREE.InstancedMesh;
    data: any[];
    count: number;
}

// ⚡ OPTIMIZATION: Shared scratch variables to avoid GC in animation loops
const _scratchEuler = new THREE.Euler();

// --- Helper: Glitch Material ---
function createGlitchyMaterial(hexColor: number): MeshStandardNodeMaterial {
    // 1. Base Material (Clay preset)
    const material = CandyPresets.Clay(hexColor, {
        roughness: 0.8,
        bumpStrength: 0.1,
    });

    // 2. Glitch Logic (Position)
    // We want the mushroom to glitch (stutter/jitter) when the Bass (Retrigger) hits.
    // uAudioLow is the driver.
    // We combine global glitch intensity with local audio reactivity.
    const glitchTrigger = uAudioLow.mul(0.5).add(uGlitchIntensity);
    const glitchResult = applyGlitch(uv(), positionLocal, glitchTrigger);

    material.positionNode = glitchResult.position;

    // 3. Scanline Logic (Emissive)
    // Scrolling sine wave
    const scanSpeed = float(5.0);
    const scanFreq = float(20.0);
    const scanPhase = uv().y.mul(scanFreq).sub(time.mul(scanSpeed));
    // Sharp scanline: pow(sin, high_power)
    const scanline = sin(scanPhase).add(1.0).mul(0.5).pow(4.0);

    // Color Shift: Mix base color with Cyan based on scanline strength
    // PRESERVE: Use existing colorNode (Clay preset AO) as base
    const baseColorNode = material.colorNode || color(hexColor);
    const glitchColor = color(0x00FFFF); // Cyan

    // Emissive boost on scanline
    const emissiveIntensity = scanline.mul(glitchTrigger.add(0.2)).mul(2.0); // Base visibility + Kick

    material.colorNode = mix(baseColorNode, glitchColor, scanline.mul(glitchTrigger));
    material.emissiveNode = glitchColor.mul(emissiveIntensity);

    return material;
}

// --- Category 1: Melodic Flora ---

export function createArpeggioFern(options: ArpeggioFernOptions = {}) {
    const { color = 0x00FF88, scale = 1.0 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Logic Object only (visuals are batched)
    // Hit Volume for interaction
    const hitGeo = new THREE.CylinderGeometry(0.5 * scale, 0.5 * scale, 2.0 * scale);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = 1.0 * scale;
    group.add(hitMesh);

    group.userData.animationType = 'arpeggioUnfurl';
    group.userData.type = 'fern';
    group.userData.interactionText = "Play Arpeggio";

    group.userData.needsRegistration = true;
    group.userData.batchOptions = options;

    // Callback for generation system to invoke after setting position
    group.userData.onPlacement = () => {
        arpeggioFernBatcher.register(group, options);
    };

    // Attach basic reactivity metadata
    attachReactivity(group);

    const interactive = makeInteractive(group);

    // Override interaction handlers to support InstancedMesh updates
    const originalEnter = group.userData.onGazeEnter;
    const originalLeave = group.userData.onGazeLeave;
    const originalInteract = group.userData.onInteract;

    // Helper to update text based on state
    group.userData.updateInteractionState = () => {
        const unfurl = arpeggioFernBatcher.globalUnfurl || 0;
        const harvested = group.userData.harvested || false;

        if (harvested) {
            group.userData.interactionText = "Harvested";
        } else if (unfurl > 0.8) {
            group.userData.interactionText = "Harvest Core";
        } else {
            group.userData.interactionText = "Play Arpeggio";
        }
    };

    group.userData.onGazeEnter = () => {
        group.userData.updateInteractionState();
        if (originalEnter) originalEnter(); // Handles logic state (isHovered)
        // Physical pop handled by updating batcher matrix
        const batchIdx = group.userData.batchIndex;
        if (batchIdx !== undefined) {
             // We need to scale the group (Logic) then update Batcher
             // makeInteractive already scaled the group in originalEnter!
             arpeggioFernBatcher.updateInstance(batchIdx, group);
        }
    };

    group.userData.onInteract = () => {
        if (originalInteract) originalInteract(); // Visual spin

        const unfurl = arpeggioFernBatcher.globalUnfurl || 0;
        if (!group.userData.harvested && unfurl > 0.8) {
            unlockSystem.harvest('fern_core', 1, 'Fern Core');
            group.userData.harvested = true;
            group.userData.updateInteractionState();
        }
    };

    group.userData.onGazeLeave = () => {
        if (originalLeave) originalLeave();
        const batchIdx = group.userData.batchIndex;
        if (batchIdx !== undefined) {
             arpeggioFernBatcher.updateInstance(batchIdx, group);
        }
    };

    return interactive;
}

export function createSnareTrap(options: SnareTrapOptions = {}) {
    const { scale = 1.0, color = 0xFF4444 } = options;
    const group = new THREE.Group();

    // Visuals: Jaw-like structure
    // Lower Jaw
    const lowerJaw = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.2, 1),
        createClayMaterial(color)
    );
    lowerJaw.position.y = 0.1;
    group.add(lowerJaw);

    // Upper Jaw (Pivots)
    const upperJaw = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.2, 1),
        createClayMaterial(color)
    );
    upperJaw.position.y = 0.5;
    upperJaw.rotation.x = -Math.PI / 4; // Open
    // Pivot helper
    const pivot = new THREE.Group();
    pivot.position.y = 0.1;
    pivot.position.z = -0.5;
    pivot.add(upperJaw);
    upperJaw.position.z = 0.5; // Offset from pivot
    group.add(pivot);

    group.userData.upperJaw = pivot;
    group.userData.snapState = 0; // 0=Open, 1=Closed
    group.userData.type = 'trap';
    group.userData.reactivityType = 'snare'; // Reacts to Snare

    // Scale
    group.scale.setScalar(scale);

    group.userData.interactionText = 'Harvest Snap Shard';
    group.userData.onInteract = () => {
        if (!group.userData.harvested) {
            unlockSystem.harvest('snap_shard', 1, 'Snap Shard');
            group.userData.harvested = true;
            group.userData.interactionText = '';
            group.userData.updateInteractionState?.();

            // Visual FX
            spawnImpact(group.position, 'spore', new THREE.Color(0xFF4444));
        }
    };

    const reactiveGroup = attachReactivity(group);
    return makeInteractive(reactiveGroup);
}

export function createRetriggerMushroom(options: RetriggerMushroomOptions = {}) {
    const { scale = 1.0, color = 0xFF6B6B, retriggerSpeed = 4 } = options;
    const group = new THREE.Group();

    // Use Glitchy Material for Cap
    const capMat = createGlitchyMaterial(color);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    cap.position.y = 0.8;
    group.add(cap);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.8, 8), createClayMaterial(0xF5F5DC));
    stem.position.y = 0.4;
    group.add(stem);

    group.scale.setScalar(scale);
    group.userData.type = 'retrigger_mushroom';
    group.userData.retriggerSpeed = retriggerSpeed;
    group.userData.reactivityType = 'retrigger';

    return attachReactivity(group);
}

export function createPortamentoPine(options: PortamentoPineOptions = {}) {
    const { height = 4.0 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Logic Object only (visuals are batched)

    // Use pr-281's batched, scaled logic object (keeps visuals instanced) but preserve
    // HEAD's audio/reactivity behaviour so interactions still sound and affect bend state.
    const scaleFactor = height / 4.0;

    // Scale logic object so physics/interaction matches visual size
    group.scale.setScalar(scaleFactor);

    // Hitbox (Cylinder approx)
    const hitGeo = new THREE.CylinderGeometry(0.5 * scaleFactor, 0.5 * scaleFactor, 4.0 * scaleFactor);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = 2.0 * scaleFactor; // Center at half-height
    group.add(hitMesh);

    group.userData.animationType = 'batchedPortamento'; // Batched logic (matches batcher)
    group.userData.type = 'tree';
    group.userData.interactionText = 'Bend Tree';

    // Reactivity State (kept from HEAD so audio triggers still update logic)
    group.userData.reactivityState = { currentBend: 0, velocity: 0 };

    group.userData.reactToNote = (noteInfo: any) => {
        if (noteInfo.channel === 2 || noteInfo.channel === 3) {
            group.userData.reactivityState.velocity += 15.0 * (noteInfo.velocity || 0.5);
            if ((window as any).AudioSystem && typeof (window as any).AudioSystem.playSound === 'function') {
                const pitch = noteInfo.note ? 1.0 : 0.8 + Math.random() * 0.4;
                (window as any).AudioSystem.playSound('creak', { position: group.position, pitch, volume: 0.3 });
            }
            // Inform the batcher of reactive bend (batcher provides helper)
            const idx = group.userData.batchIndex;
            if (idx !== undefined && portamentoPineBatcher && typeof portamentoPineBatcher.setBendForIndex === 'function') {
                portamentoPineBatcher.setBendForIndex(idx, group.userData.reactivityState.velocity);
            }
        }
    };

    group.userData.onPlacement = () => {
        portamentoPineBatcher.register(group, options);
    };

    const interactive = makeInteractive(group);

    // Sync interactions to batched instance
    const originalEnter = group.userData.onGazeEnter;
    const originalLeave = group.userData.onGazeLeave;

    group.userData.onGazeEnter = () => {
        if (originalEnter) originalEnter();
        const batchIdx = group.userData.batchIndex;
        if (batchIdx !== undefined) portamentoPineBatcher.updateInstance(batchIdx, group);
    };

    group.userData.onGazeLeave = () => {
        if (originalLeave) originalLeave();
        const batchIdx = group.userData.batchIndex;
        if (batchIdx !== undefined) portamentoPineBatcher.updateInstance(batchIdx, group);
    };

    return interactive;
}

// --- Category 2: Rhythmic Structures ---

export function createCymbalDandelion(options: CymbalDandelionOptions = {}) {
    const { scale = 1.0 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Logic Object only (visuals are batched)
    // Hit Volume for interaction
    // Stem Height 1.5, Head at 1.5
    const hitGeo = new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 1.8 * scale);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = 0.9 * scale;
    group.add(hitMesh);

    group.userData.animationType = 'batchedCymbal'; // Use batched type to avoid CPU animation
    group.userData.type = 'flower';
    group.userData.interactionText = "Harvest Seeds";

    // Callback for generation system to invoke after setting position
    group.userData.onPlacement = () => {
        dandelionBatcher.register(group, options);
    };

    const reactiveGroup = attachReactivity(group);
    const interactive = makeInteractive(reactiveGroup);

    // Override interaction logic for harvesting
    const originalInteract = group.userData.onInteract;
    group.userData.onInteract = () => {
        if (!group.userData.harvested) {
            dandelionBatcher.harvest(group.userData.batchIndex);
            unlockSystem.harvest('chime_shard', 3, 'Chime Shards');

            // Visual FX
            const headOffset = new THREE.Vector3(0, 1.5 * scale, 0);
            headOffset.applyQuaternion(group.quaternion);
            const headPos = group.position.clone().add(headOffset);
            spawnImpact(headPos, 'spore', 0xFFD700);
            spawnDandelionExplosion(headPos, 24);

            // Audio
            if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                (window as any).AudioSystem.playSound('pickup', { position: group.position, pitch: 2.0 });
            }

            group.userData.harvested = true;
            group.userData.interactionText = "Harvested";
        }

        if (originalInteract) originalInteract();
    };

    return interactive;
}

// --- UTILITY ---

export function makeInteractive(group: THREE.Group): THREE.Group {
    // Simple wrapper to flag the group as interactive.
    // The actual raycasting often relies on child meshes (like hitMesh).
    group.userData.isInteractive = true;

    // Add default hover behavior if not present
    if (!group.userData.onGazeEnter) {
        group.userData.onGazeEnter = () => {
            // Default scale pop
            group.scale.multiplyScalar(1.1);
        };
    }
    if (!group.userData.onGazeLeave) {
        group.userData.onGazeLeave = () => {
            // Default scale return
            group.scale.multiplyScalar(1 / 1.1);
        };
    }

    return group;
}
